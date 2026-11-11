package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/openxbond/xbond/internal/engine"
)

// delegateManager is the user-session daemon's client side of the layered
// privilege model: TUN takeover is applied by the machine-scoped daemon
// (system service), reached over an identity-verified local transport, while
// this daemon keeps owning state, preferences, and the user-session system
// proxy. The manager remembers the delegated desired state so the reconciler
// can re-apply it after the service restarts.
type delegateManager struct {
	mu   sync.Mutex
	http *http.Client

	// lastConfig is the runtime config the remote core runs; nil after
	// adoption (a remote that was already running reuses its own config, and
	// the reconciler only reads back status).
	lastConfig []byte
	lastMeta   engine.CoreMetadata
	lastStatus engine.EngineStatus
	statusAt   time.Time
	active     bool
	lastError  error
	errLogged  bool

	// probe state: a short-lived cache so the capability gate and every
	// /status poll do not hammer the transport.
	probeAt time.Time
	probeOK bool

	ring *engine.RingLogger
}

// remoteReply is the envelope the delegation endpoints answer with.
type remoteReply struct {
	Ok     bool                `json:"ok"`
	Error  string              `json:"error,omitempty"`
	Status engine.EngineStatus `json:"status,omitempty"`
}

const (
	delegateStatusTTL = 3 * time.Second
	delegateProbeTTL  = 2 * time.Second
)

// runDelegateReconciler drives the runtime's delegation reconciliation on a
// slow tick: adoption after a user-daemon restart, re-apply after a system
// service restart, and teardown when intent flips elsewhere.
func (s *Server) runDelegateReconciler() {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-ticker.C:
			s.runtime.ReconcileDelegation()
		}
	}
}

func newDelegateManager(ring *engine.RingLogger) *delegateManager {
	return &delegateManager{
		http: &http.Client{
			Transport: &http.Transport{DialContext: dialPrivileged},
			Timeout:   15 * time.Second,
		},
		ring: ring,
	}
}

func (d *delegateManager) logf(format string, args ...any) {
	if d.ring != nil {
		d.ring.Append(engine.LogLevelInfo, fmt.Sprintf(format, args...))
	}
}

// LogRuntime records a delegation lifecycle event from the runtime paths.
func (d *delegateManager) LogRuntime(message string) {
	d.logf("%s", message)
}

// Apply hands a derived TUN runtime config to the machine-scoped daemon and
// waits for its core to become ready. The response's engine status is the
// truth for "the delegated takeover is up". The saved node selections ride
// along so the machine session's fresh core starts with the user's picks
// instead of group defaults.
func (d *delegateManager) Apply(config []byte, selections map[string]string) (engine.EngineStatus, error) {
	meta, err := engine.InspectConfig(config)
	if err != nil {
		return engine.EngineStatus{}, fmt.Errorf("inspect delegated config: %w", err)
	}
	if meta.TakeoverMode != engine.ModeTun {
		return engine.EngineStatus{}, fmt.Errorf("refusing to delegate a %s takeover; only TUN runs in the machine session", meta.TakeoverMode)
	}
	var headers map[string]string
	if len(selections) > 0 {
		raw, err := json.Marshal(selections)
		if err != nil {
			return engine.EngineStatus{}, fmt.Errorf("encode delegated selections: %w", err)
		}
		headers = map[string]string{delegatedSelectionsHeader: string(raw)}
	}
	var reply remoteReply
	if err := d.post("/localapi/v0/remote/apply", config, &reply, headers); err != nil {
		d.noteFailure(fmt.Errorf("delegate TUN takeover: %w", err))
		return engine.EngineStatus{}, d.lastError
	}
	if !reply.Status.Running {
		err := errors.New("the system service did not bring the delegated core up")
		d.noteFailure(err)
		return engine.EngineStatus{}, err
	}
	d.mu.Lock()
	d.lastConfig = append([]byte(nil), config...)
	d.lastMeta = meta
	d.lastStatus = reply.Status
	d.statusAt = time.Now()
	d.active = true
	d.lastError = nil
	d.errLogged = false
	d.mu.Unlock()
	d.logf("TUN takeover delegated to the system service (mixed %d, clash %d)", meta.MixedPort, meta.ClashPort)
	return reply.Status, nil
}

