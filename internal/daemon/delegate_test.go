package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/sysproxy"
)

// fakeMachineSession stands in for the machine-scoped daemon's delegation
// endpoints: it records what a delegator sent and answers with its own
// engine state, so the client contract runs against a known truth instead
// of the real SCM and core.
type fakeMachineSession struct {
	mu         sync.Mutex
	running    bool
	config     []byte
	applyErr   string
	stops      int
	applies    int
	selections map[string]string
}

func (s *fakeMachineSession) mux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/localapi/v0/remote/apply", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		payload, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, `{"error":"read failed"}`, http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		s.applies++
		s.selections = nil
		if raw := r.Header.Get(delegatedSelectionsHeader); raw != "" {
			var selections map[string]string
			if err := json.Unmarshal([]byte(raw), &selections); err == nil {
				s.selections = selections
			}
		}
		if s.applyErr != "" {
			writeJSON(w, http.StatusInternalServerError, remoteReply{Error: s.applyErr})
			return
		}
		s.running = true
		s.config = append([]byte(nil), payload...)
		writeJSON(w, http.StatusOK, remoteReply{Ok: true, Status: engine.EngineStatus{Running: true, TakeoverMode: engine.ModeTun, MixedPort: 17890, ClashPort: 19090, ClashSecret: "session-secret"}})
	})
	mux.HandleFunc("/localapi/v0/remote/stop", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.stops++
		s.running = false
		writeJSON(w, http.StatusOK, remoteReply{Ok: true})
	})
	mux.HandleFunc("/localapi/v0/remote/status", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		writeJSON(w, http.StatusOK, remoteReply{Ok: true, Status: engine.EngineStatus{Running: s.running, TakeoverMode: engine.ModeTun, MixedPort: 17890, ClashPort: 19090, ClashSecret: "session-secret"}})
	})
	return mux
}

func (s *fakeMachineSession) isRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

func (s *fakeMachineSession) applyCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.applies
}

func (s *fakeMachineSession) stopCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stops
}

func (s *fakeMachineSession) selectionsSnapshot() map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.selections
}

// The delegator must deliver the user's saved node selections with the
// runtime config: a delegated core that starts from group defaults silently
// resets every selector the user picked.
func TestDelegateApplyCarriesSelections(t *testing.T) {
	session := &fakeMachineSession{}
	srv := httptest.NewServer(session.mux())
	defer srv.Close()
	d := newTestDelegate(srv)

	config := derivedTUNConfig(t, 19090)
	if _, err := d.Apply(config, map[string]string{"🚀 节点选择": "Tokyo"}); err != nil {
		t.Fatal(err)
	}
	if sel := session.selectionsSnapshot(); sel["🚀 节点选择"] != "Tokyo" {
		t.Fatalf("selections header did not arrive: %v", sel)
	}

	// No selections → no header at all (the old wire shape stays valid).
	if _, err := d.Apply(config, nil); err != nil {
		t.Fatal(err)
	}
	if sel := session.selectionsSnapshot(); sel != nil {
		t.Fatalf("empty selections must not send the header: %v", sel)
	}
}

// A malformed selections header must be rejected, not silently treated as
// "no picks" — that silent drop is exactly the defect the header fixes.
func TestDelegatedSelectionsHeaderParsing(t *testing.T) {
	sel, err := delegatedSelectionsFromHeader("")
	if err != nil || sel != nil {
		t.Fatalf("empty header must parse to nil, got %v, %v", sel, err)
	}
	sel, err = delegatedSelectionsFromHeader(`{"A":"B"}`)
	if err != nil || sel["A"] != "B" {
		t.Fatalf("valid header did not parse: %v, %v", sel, err)
	}
	if _, err := delegatedSelectionsFromHeader("{nope"); err == nil {
		t.Fatal("malformed header must error, not silently drop")
	}
}

