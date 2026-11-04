package daemon

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/openxbond/xbond/internal/account"
	"github.com/openxbond/xbond/internal/daemon/service"
	"github.com/openxbond/xbond/internal/diag"
	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/platform/sysproxy"
	"github.com/openxbond/xbond/internal/sub"
)

type Server struct {
	httpServer *http.Server
	listener   net.Listener
	token      string
	addr       string

	engineMgr *engine.Manager
	subMgr    *sub.Manager
	runtime   *runtimeController
	account   *accountController
	// delegate drives the layered-privilege client side (user-session
	// daemons): TUN takeover applied by the machine-scoped daemon.
	delegate *delegateManager

	// System-scope only: the machine-scoped daemon additionally serves its
	// delegation endpoints on the privileged transport (pipe / socket).
	systemScope  bool
	privileged   net.Listener
	remoteServer *http.Server

	webDir string
	done   chan struct{}
	// shutdownCh is closed when a LocalAPI client asked the daemon to exit
	// (service stop); the daemon main loop watches it beside OS signals.
	shutdownCh   chan struct{}
	shutdownOnce sync.Once
	stopOnce     sync.Once
	stopErr      error
	lock         *instanceLock
}

// NewServer builds the per-user control service.
func NewServer(addr string, webDir string) (*Server, error) {
	return newServer(addr, webDir, false)
}

// NewSystemServer builds the machine-scoped daemon: the same LocalAPI on its
// fixed listen, plus the delegation endpoints on the privileged transport
// whose caller identity the transport itself verifies.
func NewSystemServer(addr string, webDir string) (*Server, error) {
	return newServer(addr, webDir, true)
}

func newServer(addr string, webDir string, systemScope bool) (*Server, error) {
	// The lock must exist before proxy recovery and discovery-file writes:
	// a second instance must never fight over ports, system proxy, or the
	// credential files.
	lock, err := acquireInstanceLock(paths.DataDir())
	if err != nil {
		return nil, err
	}

	if err := paths.EnsureDirs(); err != nil {
		lock.Release()
		return nil, err
	}

	if err := sysproxy.AutoRecoverOnStartup(); err != nil {
		lock.Release()
		return nil, err
	}

	prefs, err := LoadPreferences()
	if err != nil {
		return nil, err
	}

	subMgr, err := sub.NewManager()
	if err != nil {
		return nil, err
	}
	// Before anything can apply a runtime config: stored sing-box JSON
	// sources must become the canonical Clash YAML the mihomo core expects.
	subMgr.MigrateLegacySources()

	tokenBytes := make([]byte, 16)
	_, _ = rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	core := engine.NewManager(1000)
	s := &Server{
		token:       token,
		engineMgr:   core,
		subMgr:      subMgr,
		runtime:     newRuntimeController(core, subMgr, prefs),
		webDir:      webDir,
		done:        make(chan struct{}),
		shutdownCh:  make(chan struct{}),
		lock:        lock,
		systemScope: systemScope,
	}
	s.account = newAccountController(
		account.NewManager(paths.AccountSessionPath()),
		s.bindCredentials,
		s.runtime.LogoutAccount,
		s.activeXBondSub,
	)

	if s.webDir == "" {
		s.webDir = "dist"
	}

	if addr == "" {
		addr = "127.0.0.1:0"
	}

	l, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	s.listener = l
	s.addr = l.Addr().String()

	mux := http.NewServeMux()
	s.registerRoutes(mux)

	s.httpServer = &http.Server{
		Handler: mux,
	}

	if systemScope {
		remoteMux := http.NewServeMux()
		s.registerRemoteRoutes(remoteMux)
		s.remoteServer = &http.Server{Handler: remoteMux}
		if s.privileged, err = listenPrivileged(); err != nil {
			// The TCP LocalAPI still serves diagnostics; only delegation is
			// unavailable, and delegators report that honestly.
			core.RingLog().Append(engine.LogLevelError, fmt.Sprintf("privileged transport unavailable: %v", err))
			s.privileged = nil
		}
	} else {
		s.delegate = newDelegateManager(core.RingLog())
		s.runtime.delegate = s.delegate
	}

	_ = os.WriteFile(paths.LocalAPITokenPath(), []byte(token), 0o600)
	_ = os.WriteFile(paths.LocalAPIAddrPath(), []byte(s.addr), 0o600)

	return s, nil
}

func (s *Server) Addr() string {
	return s.addr
}

func (s *Server) Token() string {
	return s.token
}

// Autostart brings the active subscription's core up after boot when the
// deployment environment asks for it (XBOND_AUTOSTART=1, the container
// default): a proxy container that stays down after `docker restart` is a
// footgun. Desktop keeps the explicit connect — env-free hosts never call
// this. A failure is logged by the caller and does not kill the daemon: the
// UI still works and the user can retry the connect.
func (s *Server) Autostart(ctx context.Context) error {
	if s.subMgr.ActiveID() == "" {
		return nil
	}
	if err := s.runtime.Up(ctx, runtimeOptions{}); err != nil {
		return err
	}
	return nil
}