// Stop tears the delegated core down. A transport failure is still a stop
// from this daemon's perspective (the takeover is unreachable either way),
// but the error is reported so callers can surface it.
func (d *delegateManager) Stop() error {
	var reply remoteReply
	err := d.post("/localapi/v0/remote/stop", []byte("{}"), &reply, nil)
	d.mu.Lock()
	d.active = false
	d.lastConfig = nil
	if err != nil {
		d.lastError = fmt.Errorf("stop delegated takeover: %w", err)
	} else {
		d.lastError = nil
		d.errLogged = false
	}
	d.mu.Unlock()
	if err != nil {
		return d.lastError
	}
	d.logf("delegated TUN takeover stopped")
	return nil
}

// Active reports whether takeover currently rides the machine-scoped daemon.
func (d *delegateManager) Active() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.active
}

// LastConfig is the runtime config this daemon delegated, if any.
func (d *delegateManager) LastConfig() []byte {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.lastConfig
}

// LastError is the most recent delegation failure, for status surfacing.
func (d *delegateManager) LastError() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.lastError
}

// ClashClient addresses the remote core's clash API. The delegated config
// keeps the same loopback ports the local core would have bound, so the
// existing client type works unchanged.
func (d *delegateManager) ClashClient() *engine.ClashClient {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.active {
		return nil
	}
	return engine.NewClashClient(d.lastMeta.ClashPort, d.lastMeta.ClashSecret)
}