// setRunning simulates the machine session's own engine state changing
// outside a delegation call — an SCM/LaunchDaemon restart leaves it idle,
// a session that bootstrapped alone leaves it running.
func (s *fakeMachineSession) setRunning(v bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.running = v
}

// dialFor points a delegate manager's HTTP client at the fake session.
func dialFor(srv *httptest.Server) func(ctx context.Context, _, _ string) (net.Conn, error) {
	return func(ctx context.Context, _, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, "tcp", srv.Listener.Addr().String())
	}
}

func newTestDelegate(srv *httptest.Server) *delegateManager {
	d := newDelegateManager(engine.NewRingLogger(20))
	d.http = &http.Client{
		Transport: &http.Transport{DialContext: dialFor(srv)},
		Timeout:   5 * time.Second,
	}
	return d
}

// overrideSystemInstalled swaps the SCM lookup for the delegation tests;
// without it the paths are only reachable on a machine that actually has
// the service registered.
func overrideSystemInstalled(installed bool) func() {
	original := serviceSystemInstalled
	serviceSystemInstalled = func() bool { return installed }
	return func() { serviceSystemInstalled = original }
}

// derivedTUNConfig builds a real derived TUN runtime config so Apply's
// InspectConfig extraction runs against genuine derivation output.
func derivedTUNConfig(t *testing.T, clashPort int) []byte {
	t.Helper()
	source := []byte("proxies:\n  - name: delegate-me\n    type: trojan\n    server: example.invalid\n    port: 443\n    password: fixture-only\n")
	config, err := engine.DeriveRuntimeConfig(source, engine.ModeTun, engine.RoutingRule, 17890, false, clashPort, "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	if err := engine.Validate(config); err != nil {
		t.Fatal(err)
	}
	return config
}

func TestDelegateApplyStopLifecycle(t *testing.T) {
	session := &fakeMachineSession{}
	srv := httptest.NewServer(session.mux())
	defer srv.Close()
	d := newTestDelegate(srv)

	if d.Active() {
		t.Fatal("fresh manager already claims an active delegation")
	}
	status, err := d.Apply(derivedTUNConfig(t, 19090), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Running || !d.Active() {
		t.Fatal("apply did not report the delegated takeover as up")
	}
	if !session.isRunning() {
		t.Fatal("fake session did not start its core")
	}
	if d.ClashClient() == nil {
		t.Fatal("delegated manager lost the clash client")
	}
	// The ports ride the stored config, not the remote status reply.
	meta, err := engine.InspectConfig(d.LastConfig())
	if err != nil {
		t.Fatal(err)
	}
	if meta.ClashPort != 19090 || meta.TakeoverMode != engine.ModeTun {
		t.Fatalf("stored config metadata drifted: %+v", meta)
	}

	if err := d.Stop(); err != nil {
		t.Fatal(err)
	}
	if d.Active() || session.isRunning() {
		t.Fatal("stop left the delegated takeover running")
	}
	if session.stopCount() != 1 {
		t.Fatalf("stop reached the session %d times", session.stopCount())
	}
}

func TestDelegateReportsUnreachableSession(t *testing.T) {
	session := &fakeMachineSession{}
	srv := httptest.NewServer(session.mux())
	d := newTestDelegate(srv)
	if _, err := d.Apply(derivedTUNConfig(t, 19090), nil); err != nil {
		t.Fatal(err)
	}
	srv.Close() // the machine session died mid-session

	if err := d.Available(); err == nil {
		t.Fatal("a dead session passed the delegation probe")
	}
	if d.lastError == nil {
		t.Fatal("the failure was not recorded for status surfacing")
	}
	d.mu.Lock()
	d.statusAt = time.Time{} // expire the cached status from the apply
	d.mu.Unlock()
	if _, alive := d.Status(); alive {
		t.Fatal("status claimed the dead session is alive")
	}
}

func TestDelegateProbeRequiresSuccessfulStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, remoteReply{Error: "service unavailable"})
	}))
	defer srv.Close()
	if err := newTestDelegate(srv).Available(); err == nil {
		t.Fatal("an unsuccessful status reply passed the delegation probe")
	}
}