func (s *Server) Start() error {
	go s.runScheduledUpdates()
	if s.delegate != nil {
		go s.runDelegateReconciler()
	}
	if s.privileged != nil && s.remoteServer != nil {
		go func() {
			if err := s.remoteServer.Serve(s.privileged); err != nil && err != http.ErrServerClosed {
				fmt.Printf("privileged transport failed: %v\n", err)
			}
		}()
	}
	return s.httpServer.Serve(s.listener)
}

// ShutdownRequested is closed when a LocalAPI client asked the daemon to exit.
func (s *Server) ShutdownRequested() <-chan struct{} {
	return s.shutdownCh
}

func (s *Server) Stop(ctx context.Context) error {
	s.stopOnce.Do(func() {
		close(s.done)
		defer s.lock.Release()

		s.account.cancelPending()
		_, runtimeErr := s.runtime.Down()

		_ = os.Remove(paths.LocalAPITokenPath())
		_ = os.Remove(paths.LocalAPIAddrPath())

		var remoteErr error
		if s.remoteServer != nil {
			remoteErr = s.remoteServer.Shutdown(ctx)
		}
		// The runtime teardown already happened above: a listener that
		// cannot drain in-flight requests within the deadline is closed
		// hard instead of reporting failure — the process is exiting, and a
		// failure exit code makes the supervisors (Restart=on-failure /
		// SuccessfulExit=false / SCM recovery) restart the daemon the user
		// just stopped.
		_ = s.httpServer.Shutdown(ctx)
		s.stopErr = errors.Join(runtimeErr, remoteErr)
	})
	return s.stopErr
}

