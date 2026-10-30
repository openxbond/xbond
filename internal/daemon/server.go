package daemon

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/openxbond/xbond/internal/account"
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

func NewServer(addr string, webDir string) (*Server, error) {
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

	tokenBytes := make([]byte, 16)
	_, _ = rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	core := engine.NewManager(1000)
	s := &Server{
		token:      token,
		engineMgr:  core,
		subMgr:     subMgr,
		runtime:    newRuntimeController(core, subMgr, prefs),
		webDir:     webDir,
		done:       make(chan struct{}),
		shutdownCh: make(chan struct{}),
		lock:       lock,
	}
	s.account = newAccountController(
		account.NewManager(paths.AccountSessionPath()),
		s.bindCredentials,
		s.runtime.Logout,
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

func (s *Server) Start() error {
	go s.runScheduledUpdates()
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

		s.stopErr = errors.Join(runtimeErr, s.httpServer.Shutdown(ctx))
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

	mux.HandleFunc("/localapi/v0/subs", s.authMiddleware(s.handleSubs))
	mux.HandleFunc("/localapi/v0/subs/use", s.authMiddleware(s.handleSubUse))
	mux.HandleFunc("/localapi/v0/subs/update", s.authMiddleware(s.handleSubUpdate))

	mux.HandleFunc("/localapi/v0/nodes", s.authMiddleware(s.handleNodes))
	mux.HandleFunc("/localapi/v0/nodes/select", s.authMiddleware(s.handleNodeSelect))
	mux.HandleFunc("/localapi/v0/nodes/test", s.authMiddleware(s.handleNodeTest))

	mux.HandleFunc("/localapi/v0/connections", s.authMiddleware(s.handleConnections))
	mux.HandleFunc("/localapi/v0/rules", s.authMiddleware(s.handleRules))
	mux.HandleFunc("/localapi/v0/dns/query", s.authMiddleware(s.handleDNSQuery))
	mux.HandleFunc("/localapi/v0/dns/flush", s.authMiddleware(s.handleDNSFlush))
	mux.HandleFunc("/localapi/v0/logs", s.authMiddleware(s.handleLogs))

	mux.HandleFunc("/localapi/v0/doctor", s.authMiddleware(s.handleDoctor))
	mux.HandleFunc("/localapi/v0/bugreport", s.authMiddleware(s.handleBugReport))
	mux.HandleFunc("/localapi/v0/shutdown", s.authMiddleware(s.handleShutdown))

	// Web UI static files
	mux.HandleFunc("/", s.handleWeb)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	prefs := s.runtime.Preferences()

	status := s.engineMgr.Status()
	var threeTier diag.ThreeTierStatus
	// light=1 keeps readiness probes and polling loops off the network: the
	// full evaluation runs DNS and egress checks, which is doctor's job.
	if r.URL.Query().Get("light") != "1" {
		threeTier = diag.EvaluateThreeTier(ctx, s.engineMgr, prefs.TakeoverMode, prefs.RoutingMode, prefs.MixedPort)
	}

	var activeSub *sub.SubscriptionMeta
	if s.subMgr.ActiveID() != "" {
		activeSub, _ = s.subMgr.Get(s.subMgr.ActiveID())
	}

	response := map[string]any{
		"engine":      status,
		"preferences": prefs,
		"threeTier":   threeTier,
		"activeSub":   activeSub,
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
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": s.engineMgr.Status(), "preferences": s.runtime.Preferences()})
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
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": s.engineMgr.Status(), "preferences": s.runtime.Preferences()})
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
		Token           string   `json:"token"`
		Origin          string   `json:"origin"`
		FallbackOrigins []string `json:"fallbackOrigins"`
		Protocol        string   `json:"protocol"`
		Lang            string   `json:"lang"`
		Name            string   `json:"name"`
		URLOrFile       string   `json:"urlOrFile"`
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
	protocol, lang, name, urlOrFile string,
) (*sub.SubscriptionMeta, string, error) {
	if token == "" && urlOrFile == "" {
		return nil, "", &bindError{err: errors.New("must provide token or urlOrFile"), input: true}
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
	if token != "" {
		meta, err = s.subMgr.AddXBond(token, origin, fallbackOrigins, protocol, lang, name, 24, false)
	} else {
		meta, err = s.subMgr.AddUniversal(urlOrFile, name, 24, false)
	}
	if err != nil {
		return nil, "", &bindError{err: err, input: true}
	}

	finalMeta := meta
	res, updateErr := s.runtime.Update(ctx, meta.ID, true, false)
	updateErrMsg := ""
	if updateErr != nil {
		updateErrMsg = updateErr.Error()
	} else if res != nil && res.Meta != nil {
		finalMeta = res.Meta
		if err := s.runtime.Use(ctx, meta.ID); err != nil {
			return finalMeta, updateErrMsg, &bindError{err: err, input: false}
		}
	}
	return finalMeta, updateErrMsg, nil
}

func (s *Server) bindCredentials(
	ctx context.Context,
	credentials *account.Credentials,
	options accountBindOptions,
) (*sub.SubscriptionMeta, string, error) {
	return s.bindSubscription(
		ctx,
		credentials.SubscriptionToken,
		credentials.Origin,
		credentials.FallbackOrigins,
		options.Protocol,
		options.Lang,
		options.Name,
		"",
	)
}

func (s *Server) activeXBondSub() *sub.SubscriptionMeta {
	activeID := s.subMgr.ActiveID()
	var first *sub.SubscriptionMeta
	for _, item := range s.subMgr.List() {
		if item.Type != sub.SubTypeXBond {
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

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	removed, err := s.account.logout()
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
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid rename request")
			return
		}
		if err := s.subMgr.Rename(req.ID, req.Name); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
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
			meta, err = s.subMgr.AddXBond(req.Token, req.Origin, req.FallbackOrigins, req.Protocol, req.Lang, req.Name, req.IntervalHours, false)
		} else {
			meta, err = s.subMgr.AddUniversal(req.URLOrFile, req.Name, req.IntervalHours, false)
		}

		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		// Initial update. The response spells out every side effect —
		// activation, whether the running core switched, and a failed
		// initial fetch — so the CLI can report what actually happened.
		res, updateErr := s.runtime.Update(r.Context(), meta.ID, true, false)
		updateErrMsg := ""
		if updateErr != nil {
			updateErrMsg = updateErr.Error()
			if s.runtime.engine.IsRunning() {
				// A running core cannot switch to a configuration that
				// never arrived; activation waits for a successful update.
				writeJSON(w, http.StatusOK, map[string]any{"meta": meta, "activated": false, "reloaded": false, "updateError": updateErrMsg})
				return
			}
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

func (s *Server) handleSubUpdate(w http.ResponseWriter, r *http.Request) {
	var request struct {
		ID       string `json:"id"`
		Force    bool   `json:"force"`
		ViaProxy bool   `json:"viaProxy"`
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
	if s.engineMgr.Client() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	proxies, err := s.engineMgr.Client().GetProxies(r.Context())
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

	if s.engineMgr.Client() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	if err := s.engineMgr.Client().SelectNode(r.Context(), req.Group, req.Node); err != nil {
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

	if s.engineMgr.Client() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	delay, err := s.engineMgr.Client().TestDelay(r.Context(), req.Node, req.URL, req.TimeoutMs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"node": req.Node, "delay": delay})
}

func (s *Server) handleConnections(w http.ResponseWriter, r *http.Request) {
	if s.engineMgr.Client() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	switch r.Method {
	case http.MethodGet:
		conns, err := s.engineMgr.Client().GetConnections(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, conns)

	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if id == "" || id == "all" {
			_ = s.engineMgr.Client().CloseAllConnections(r.Context())
		} else {
			_ = s.engineMgr.Client().CloseConnection(r.Context(), id)
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func (s *Server) handleRules(w http.ResponseWriter, r *http.Request) {
	if s.engineMgr.Client() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	rules, err := s.engineMgr.Client().GetRules(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"rules": rules})
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

	if s.engineMgr.Client() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	resp, err := s.engineMgr.Client().QueryDNS(r.Context(), req.Domain, req.Type)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleDNSFlush(w http.ResponseWriter, r *http.Request) {
	if s.engineMgr.Client() == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}

	if err := s.engineMgr.Client().FlushFakeIP(r.Context()); err != nil {
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
	writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
}

func (s *Server) handleDoctor(w http.ResponseWriter, r *http.Request) {
	prefs := s.runtime.Preferences()

	rep := diag.RunDoctor(r.Context(), s.engineMgr, s.subMgr, prefs.TakeoverMode, prefs.RoutingMode, prefs.MixedPort)
	writeJSON(w, http.StatusOK, rep)
}

func (s *Server) handleBugReport(w http.ResponseWriter, r *http.Request) {
	prefs := s.runtime.Preferences()

	rep := diag.GenerateBugReport(r.Context(), s.engineMgr, s.subMgr, prefs.TakeoverMode, prefs.RoutingMode, prefs.MixedPort)
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

		metaTag := fmt.Sprintf(`<meta name="external-controller" content="http://:%s@127.0.0.1:%d">
    <meta name="localapi-token" content="%s">
    <meta name="localapi-addr" content="http://%s">`, clashSecret, clashPort, s.token, s.addr)
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