func TestDelegateApplyRefusesNonTUNConfig(t *testing.T) {
	session := &fakeMachineSession{}
	srv := httptest.NewServer(session.mux())
	defer srv.Close()
	d := newTestDelegate(srv)

	source := []byte("proxies:\n  - name: p\n    type: trojan\n    server: example.invalid\n    port: 443\n    password: x\n")
	config, err := engine.DeriveRuntimeConfig(source, engine.ModePort, engine.RoutingRule, 17891, false, 19091, "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.Apply(config, nil); err == nil {
		t.Fatal("a port-mode takeover was accepted for delegation")
	}
	if session.applyCount() != 0 {
		t.Fatal("rejected config reached the session")
	}
}

// The layered privilege contract end-to-end: an un-elevated daemon runs TUN
// in the machine session and tears it down with the connection; the local
// core idles for the duration. Adaptive like the privilege gate test: an
// elevated process runs TUN itself and never delegates.
func TestTUNTakeoverDelegatesToMachineSession(t *testing.T) {
	if localTunCapable() {
		t.Skip("running privileged; delegation is not the chosen path")
	}
	defer overrideSystemInstalled(true)()

	session := &fakeMachineSession{}
	srv := httptest.NewServer(session.mux())
	defer srv.Close()
	d := newTestDelegate(srv)

	f := newRuntimeFixture(t)
	f.controller.delegate = d

	if err := f.controller.Configure(context.Background(), runtimeOptions{Mode: engine.ModeTun}); err != nil {
		t.Fatal(err)
	}
	if !session.isRunning() || session.applyCount() != 1 {
		t.Fatalf("delegation did not reach the machine session (running=%v applies=%d)", session.isRunning(), session.applyCount())
	}
	if f.core.IsRunning() {
		t.Fatal("the local core kept running while takeover was delegated")
	}
	prefs := f.controller.Preferences()
	if !prefs.Tun || prefs.TakeoverMode != engine.ModeTun {
		t.Fatalf("preferences did not record the delegated intent: %+v", prefs)
	}
	if !f.controller.Delegated() {
		t.Fatal("the runtime does not report its delegated takeover")
	}

	// Re-applying an unchanged configuration must not bounce the remote core.
	if err := f.controller.Configure(context.Background(), runtimeOptions{}); err != nil {
		t.Fatal(err)
	}
	if session.applyCount() != 1 {
		t.Fatalf("unchanged apply reached the machine session again (%d times)", session.applyCount())
	}

	// The local core can still fail to bind after the machine listener
	// closes. Restore the previously working takeover in that case.
	f.core.reloadError = errors.New("local bind failed")
	err := f.controller.Configure(context.Background(), runtimeOptions{Mode: engine.ModePort})
	if err == nil || !strings.Contains(err.Error(), "local bind failed") {
		t.Fatalf("expected local startup failure, got %v", err)
	}
	if !session.isRunning() || session.applyCount() != 2 || f.core.IsRunning() || f.controller.Preferences() != prefs {
		t.Fatal("failed handoff did not restore the previous delegated takeover")
	}

	// Tearing the connection down also tears the machine-session takeover
	// down — no orphaned TUN keeps routing after `down`.
	if _, err := f.controller.Down(); err != nil {
		t.Fatal(err)
	}
	// A reconciler tick immediately after down must not adopt cached
	// running status and then restart the machine session.
	f.controller.ReconcileDelegation()
	if session.isRunning() {
		t.Fatal("down left the delegated takeover running in the machine session")
	}
	if f.controller.Delegated() {
		t.Fatal("down left the runtime claiming a delegated takeover")
	}
}

