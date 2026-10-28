package daemon

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/openxbond/xbond/diag"
	"github.com/openxbond/xbond/engine"
	"github.com/openxbond/xbond/paths"
	"github.com/openxbond/xbond/sub"
	"github.com/openxbond/xbond/sysproxy"
)

type Server struct {
	mu         sync.RWMutex
	httpServer *http.Server
	listener   net.Listener
	token      string
	addr       string

	engineMgr *engine.Manager
	subMgr    *sub.Manager
	prefs     RuntimePreferences

	webDir string
	done   chan struct{}
}

func NewServer(addr string, webDir string) (*Server, error) {
	if err := paths.EnsureDirs(); err != nil {
		return nil, err
	}

	_ = sysproxy.AutoRecoverOnStartup()

	prefs := LoadPreferences()

	subMgr, err := sub.NewManager()
	if err != nil {
		return nil, err
	}

	tokenBytes := make([]byte, 16)
	_, _ = rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	s := &Server{
		token:     token,
		engineMgr: engine.NewManager(1000),
		subMgr:    subMgr,
		prefs:     prefs,
		webDir:    webDir,
		done:      make(chan struct{}),
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

func (s *Server) Stop(ctx context.Context) error {
	close(s.done)

	// Clean rollback
	_ = s.engineMgr.Stop()
	_ = sysproxy.Disable()

	_ = os.Remove(paths.LocalAPITokenPath())
	_ = os.Remove(paths.LocalAPIAddrPath())

	return s.httpServer.Shutdown(ctx)
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

	// Web UI static files
	mux.HandleFunc("/", s.handleWeb)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	s.mu.RLock()
	prefs := s.prefs
	s.mu.RUnlock()

	status := s.engineMgr.Status()
	threeTier := diag.EvaluateThreeTier(ctx, s.engineMgr, prefs.TakeoverMode, prefs.RoutingMode, prefs.MixedPort)

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
	var req struct {
		Mode     engine.TakeoverMode `json:"mode"`
		Routing  engine.RoutingMode  `json:"routing"`
		Port     int                 `json:"port"`
		AllowLan *bool               `json:"allowLan"`
		SubID    string              `json:"subId"`
	}

	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	s.mu.Lock()
	if req.Mode != "" {
		s.prefs.TakeoverMode = req.Mode
	}
	if req.Routing != "" {
		s.prefs.RoutingMode = req.Routing
	}
	if req.Port > 0 {
		s.prefs.MixedPort = req.Port
	}
	if req.AllowLan != nil {
		s.prefs.AllowLan = *req.AllowLan
	}
	if req.SubID != "" {
		_ = s.subMgr.Use(req.SubID)
	}
	prefs := s.prefs
	_ = SavePreferences(prefs)
	s.mu.Unlock()

	activeID := s.subMgr.ActiveID()
	if activeID == "" {
		writeError(w, http.StatusBadRequest, "no active subscription; please login or add a subscription first")
		return
	}

	sourceData, err := os.ReadFile(paths.SubSourcePath(activeID))
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("failed to read subscription source: %v", err))
		return
	}

	runtimeJSON, err := engine.DeriveRuntimeConfig(
		sourceData,
		prefs.TakeoverMode,
		prefs.RoutingMode,
		prefs.MixedPort,
		prefs.AllowLan,
		prefs.ClashPort,
		prefs.ClashSecret,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to derive runtime config: %v", err))
		return
	}

	_ = os.WriteFile(paths.SubRuntimePath(activeID), runtimeJSON, 0o600)

	subMeta, _ := s.subMgr.Get(activeID)
	var savedSelections map[string]string
	if subMeta != nil {
		savedSelections = subMeta.SavedSelections
	}

	if err := s.engineMgr.Reload(runtimeJSON, savedSelections); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to start engine: %v", err))
		return
	}

	// Apply OS takeover mode
	if prefs.TakeoverMode == engine.ModeSysproxy {
		_ = sysproxy.Set(fmt.Sprintf("127.0.0.1:%d", prefs.MixedPort), "")
	} else {
		_ = sysproxy.Disable()
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "preferences": prefs})
}

func (s *Server) handleDown(w http.ResponseWriter, r *http.Request) {
	_ = s.engineMgr.Stop()
	_ = sysproxy.Disable()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stopped": true})
}

func (s *Server) handleRestart(w http.ResponseWriter, r *http.Request) {
	s.handleUp(w, r)
}