func (s *Server) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-XBond-Token")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		token := r.Header.Get("X-XBond-Token")
		if token != s.token {
			http.Error(w, `{"error": "unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// coreStatus reports the engine state of wherever the takeover runs: the
// machine session's core while delegated, the local one otherwise.
func (s *Server) coreStatus() engine.EngineStatus {
	if s.runtime.Delegated() && s.delegate != nil {
		if status, alive := s.delegate.Status(); alive {
			return status
		}
	}
	return s.engineMgr.Status()
}

// coreClient addresses the running core's clash API. The delegated core
// binds the same loopback controller port the local one would, so clients
// never learn where the core actually runs.
func (s *Server) coreClient() *engine.ClashClient {
	if s.runtime.Delegated() && s.delegate != nil {
		if client := s.delegate.ClashClient(); client != nil {
			return client
		}
	}
	return s.engineMgr.Client()
}

func (s *Server) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/localapi/v0/status", s.authMiddleware(s.handleStatus))
	mux.HandleFunc("/localapi/v0/up", s.authMiddleware(s.handleUp))
	mux.HandleFunc("/localapi/v0/down", s.authMiddleware(s.handleDown))
	mux.HandleFunc("/localapi/v0/restart", s.authMiddleware(s.handleRestart))
	mux.HandleFunc("/localapi/v0/mode", s.authMiddleware(s.handleMode))

	mux.HandleFunc("/localapi/v0/login", s.authMiddleware(s.handleLogin))
	mux.HandleFunc("/localapi/v0/logout", s.authMiddleware(s.handleLogout))
	mux.HandleFunc("/localapi/v0/account", s.authMiddleware(s.handleAccountStatus))
	mux.HandleFunc("/localapi/v0/account/login", s.authMiddleware(s.handleAccountLogin))
	mux.HandleFunc("/localapi/v0/account/logout", s.authMiddleware(s.handleAccountLogout))
	mux.HandleFunc("/localapi/v0/account/refresh", s.authMiddleware(s.handleAccountRefresh))
	mux.HandleFunc("/localapi/v0/account/cancel", s.authMiddleware(s.handleAccountCancel))

	mux.HandleFunc("/localapi/v0/subs", s.authMiddleware(s.handleSubs))
	mux.HandleFunc("/localapi/v0/subs/use", s.authMiddleware(s.handleSubUse))
	mux.HandleFunc("/localapi/v0/subs/update", s.authMiddleware(s.handleSubUpdate))
	mux.HandleFunc("/localapi/v0/subs/override", s.authMiddleware(s.handleSubOverride))
	mux.HandleFunc("/localapi/v0/subs/versions", s.authMiddleware(s.handleSubVersions))
	mux.HandleFunc("/localapi/v0/subs/rollback", s.authMiddleware(s.handleSubRollback))
	mux.HandleFunc("/localapi/v0/subs/source", s.authMiddleware(s.handleSubSource))
	mux.HandleFunc("/localapi/v0/subs/url", s.authMiddleware(s.handleSubURL))
	mux.HandleFunc("/localapi/v0/subs/unpin", s.authMiddleware(s.handleSubUnpin))
	mux.HandleFunc("/localapi/v0/subs/progress", s.authMiddleware(s.handleSubsProgress))
	mux.HandleFunc("/localapi/v0/mixins/global", s.authMiddleware(s.handleGlobalMixin))
	mux.HandleFunc("/localapi/v0/profiles", s.authMiddleware(s.handleProfiles))

	mux.HandleFunc("/localapi/v0/nodes", s.authMiddleware(s.handleNodes))
	mux.HandleFunc("/localapi/v0/nodes/select", s.authMiddleware(s.handleNodeSelect))
	mux.HandleFunc("/localapi/v0/nodes/test", s.authMiddleware(s.handleNodeTest))

	mux.HandleFunc("/localapi/v0/connections", s.authMiddleware(s.handleConnections))
	mux.HandleFunc("/localapi/v0/rules", s.authMiddleware(s.handleRules))
	mux.HandleFunc("/localapi/v0/rules/page", s.authMiddleware(s.handleRulesPage))
	mux.HandleFunc("/localapi/v0/dns/query", s.authMiddleware(s.handleDNSQuery))
	mux.HandleFunc("/localapi/v0/dns/flush", s.authMiddleware(s.handleDNSFlush))
	mux.HandleFunc("/localapi/v0/logs", s.authMiddleware(s.handleLogs))

	mux.HandleFunc("/localapi/v0/doctor", s.authMiddleware(s.handleDoctor))
	mux.HandleFunc("/localapi/v0/bugreport", s.authMiddleware(s.handleBugReport))
	mux.HandleFunc("/localapi/v0/shutdown", s.authMiddleware(s.handleShutdown))
	mux.HandleFunc("/localapi/v0/service/install", s.authMiddleware(s.handleServiceInstall))
	mux.HandleFunc("/localapi/v0/service/uninstall", s.authMiddleware(s.handleServiceUninstall))

	// Web UI static files
	mux.HandleFunc("/", s.handleWeb)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	prefs := s.runtime.Preferences()

	status := s.coreStatus()
	var threeTier diag.ThreeTierStatus
	// light=1 keeps readiness probes and polling loops off the network: the
	// full evaluation runs DNS and egress checks, which is doctor's job.
	if r.URL.Query().Get("light") != "1" {
		threeTier = diag.EvaluateThreeTier(ctx, s.coreClient(), s.coreStatus(), prefs.TakeoverMode, prefs.RoutingMode, prefs.MixedPort)
	}

	var activeSub *sub.SubscriptionMeta
	if s.subMgr.ActiveID() != "" {
		activeSub, _ = s.subMgr.Get(s.subMgr.ActiveID())
	}

	response := map[string]any{
		"engine":       status,
		"preferences":  prefs,
		"threeTier":    threeTier,
		"activeSub":    activeSub,
		"capabilities": tunCapability(s.delegate),
		"rulePaging":   true,
	}

	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleUp(w http.ResponseWriter, r *http.Request) {
	var options runtimeOptions
	if !decodeRuntimeRequest(w, r, &options) {
		return
	}
	if err := s.runtime.Up(r.Context(), options); err != nil {
		writeRuntimeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": s.coreStatus(), "preferences": s.runtime.Preferences()})
}

func (s *Server) handleDown(w http.ResponseWriter, r *http.Request) {
	stopped, err := s.runtime.Down()
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stopped": stopped})
}

func (s *Server) handleRestart(w http.ResponseWriter, r *http.Request) {
	if err := s.runtime.Restart(r.Context()); err != nil {
		writeRuntimeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": s.coreStatus(), "preferences": s.runtime.Preferences()})
}

func (s *Server) handleMode(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, s.runtime.Preferences())
		return
	}
	var options runtimeOptions
	if !decodeRuntimeRequest(w, r, &options) {
		return
	}
	if err := s.runtime.Configure(r.Context(), options); err != nil {
		writeRuntimeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "preferences": s.runtime.Preferences()})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token               string   `json:"token"`
		Origin              string   `json:"origin"`
		FallbackOrigins     []string `json:"fallbackOrigins"`
		Protocol            string   `json:"protocol"`
		Lang                string   `json:"lang"`
		Name                string   `json:"name"`
		URLOrFile           string   `json:"urlOrFile"`
		Content             string   `json:"content"`
		UpdateIntervalHours *int     `json:"updateIntervalHours"`
		Use                 *bool    `json:"use"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	meta, updateErrMsg, err := s.bindSubscription(
		r.Context(),
		req.Token,
		req.Origin,
		req.FallbackOrigins,
		req.Protocol,
		req.Lang,
		req.Name,
		req.URLOrFile,
		req.Content,
		req.UpdateIntervalHours,
		req.Use == nil || *req.Use,
	)
	if err != nil {
		var bindErr *bindError
		if errors.As(err, &bindErr) && !bindErr.input {
			writeRuntimeError(w, err)
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": meta, "updateError": updateErrMsg})
}

type bindError struct {
	err   error
	input bool
}

func (e *bindError) Error() string { return e.err.Error() }
func (e *bindError) Unwrap() error { return e.err }

// bindSubscription adds or updates a subscription and applies its initial
// config. A fetch failure is reported through updateErrMsg, not as an error:
// the credentials stay saved so a later update can retry.
func (s *Server) bindSubscription(
	ctx context.Context,
	token, origin string,
	fallbackOrigins []string,
	protocol, lang, name, urlOrFile, content string,
	updateIntervalHours *int,
	activate bool,
) (*sub.SubscriptionMeta, string, error) {
	if token == "" && urlOrFile == "" && content == "" {
		return nil, "", &bindError{err: errors.New("must provide token, content or urlOrFile"), input: true}
	}
	if updateIntervalHours != nil {
		if err := sub.ValidateUpdateInterval(*updateIntervalHours); err != nil {
			return nil, "", &bindError{err: err, input: true}
		}
	}
	if token != "" && name == "" {
		for _, item := range s.subMgr.List() {
			if item.Type == sub.SubTypeXBond && item.Token == token {
				name = item.Name
				break
			}
		}
	}

	var meta *sub.SubscriptionMeta
	var err error
	switch {
	case token != "":
		meta, err = s.subMgr.AddXBond(token, origin, fallbackOrigins, protocol, lang, name, 24, false)
	case content != "":
		meta, err = s.subMgr.AddUniversalContent(content, name, 24, false)
	default:
		meta, err = s.subMgr.AddUniversal(urlOrFile, name, 24, false)
	}
	if err != nil {
		return nil, "", &bindError{err: err, input: true}
	}

	finalMeta := meta
	if updateIntervalHours != nil || (token == "" && content == "" && (strings.HasPrefix(urlOrFile, "https://") || strings.HasPrefix(urlOrFile, "http://"))) {
		hours := 24
		if updateIntervalHours != nil {
			hours = *updateIntervalHours
		}
		if err := s.subMgr.SetUpdateSchedule(meta.ID, hours); err != nil {
			return nil, "", err
		}
		finalMeta, err = s.subMgr.Get(meta.ID)
		if err != nil {
			return nil, "", err
		}
	}
	res, updateErr := s.runtime.Update(ctx, meta.ID, true, nil)
	updateErrMsg := ""
	if updateErr != nil {
		updateErrMsg = updateErr.Error()
	} else if res != nil && res.Meta != nil {
		finalMeta = res.Meta
		if activate {
			if err := s.runtime.Use(ctx, meta.ID); err != nil {
				return finalMeta, updateErrMsg, &bindError{err: err, input: false}
			}
		}
	}
	return finalMeta, updateErrMsg, nil
}

func (s *Server) bindCredentials(
	ctx context.Context,
	credentials *account.Credentials,
	options accountBindOptions,
) (*sub.SubscriptionMeta, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	issuer := credentials.Issuer
	if issuer == "" {
		issuer = credentials.Origin
	}
	meta, err := s.subMgr.BindAccount(credentials.SubscriptionToken, issuer, credentials.Origin, credentials.FallbackOrigins, options.Protocol, options.Lang, options.Name)
	if err != nil {
		return nil, "", err
	}
	result, err := s.runtime.Update(ctx, meta.ID, true, nil)
	if err != nil {
		return meta, err.Error(), nil
	}
	if options.Use {
		if err := s.runtime.Use(ctx, meta.ID); err != nil {
			return result.Meta, "", &bindError{err: err, input: false}
		}
	}
	return result.Meta, "", nil
}

func (s *Server) activeXBondSub() *sub.SubscriptionMeta {
	activeID := s.subMgr.ActiveID()
	var first *sub.SubscriptionMeta
	for _, item := range s.subMgr.List() {
		if item.Type != sub.SubTypeXBond || item.AccountIssuer == "" {
			continue
		}
		copy := item
		if item.ID == activeID {
			return &copy
		}
		if first == nil {
			first = &copy
		}
	}
	return first
}

// handleSubsProgress exposes the in-flight subscription download so clients
// blocked on login/update can render progress instead of a silent wait.
func (s *Server) handleSubsProgress(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, s.subMgr.Progress())
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	removed, err := s.account.logout(r.Context())
	if err != nil {
		writeRuntimeError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "loggedOut": true, "removed": removed})
}

func (s *Server) handleSubs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPatch:
		var req struct {
			ID                  string `json:"id"`
			Name                string `json:"name"`
			UpdateChannel       string `json:"updateChannel"`
			UpdateProxy         string `json:"updateProxy"`
			UpdateIntervalHours *int   `json:"updateIntervalHours"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid subscription patch request")
			return
		}
		if req.Name != "" {
			if err := s.subMgr.Rename(req.ID, req.Name); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		if req.UpdateChannel != "" {
			if err := s.subMgr.SetUpdateChannel(req.ID, req.UpdateChannel, req.UpdateProxy); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		if req.UpdateIntervalHours != nil {
			if err := s.subMgr.SetUpdateSchedule(req.ID, *req.UpdateIntervalHours); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	case http.MethodGet:
		list := s.subMgr.List()
		activeID := s.subMgr.ActiveID()
		writeJSON(w, http.StatusOK, map[string]any{"activeId": activeID, "subscriptions": list})

	case http.MethodPost:
		var req struct {
			Type            sub.SubscriptionType `json:"type"`
			Token           string               `json:"token"`
			Origin          string               `json:"origin"`
			FallbackOrigins []string             `json:"fallbackOrigins"`
			Protocol        string               `json:"protocol"`
			Lang            string               `json:"lang"`
			Name            string               `json:"name"`
			URLOrFile       string               `json:"urlOrFile"`
			IntervalHours   int                  `json:"intervalHours"`
			Use             bool                 `json:"use"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		var meta *sub.SubscriptionMeta
		var err error
		if req.Type == sub.SubTypeXBond || req.Token != "" {
			// XBond subscriptions come from the login/bind flow, which owns
			// the OAuth session; the generic import path stays universal.
			writeError(w, http.StatusBadRequest, "XBond subscriptions are added through the login flow")
			return
		}
		meta, err = s.subMgr.AddUniversal(req.URLOrFile, req.Name, req.IntervalHours, false)

		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		// Initial update. The response spells out every side effect —
		// activation, whether the running core switched, and a failed
		// initial fetch — so the CLI can report what actually happened.
		res, updateErr := s.runtime.Update(r.Context(), meta.ID, true, nil)
		updateErrMsg := ""
		if updateErr != nil {
			updateErrMsg = updateErr.Error()
			// Saving a source is not activation: even a stopped core must
			// wait for successful conversion and validation before using it.
			writeJSON(w, http.StatusOK, map[string]any{"meta": meta, "activated": false, "reloaded": false, "updateError": updateErrMsg})
			return
		}
		activated := false
		reloaded := false
		if req.Use {
			if err := s.runtime.Use(r.Context(), meta.ID); err != nil {
				writeRuntimeError(w, err)
				return
			}
			activated = true
			reloaded = s.runtime.engine.IsRunning()
		}
		if res != nil && res.Meta != nil {
			meta = res.Meta
		}

		writeJSON(w, http.StatusOK, map[string]any{"meta": meta, "activated": activated, "reloaded": reloaded, "updateError": updateErrMsg})

	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if id == "" {
			writeError(w, http.StatusBadRequest, "missing subscription id")
			return
		}
		if err := s.runtime.Remove(id); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": id})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleSubUse(w http.ResponseWriter, r *http.Request) {
	var request struct {
		ID string `json:"id"`
	}
	if !decodeRuntimeRequest(w, r, &request) {
		return
	}
	if request.ID == "" {
		writeError(w, http.StatusBadRequest, "missing subscription id")
		return
	}
	if err := s.runtime.Use(r.Context(), request.ID); err != nil {
		writeRuntimeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "activeId": s.subMgr.ActiveID()})
}