func TestSystemProxySwitchKeepsDelegatedCoreRunning(t *testing.T) {
	if localTunCapable() {
		t.Skip("running privileged; delegation is not the chosen path")
	}
	defer overrideSystemInstalled(true)()

	session := &fakeMachineSession{}
	srv := httptest.NewServer(session.mux())
	defer srv.Close()

	f := newRuntimeFixture(t)
	f.controller.delegate = newTestDelegate(srv)
	ctx := context.Background()
	if err := f.controller.Configure(ctx, runtimeOptions{Mode: engine.ModeTun}); err != nil {
		t.Fatal(err)
	}

	// Model the delegated core owning the controller port. Switching only
	// the system proxy must work with that listener still accepting.
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", f.controller.Preferences().ClashPort))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	proxy := sysproxy.Snapshot{}
	f.controller.proxyGet = func() (sysproxy.Snapshot, error) { return proxy, nil }
	f.controller.proxySet = func(server, _ string) error {
		proxy = sysproxy.Snapshot{Enabled: true, Server: server}
		return nil
	}
	f.controller.proxyRestore = func(snapshot sysproxy.Snapshot) error { proxy = snapshot; return nil }

	for _, enabled := range []bool{true, false} {
		if err := f.controller.Configure(ctx, runtimeOptions{SystemProxy: &enabled}); err != nil {
			t.Fatal(err)
		}
		prefs := f.controller.Preferences()
		if proxy.Enabled != enabled || prefs.SystemProxy != enabled || !prefs.Tun {
			t.Fatalf("proxy switch changed the wrong state: proxy=%v preferences=(proxy=%v, tun=%v)", proxy.Enabled, prefs.SystemProxy, prefs.Tun)
		}
	}
	if session.applyCount() != 1 || !session.isRunning() || f.core.IsRunning() {
		t.Fatal("switching the proxy restarted or moved the delegated core")
	}
}

// The gate must refuse honestly when the service is registered but the
// machine session does not answer: silent mixed-only is the exact failure
// the capability gate exists to prevent.
func TestTUNGateRejectsWhenMachineSessionUnreachable(t *testing.T) {
	if localTunCapable() {
		t.Skip("running privileged; the negative gate cannot be exercised")
	}
	defer overrideSystemInstalled(true)()

	// A session that accepts nothing: the transport is dead on arrival.
	closed := &fakeMachineSession{}
	srv := httptest.NewServer(closed.mux())
	srv.Close()
	d := newTestDelegate(srv)

	f := newRuntimeFixture(t)
	f.controller.delegate = d

	config := f.core.configuration()
	prefs := f.controller.Preferences()
	err := f.controller.Configure(context.Background(), runtimeOptions{Mode: engine.ModeTun})
	var inputErr *runtimeInputError
	if !errors.As(err, &inputErr) {
		t.Fatalf("unreachable machine session must fail as an input error, got: %v", err)
	}
	if !strings.Contains(err.Error(), "TUN takeover unavailable") || !strings.Contains(err.Error(), "not serving delegation") {
		t.Fatalf("gate error lacks the honest reason: %v", err)
	}
	if capability := tunCapability(d); capability.Tun || capability.ReasonCode != "service_unreachable" {
		t.Fatalf("capability gate misreported an unreachable session: %+v", capability)
	}
	if !f.core.IsRunning() || !bytes.Equal(config, f.core.configuration()) || f.controller.Preferences() != prefs {
		t.Fatal("the gate disturbed the running core or preferences")
	}
	if d.lastError == nil {
		t.Fatal("the delegation failure was not recorded")
	}
}