func (s *Server) handleMode(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		s.mu.RLock()
		prefs := s.prefs
		s.mu.RUnlock()
		writeJSON(w, http.StatusOK, prefs)
		return
	}

	var req struct {
		Mode     engine.TakeoverMode `json:"mode"`
		Routing  engine.RoutingMode  `json:"routing"`
		Port     int                 `json:"port"`
		AllowLan *bool               `json:"allowLan"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	s.mu.Lock()
	if req.Mode != "" {
		s.prefs.TakeoverMode = req.Mode
	}
	if req.Routing != "" {
		s.prefs.RoutingMode = req.Routing
	}
	if req.Port > 0 {
		s.prefs.MixedPort = req.Port
	}
	if req.AllowLan != nil {
		s.prefs.AllowLan = *req.AllowLan
	}
	prefs := s.prefs
	_ = SavePreferences(prefs)
	s.mu.Unlock()

	if s.engineMgr.IsRunning() {
		s.handleUp(w, r)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "preferences": prefs})
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

	var meta *sub.SubscriptionMeta
	var err error

	if req.Token != "" {
		meta, err = s.subMgr.AddXBond(req.Token, req.Origin, req.FallbackOrigins, req.Protocol, req.Lang, req.Name, 24, true)
	} else if req.URLOrFile != "" {
		meta, err = s.subMgr.AddUniversal(req.URLOrFile, req.Name, 24, true)
	} else {
		writeError(w, http.StatusBadRequest, "must provide token or urlOrFile")
		return
	}

	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Fetch initial config
	res, updateErr := s.subMgr.Update(meta.ID, true, false, 0)
	if updateErr != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": meta, "updateError": updateErr.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": res.Meta})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Purge bool `json:"purge"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	_ = s.engineMgr.Stop()
	_ = sysproxy.Disable()

	activeID := s.subMgr.ActiveID()
	if req.Purge && activeID != "" {
		_ = s.subMgr.Remove(activeID)
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "loggedOut": true})
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
			meta, err = s.subMgr.AddXBond(req.Token, req.Origin, req.FallbackOrigins, req.Protocol, req.Lang, req.Name, req.IntervalHours, req.Use)
		} else {
			meta, err = s.subMgr.AddUniversal(req.URLOrFile, req.Name, req.IntervalHours, req.Use)
		}

		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		// Initial update
		res, _ := s.subMgr.Update(meta.ID, true, false, 0)
		if res != nil && res.Meta != nil {
			meta = res.Meta
		}

		writeJSON(w, http.StatusOK, meta)

	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if id == "" {
			writeError(w, http.StatusBadRequest, "missing subscription id")
			return
		}
		if err := s.subMgr.Remove(id); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": id})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleSubUse(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.subMgr.Use(req.ID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if s.engineMgr.IsRunning() {
		s.handleUp(w, r)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "activeId": req.ID})
}

func (s *Server) handleSubUpdate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID       string `json:"id"`
		Force    bool   `json:"force"`
		ViaProxy bool   `json:"viaProxy"`
		All      bool   `json:"all"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	s.mu.RLock()
	proxyPort := s.prefs.MixedPort
	s.mu.RUnlock()

	if req.All {
		list := s.subMgr.List()
		results := make([]sub.UpdateResult, 0, len(list))
		for _, item := range list {
			res, err := s.subMgr.Update(item.ID, req.Force, req.ViaProxy, proxyPort)
			if err == nil && res != nil {
				results = append(results, *res)
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"results": results})
		return
	}

	targetID := req.ID
	if targetID == "" {
		targetID = s.subMgr.ActiveID()
	}
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "no subscription to update")
		return
	}

	res, err := s.subMgr.Update(targetID, req.Force, req.ViaProxy, proxyPort)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// If content changed and active, reload engine
	if res.ContentChanged && targetID == s.subMgr.ActiveID() && s.engineMgr.IsRunning() {
		s.handleUp(w, r)
		return
	}

	writeJSON(w, http.StatusOK, res)
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
	logs := s.engineMgr.RingLog().Snapshot(level, 200)
	writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
}

func (s *Server) handleDoctor(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	prefs := s.prefs
	s.mu.RUnlock()

	rep := diag.RunDoctor(r.Context(), s.engineMgr, s.subMgr, prefs.TakeoverMode, prefs.RoutingMode, prefs.MixedPort)
	writeJSON(w, http.StatusOK, rep)
}

func (s *Server) handleBugReport(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	prefs := s.prefs
	s.mu.RUnlock()

	rep := diag.GenerateBugReport(r.Context(), s.engineMgr, s.subMgr, prefs.TakeoverMode, prefs.RoutingMode, prefs.MixedPort)
	writeJSON(w, http.StatusOK, rep)
}

func (s *Server) handleWeb(w http.ResponseWriter, r *http.Request) {
	if s.webDir == "" {
		s.webDir = "dist"
	}

	filePath := filepath.Join(s.webDir, filepath.Clean(r.URL.Path))
	info, err := os.Stat(filePath)
	if err != nil || info.IsDir() {
		indexPath := filepath.Join(s.webDir, "index.html")
		indexBytes, err := os.ReadFile(indexPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}

		s.mu.RLock()
		clashPort := s.prefs.ClashPort
		clashSecret := s.prefs.ClashSecret
		s.mu.RUnlock()

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
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-s.done:
			return
		case <-ticker.C:
			activeID := s.subMgr.ActiveID()
			if activeID == "" {
				continue
			}

			subMeta, err := s.subMgr.Get(activeID)
			if err != nil || !subMeta.AutoUpdate {
				continue
			}

			interval := time.Duration(subMeta.UpdateIntervalHours) * time.Hour
			if interval <= 0 {
				interval = 24 * time.Hour
			}

			if time.Since(subMeta.LastCheckedAt) >= interval {
				s.mu.RLock()
				proxyPort := s.prefs.MixedPort
				s.mu.RUnlock()

				res, err := s.subMgr.Update(subMeta.ID, false, false, proxyPort)
				if err == nil && res != nil && res.ContentChanged && s.engineMgr.IsRunning() {
					// Hot reload
					sourceData, _ := os.ReadFile(paths.SubSourcePath(subMeta.ID))
					if runtimeJSON, err := engine.DeriveRuntimeConfig(
						sourceData,
						s.prefs.TakeoverMode,
						s.prefs.RoutingMode,
						s.prefs.MixedPort,
						s.prefs.AllowLan,
						s.prefs.ClashPort,
						s.prefs.ClashSecret,
					); err == nil {
						_ = s.engineMgr.Reload(runtimeJSON, subMeta.SavedSelections)
					}
				}
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