// handleSubOverride reads (GET) or saves (PUT/POST) a subscription's
// structured local override. Saving validates the merged document against
// the stored source, so a conflicting override is rejected up front; when
// the subscription is active and the core runs, the change re-applies
// immediately.
func (s *Server) handleSubOverride(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		id := r.URL.Query().Get("id")
		if id == "" {
			writeError(w, http.StatusBadRequest, "missing subscription id")
			return
		}
		override, err := s.subMgr.Override(id)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if override == nil {
			override = &engine.SubscriptionOverride{}
		}
		writeJSON(w, http.StatusOK, override)
	case http.MethodPut, http.MethodPost:
		var request struct {
			ID           string   `json:"id"`
			RulesPrepend []string `json:"rulesPrepend"`
			RulesAppend  []string `json:"rulesAppend"`
			DNS          string   `json:"dns"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid override request")
			return
		}
		if request.ID == "" {
			writeError(w, http.StatusBadRequest, "missing subscription id")
			return
		}
		override := &engine.SubscriptionOverride{
			RulesPrepend: request.RulesPrepend,
			RulesAppend:  request.RulesAppend,
			DNS:          request.DNS,
		}
		if err := s.subMgr.SetOverride(request.ID, override); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if s.subMgr.ActiveID() == request.ID && s.engineMgr.IsRunning() {
			if err := s.runtime.Configure(r.Context(), runtimeOptions{}); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleGlobalMixin reads (GET) or updates (PUT/POST) system-wide mixin rules and DNS.
func (s *Server) handleGlobalMixin(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		mixin, err := s.subMgr.GlobalMixin()
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if mixin == nil {
			mixin = &engine.GlobalMixin{}
		}
		writeJSON(w, http.StatusOK, mixin)
	case http.MethodPut, http.MethodPost:
		var mixin engine.GlobalMixin
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&mixin); err != nil {
			writeError(w, http.StatusBadRequest, "invalid global mixin request")
			return
		}
		if err := s.subMgr.SetGlobalMixin(&mixin); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if s.subMgr.ActiveID() != "" && s.engineMgr.IsRunning() {
			if err := s.runtime.Configure(r.Context(), runtimeOptions{}); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "mixin": mixin})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleProfiles provides a unified RESTful endpoint for profile listing and adding.
func (s *Server) handleProfiles(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list := s.subMgr.List()
		activeID := s.subMgr.ActiveID()
		writeJSON(w, http.StatusOK, map[string]any{
			"activeProfileId": activeID,
			"activeId":        activeID,
			"profiles":        list,
			"subscriptions":   list,
		})
	case http.MethodPost:
		var req struct {
			Kind          sub.ProfileKind `json:"kind"`
			Name          string          `json:"name"`
			URL           string          `json:"url"`
			Content       string          `json:"content"`
			IntervalHours int             `json:"intervalHours"`
			Use           bool            `json:"use"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		var meta *sub.SubscriptionMeta
		var err error
		if req.Kind == sub.KindInline || req.Content != "" {
			meta, err = s.subMgr.AddUniversalContent(req.Content, req.Name, 0, false)
		} else {
			meta, err = s.subMgr.AddUniversal(req.URL, req.Name, req.IntervalHours, false)
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		res, updateErr := s.runtime.Update(r.Context(), meta.ID, true, nil)
		updateErrMsg := ""
		if updateErr != nil {
			updateErrMsg = updateErr.Error()
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":          false,
				"meta":        meta,
				"profile":     meta,
				"activated":   false,
				"updateError": updateErrMsg,
			})
			return
		}
		activated := false
		if req.Use {
			if err := s.runtime.Use(r.Context(), meta.ID); err != nil {
				writeRuntimeError(w, err)
				return
			}
			activated = true
		}
		if res != nil && res.Meta != nil {
			meta = res.Meta
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":          true,
			"meta":        meta,
			"profile":     meta,
			"activated":   activated,
			"updateError": updateErrMsg,
		})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleSubVersions lists the stored previous source versions of a