// Logs reads the machine-scoped daemon's ring log (the delegated core's
// logs live there, not in this daemon's ring).
func (d *delegateManager) Logs(level engine.LogLevel, limit int) ([]engine.LogEntry, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	url := fmt.Sprintf("/localapi/v0/remote/logs?level=%s&limit=%d", level, limit)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://xbond-system"+url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := d.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("remote logs returned %d", resp.StatusCode)
	}
	var payload struct {
		Logs []engine.LogEntry `json:"logs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	return payload.Logs, nil
}

// RulesPage reads the machine session's core rules: the delegated core's
// rule set lives across the privileged transport, not in this process.
func (d *delegateManager) RulesPage(query engine.RuleQuery) (engine.RulePage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	params := url.Values{}
	if query.Search != "" {
		params.Set("q", query.Search)
	}
	if query.MatchType != "" {
		params.Set("matchType", query.MatchType)
	}
	if query.MatchPayload != "" {
		params.Set("matchPayload", query.MatchPayload)
	}
	if query.Offset > 0 {
		params.Set("offset", strconv.Itoa(query.Offset))
	}
	params.Set("limit", strconv.Itoa(query.Limit))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://xbond-system/localapi/v0/remote/rules?"+params.Encode(), nil)
	if err != nil {
		return engine.RulePage{}, err
	}
	resp, err := d.http.Do(req)
	if err != nil {
		return engine.RulePage{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return engine.RulePage{}, fmt.Errorf("remote rules returned %d", resp.StatusCode)
	}
	var page engine.RulePage
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		return engine.RulePage{}, err
	}
	return page, nil
}

// Status returns the remote core's engine state, cached briefly so frequent
// status polling stays cheap. alive=false means the transport failed; the
// cached status is still returned so callers can show the last known truth.
func (d *delegateManager) Status() (engine.EngineStatus, bool) {
	d.mu.Lock()
	// The reconciler can adopt an unowned core only after checking live
	// status. A cached running reply may predate an explicit stop.
	fresh := d.active && time.Since(d.statusAt) < delegateStatusTTL
	status := d.lastStatus
	d.mu.Unlock()
	if fresh {
		return status, true
	}
	st, err := d.fetchStatus(context.Background())
	if err != nil {
		d.noteFailure(fmt.Errorf("delegated takeover unreachable: %w", err))
		return status, false
	}
	d.mu.Lock()
	d.lastStatus = st
	d.statusAt = time.Now()
	if st.Running {
		d.lastError = nil
		d.errLogged = false
	}
	d.mu.Unlock()
	return st, true
}

// Available probes the transport cheaply for the TUN capability gate.
// Reachability is the bar: a freshly installed service runs no core yet, and
// that must count as available — the delegation is what starts it. Results
// are cached for a couple of seconds: the gate runs on every apply and
// status poll, and a down service should not turn into a port scan.
func (d *delegateManager) Available() error {
	d.mu.Lock()
	fresh := time.Since(d.probeAt) < delegateProbeTTL
	ok := d.probeOK
	d.mu.Unlock()
	if fresh {
		if ok {
			return nil
		}
		return errors.New("system service unreachable")
	}
	st, err := d.fetchStatus(context.Background())
	d.mu.Lock()
	d.probeAt = time.Now()
	d.probeOK = err == nil
	if err != nil {
		d.lastError = fmt.Errorf("delegated takeover unreachable: %w", err)
	} else {
		d.lastError = nil
		d.errLogged = false
		d.lastStatus = st
		d.statusAt = time.Now()
	}
	d.mu.Unlock()
	return err
}

// Adopt marks an already-running delegated takeover as owned by this daemon
// (a user-daemon restart while the system service kept routing). The remote
// status supplies the ports; the config itself stays unknown to this process.
func (d *delegateManager) Adopt(st engine.EngineStatus) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.active = true
	d.lastConfig = nil
	d.lastMeta = engine.CoreMetadata{
		TakeoverMode: st.TakeoverMode,
		RoutingMode:  st.RoutingMode,
		MixedPort:    st.MixedPort,
		AllowLan:     st.AllowLan,
		ClashPort:    st.ClashPort,
		ClashSecret:  st.ClashSecret,
	}
	d.lastStatus = st
	d.statusAt = time.Now()
	d.lastError = nil
	d.errLogged = false
}

// CheckMachineService checks that this account can use the system service's
// delegation transport after the supervisor starts the process.
func CheckMachineService(ctx context.Context) error {
	manager := newDelegateManager(nil)
	defer manager.http.CloseIdleConnections()
	_, err := manager.fetchStatus(ctx)
	return err
}

func (d *delegateManager) fetchStatus(ctx context.Context) (engine.EngineStatus, error) {
	ctx, cancel := context.WithTimeout(ctx, privilegedProbeTimeout())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://xbond-system/localapi/v0/remote/status", nil)
	if err != nil {
		return engine.EngineStatus{}, err
	}
	resp, err := d.http.Do(req)
	if err != nil {
		return engine.EngineStatus{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return engine.EngineStatus{}, fmt.Errorf("remote status returned %d", resp.StatusCode)
	}
	var reply remoteReply
	if err := json.NewDecoder(resp.Body).Decode(&reply); err != nil {
		return engine.EngineStatus{}, err
	}
	if !reply.Ok {
		return engine.EngineStatus{}, fmt.Errorf("machine service rejected the status request: %s", reply.Error)
	}
	return reply.Status, nil
}

func (d *delegateManager) post(path string, body []byte, reply *remoteReply, extraHeaders map[string]string) error {
	ctx, cancel := context.WithTimeout(context.Background(), d.http.Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://xbond-system"+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for key, value := range extraHeaders {
		req.Header.Set(key, value)
	}
	resp, err := d.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		var errReply remoteReply
		_ = json.NewDecoder(resp.Body).Decode(&errReply)
		if errReply.Error != "" {
			return errors.New(errReply.Error)
		}
		return fmt.Errorf("returned %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(reply)
}

// noteFailure records a delegation failure and logs the transition once —
// a flapping transport must not flood the ring log, but the daemon-runtime
// spec's 不静默降级 requires the failure to be visible.
func (d *delegateManager) noteFailure(err error) {
	d.mu.Lock()
	d.lastError = err
	first := !d.errLogged
	d.errLogged = true
	d.mu.Unlock()
	if first {
		d.logf("%v", err)
	}
}