// After a user-daemon restart the takeover this process never started must
// show up in its state instead of the UI reporting idle while the machine
// session routes traffic.
func TestReconcileAdoptsRunningDelegation(t *testing.T) {
	if localTunCapable() {
		t.Skip("running privileged; delegation is not the chosen path")
	}
	defer overrideSystemInstalled(true)()

	session := &fakeMachineSession{}
	srv := httptest.NewServer(session.mux())
	defer srv.Close()
	d := newTestDelegate(srv)

	f := newRuntimeFixture(t)
	f.controller.delegate = d
	// The state a restarted daemon loads: intent persisted (Tun on), local
	// core stopped, machine session already routing.
	if _, err := f.controller.Down(); err != nil {
		t.Fatal(err)
	}
	if err := f.controller.Configure(context.Background(), runtimeOptions{Mode: engine.ModeTun}); err != nil {
		t.Fatal(err)
	}
	if f.controller.Delegated() {
		t.Fatal("intent with an idle session must not claim delegation before reconciliation")
	}
	session.setRunning(true) // the machine session kept routing

	f.controller.ReconcileDelegation()
	if !f.controller.Delegated() {
		t.Fatal("reconciliation did not adopt the running delegated takeover")
	}
	if session.applyCount() != 0 {
		t.Fatal("adoption re-applied a config to an already-running session")
	}
}

// An SCM/LaunchDaemon restart boots the machine session idle; the
// reconciler brings the delegated takeover back from the delegated config.
func TestReconcileReappliesAfterSessionRestart(t *testing.T) {
	if localTunCapable() {
		t.Skip("running privileged; delegation is not the chosen path")
	}
	defer overrideSystemInstalled(true)()

	session := &fakeMachineSession{}
	srv := httptest.NewServer(session.mux())
	defer srv.Close()
	d := newTestDelegate(srv)

	f := newRuntimeFixture(t)
	f.controller.delegate = d
	if err := f.controller.Configure(context.Background(), runtimeOptions{Mode: engine.ModeTun}); err != nil {
		t.Fatal(err)
	}
	if !f.controller.Delegated() {
		t.Fatal("delegation did not start")
	}
	session.mu.Lock()
	delegated := append([]byte(nil), session.config...)
	session.mu.Unlock()

	session.setRunning(false) // the service restarted and boots idle
	d.mu.Lock()
	d.statusAt = time.Time{} // let the reconciler observe the fresh state
	d.mu.Unlock()
	f.controller.ReconcileDelegation()

	if !session.isRunning() {
		t.Fatal("reconciliation did not re-apply the delegated takeover")
	}
	if session.applyCount() != 2 {
		t.Fatalf("re-apply reached the session %d times", session.applyCount())
	}
	// The delegated config rode the pipe again, byte for byte.
	session.mu.Lock()
	reapplied := append([]byte(nil), session.config...)
	session.mu.Unlock()
	if !bytes.Equal(delegated, reapplied) {
		t.Fatal("re-applied config drifted from the delegated one")
	}
}

// Delegation endpoints live only on the privileged transport's mux: the
// token-authenticated TCP listener must not serve them at all.
func TestRemoteRoutesOnlyOnPrivilegedMux(t *testing.T) {
	server := &Server{engineMgr: engine.NewManager(10)}

	tcpMux := http.NewServeMux()
	server.registerRoutes(tcpMux)
	remoteMux := http.NewServeMux()
	server.registerRemoteRoutes(remoteMux)

	for _, path := range []string{
		"/localapi/v0/remote/status",
		"/localapi/v0/remote/apply",
		"/localapi/v0/remote/stop",
		"/localapi/v0/remote/logs",
	} {
		response := httptest.NewRecorder()
		tcpMux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s answered %d on the TCP mux; delegation must be transport-only", path, response.Code)
		}
	}

	response := httptest.NewRecorder()
	remoteMux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/localapi/v0/remote/status", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("privileged status endpoint returned %d: %s", response.Code, response.Body)
	}
	var reply remoteReply
	if err := json.Unmarshal(response.Body.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	if !reply.Ok || reply.Status.Running {
		t.Fatalf("idle system session reported a running core: %+v", reply)
	}
}