// subscription, newest first.
func (s *Server) handleSubVersions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing subscription id")
		return
	}
	versions, err := s.subMgr.Versions(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": versions})
}

// handleSubRollback restores the newest previous source version of a
// subscription. The rollback is at the source layer — override and
// daemon-owned derivation stay applied. When the subscription is active and
// the core runs, the restored source re-applies immediately.
func (s *Server) handleSubRollback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var request struct {
		ID string `json:"id"`
	}
	if !decodeRuntimeRequest(w, r, &request) {
		return
	}
	if request.ID == "" {
		writeError(w, http.StatusBadRequest, "missing subscription id")
		return
	}
	meta, err := s.subMgr.Rollback(request.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if s.subMgr.ActiveID() == request.ID && s.engineMgr.IsRunning() {
		if err := s.runtime.Configure(r.Context(), runtimeOptions{}); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": meta})
}

func (s *Server) handleSubUpdate(w http.ResponseWriter, r *http.Request) {
	var request struct {
		ID       string `json:"id"`
		Force    bool   `json:"force"`
		ViaProxy *bool  `json:"viaProxy"`
		All      bool   `json:"all"`
	}
	if !decodeRuntimeRequest(w, r, &request) {
		return
	}
	if request.All {
		// Always 200: a batch keeps every per-item outcome (results and
		// failures) instead of collapsing partial failure into one error
		// status. The caller decides what a failure rate means.
		result := sub.BatchUpdateResult{
			Results:  make([]sub.UpdateResult, 0),
			Failures: make([]sub.UpdateFailure, 0),
		}
		for _, item := range s.subMgr.List() {
			res, err := s.runtime.Update(r.Context(), item.ID, request.Force, request.ViaProxy)
			if res != nil {
				result.Results = append(result.Results, *res)
			}
			if err != nil {
				result.Failures = append(result.Failures, sub.UpdateFailure{ID: item.ID, Name: item.Name, Error: err.Error()})
			}
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	result, err := s.runtime.Update(r.Context(), request.ID, request.Force, request.ViaProxy)
	if err != nil {
		writeRuntimeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleNodes(w http.ResponseWriter, r *http.Request) {
	if s.coreClient() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	proxies, err := s.coreClient().GetProxies(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, proxies)
}

func (s *Server) handleNodeSelect(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Group string `json:"group"`
		Node  string `json:"node"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if s.coreClient() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	if err := s.coreClient().SelectNode(r.Context(), req.Group, req.Node); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Persist to current active subscription's saved selections
	if activeID := s.subMgr.ActiveID(); activeID != "" {
		_ = s.subMgr.SaveSelection(activeID, req.Group, req.Node)
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "group": req.Group, "node": req.Node})
}

func (s *Server) handleNodeTest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Node      string `json:"node"`
		URL       string `json:"url"`
		TimeoutMs int    `json:"timeoutMs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if s.coreClient() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	delay, err := s.coreClient().TestDelay(r.Context(), req.Node, req.URL, req.TimeoutMs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"node": req.Node, "delay": delay})
}

func (s *Server) handleConnections(w http.ResponseWriter, r *http.Request) {
	if s.coreClient() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	switch r.Method {
	case http.MethodGet:
		conns, err := s.coreClient().GetConnections(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, conns)

	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if id == "" || id == "all" {
			_ = s.coreClient().CloseAllConnections(r.Context())
		} else {
			_ = s.coreClient().CloseConnection(r.Context(), id)
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func (s *Server) handleRules(w http.ResponseWriter, r *http.Request) {
	if s.coreClient() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	rules, err := s.coreClient().GetRules(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"rules": rules})
}

func (s *Server) handleRulesPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	params := r.URL.Query()
	query := engine.RuleQuery{
		Limit:        50,
		Search:       params.Get("q"),
		MatchType:    params.Get("matchType"),
		MatchPayload: params.Get("matchPayload"),
	}
	if params.Has("offset") {
		offset, err := strconv.Atoi(params.Get("offset"))
		if err != nil || offset < 0 {
			writeError(w, http.StatusBadRequest, "invalid rule offset")
			return
		}
		query.Offset = offset
	}
	if params.Has("limit") {
		limit, err := strconv.Atoi(params.Get("limit"))
		if err != nil || limit < 1 || limit > 100 {
			writeError(w, http.StatusBadRequest, "invalid rule limit")
			return
		}
		query.Limit = limit
	}
	// The delegated core's rules live in the machine session; a local-only
	// read would 503 exactly while the user is connected (same shape as
	// handleLogs).
	if s.runtime.Delegated() && s.delegate != nil {
		page, err := s.delegate.RulesPage(query)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, fmt.Sprintf("delegated rules unavailable: %v", err))
			return
		}
		writeJSON(w, http.StatusOK, page)
		return
	}
	page, ok := s.engineMgr.RulesPage(query)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// ruleQueryFromRequest parses the shared rules-page query parameters for
// both the LocalAPI handler and the privileged remote/rules endpoint.
func ruleQueryFromRequest(r *http.Request) (engine.RuleQuery, error) {
	params := r.URL.Query()
	query := engine.RuleQuery{
		Limit:        50,
		Search:       params.Get("q"),
		MatchType:    params.Get("matchType"),
		MatchPayload: params.Get("matchPayload"),
	}
	if params.Has("offset") {
		offset, err := strconv.Atoi(params.Get("offset"))
		if err != nil || offset < 0 {
			return query, errors.New("invalid rule offset")
		}
		query.Offset = offset
	}
	if params.Has("limit") {
		limit, err := strconv.Atoi(params.Get("limit"))
		if err != nil || limit < 1 || limit > 100 {
			return query, errors.New("invalid rule limit")
		}
		query.Limit = limit
	}
	return query, nil
}

func (s *Server) handleDNSQuery(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Domain string `json:"domain"`
		Type   string `json:"type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if s.coreClient() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	resp, err := s.coreClient().QueryDNS(r.Context(), req.Domain, req.Type)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleDNSFlush(w http.ResponseWriter, r *http.Request) {
	if s.coreClient() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	if err := s.coreClient().FlushFakeIP(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "flushed": true})
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	level := engine.LogLevel(r.URL.Query().Get("level"))
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}
	logs := s.engineMgr.RingLog().Snapshot(level, limit)
	// The delegated core logs into the machine session's ring; a local-only
	// snapshot would hide exactly the lines that explain a takeover failure.
	if s.runtime.Delegated() && s.delegate != nil {
		if remote, err := s.delegate.Logs(level, limit); err == nil {
			logs = mergeLogs(logs, remote, limit)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
}

// mergeLogs interleaves both rings newest-first and trims to the limit.
func mergeLogs(a, b []engine.LogEntry, limit int) []engine.LogEntry {
	merged := make([]engine.LogEntry, 0, len(a)+len(b))
	i, j := 0, 0
	for i < len(a) && j < len(b) && len(merged) < limit {
		if a[i].Timestamp.After(b[j].Timestamp) {
			merged = append(merged, a[i])
			i++
		} else {
			merged = append(merged, b[j])
			j++
		}
	}
	for ; i < len(a) && len(merged) < limit; i++ {
		merged = append(merged, a[i])
	}
	for ; j < len(b) && len(merged) < limit; j++ {
		merged = append(merged, b[j])
	}
	return merged
}

func (s *Server) handleDoctor(w http.ResponseWriter, r *http.Request) {
	prefs := s.runtime.Preferences()

	rep := diag.RunDoctor(r.Context(), s.coreClient(), s.coreStatus(), s.subMgr, prefs.TakeoverMode, prefs.RoutingMode, prefs.MixedPort)
	writeJSON(w, http.StatusOK, rep)
}

func (s *Server) handleBugReport(w http.ResponseWriter, r *http.Request) {
	prefs := s.runtime.Preferences()

	rep := diag.GenerateBugReport(r.Context(), s.engineMgr, s.coreClient(), s.coreStatus(), s.subMgr, prefs.TakeoverMode, prefs.RoutingMode, prefs.MixedPort)
	writeJSON(w, http.StatusOK, rep)
}

// handleShutdown tears the runtime down before answering, so the caller
// learns "cleanup done" — engine down, proxy restored — not merely "exit
// accepted". service stop uses this because platform supervisors kill hard.
func (s *Server) handleShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_, cleanupErr := s.runtime.Down()
	response := map[string]any{"ok": true, "shuttingDown": true, "cleanedUp": cleanupErr == nil}
	if cleanupErr != nil {
		response["error"] = cleanupErr.Error()
	}
	writeJSON(w, http.StatusOK, response)
	s.shutdownOnce.Do(func() { close(s.shutdownCh) })
}

// handleServiceInstall registers the machine-scoped tunnel host. The platform
// layer raises the native elevation prompt (UAC / osascript) itself, so this
// returns once the elevated helper is launched; callers confirm the outcome by
// polling capabilities.serviceInstalled.
func (s *Server) handleServiceInstall(w http.ResponseWriter, r *http.Request) {
	s.handleServiceChange(w, r, func(selfPath string) error {
		return service.Install(selfPath, service.ScopeSystem)
	}, "service installation requested")
}

// handleServiceUninstall is the symmetric removal, with the same elevation
// and confirmation contract.
func (s *Server) handleServiceUninstall(w http.ResponseWriter, r *http.Request) {
	s.handleServiceChange(w, r, func(string) error {
		return service.UninstallScope(service.ScopeSystem)
	}, "service removal requested")
}

func (s *Server) handleServiceChange(w http.ResponseWriter, r *http.Request, change func(selfPath string) error, message string) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	selfPath, err := service.SelfPath()
	if err == nil {
		err = change(selfPath)
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": message})
}

func (s *Server) handleWeb(w http.ResponseWriter, r *http.Request) {

	filePath := filepath.Join(s.webDir, filepath.Clean(r.URL.Path))
	info, err := os.Stat(filePath)
	if err != nil || info.IsDir() {
		indexPath := filepath.Join(s.webDir, "index.html")
		indexBytes, err := os.ReadFile(indexPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}

		prefs := s.runtime.Preferences()
		clashPort, clashSecret := prefs.ClashPort, prefs.ClashSecret

		// The token rides the served page; no address meta — the UI talks to
		// its own origin (relative paths), which keeps remote management
		// working from any host that can reach this listener. The daemon
		// publishes this port as the management boundary.
		metaTag := fmt.Sprintf(`<meta name="external-controller" content="http://:%s@127.0.0.1:%d">
    <meta name="localapi-token" content="%s">`, clashSecret, clashPort, s.token)
		html := strings.Replace(string(indexBytes), "<head>", "<head>\n    "+metaTag, 1)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(html))
		return
	}

	http.ServeFile(w, r, filePath)
}

func (s *Server) runScheduledUpdates() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-s.done:
			return
		case now := <-ticker.C:
			if err := s.runtime.UpdateDue(context.Background(), now); err != nil {
				s.engineMgr.RingLog().Append(engine.LogLevelError, "Scheduled subscription update or runtime application failed")
			}
		}
	}
}

func writeJSON(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]any{"error": msg})
}

func decodeRuntimeRequest(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := decoder.Decode(target); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "request body must contain one JSON value")
		return false
	}
	return true
}

func writeRuntimeError(w http.ResponseWriter, err error) {
	var inputError *runtimeInputError
	status := http.StatusInternalServerError
	if errors.As(err, &inputError) {
		status = http.StatusBadRequest
	}
	writeError(w, status, err.Error())
}

// handleSubSource reads (GET) the subscription's current source for the raw
// editor, or replaces it (PUT) via EditSource: the edited copy passes the
// detection, core and override gates, pins the subscription against
// automatic updates, and re-applies immediately when active.
func (s *Server) handleSubSource(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		id := r.URL.Query().Get("id")
		if id == "" {
			writeError(w, http.StatusBadRequest, "missing subscription id")
			return
		}
		if _, err := s.subMgr.Get(id); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		content, err := os.ReadFile(paths.SubSourcePath(id))
		if errors.Is(err, fs.ErrNotExist) {
			writeError(w, http.StatusNotFound, "no downloaded source; update the subscription first")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "content": string(content)})
	case http.MethodPut:
		var request struct {
			ID      string `json:"id"`
			Content string `json:"content"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid source edit request")
			return
		}
		if request.ID == "" {
			writeError(w, http.StatusBadRequest, "missing subscription id")
			return
		}
		meta, err := s.subMgr.EditSource(request.ID, []byte(request.Content))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if s.subMgr.ActiveID() == request.ID && s.engineMgr.IsRunning() {
			if err := s.runtime.Configure(r.Context(), runtimeOptions{}); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": meta})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleSubUnpin removes the pin an edited source carries, restoring the
// subscription to automatic updates.
func (s *Server) handleSubUnpin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var request struct {
		ID string `json:"id"`
	}
	if !decodeRuntimeRequest(w, r, &request) {
		return
	}
	if request.ID == "" {
		writeError(w, http.StatusBadRequest, "missing subscription id")
		return
	}
	meta, err := s.subMgr.SetSourcePinned(request.ID, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": meta})
}
