package mobile

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"strconv"

	"github.com/openxbond/xbond/internal/diag"
	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/httplocal"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/platform/sysproxy"
	"github.com/openxbond/xbond/internal/sub"
)

// apiServer is the in-process LocalAPI for the mobile host: the same
// /localapi/v0 contract the daemon serves, so the shared web UI (and any
// LocalAPI consumer) drives the VPN app unchanged. Loopback-only, token
// authenticated; the token also lands in localapi.token beside the daemon's.
type apiServer struct {
	svc    *TunnelService
	token  string
	port   int
	server *http.Server
}

// PreferredLocalAPIPort is the default loopback port for the mobile in-process
// LocalAPI. A stable origin preserves WebView's origin-scoped localStorage
// (theme, language, preferences) across app restarts.
const PreferredLocalAPIPort = 24190

func newAPIServer(svc *TunnelService) (*apiServer, error) {
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", PreferredLocalAPIPort))
	if err != nil {
		listener, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, err
		}
	}
	s := &apiServer{
		svc:   svc,
		token: randomSecret(),
		port:  listener.Addr().(*net.TCPAddr).Port,
	}

	mux := http.NewServeMux()
	auth := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			// Same CORS contract as the daemon: the pnpm dev:android flow loads
			// the UI from the Vite origin and talks cross-origin to the
			// loopback LocalAPI inside the emulator.
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-XBond-Token")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			if r.Header.Get("X-XBond-Token") != s.token {
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc("/localapi/v0/status", auth(s.handleStatus))
	mux.HandleFunc("/localapi/v0/up", auth(s.handleUp))
	mux.HandleFunc("/localapi/v0/down", auth(s.handleDown))
	mux.HandleFunc("/localapi/v0/restart", auth(s.handleRestart))
	mux.HandleFunc("/localapi/v0/mode", auth(s.handleMode))
	mux.HandleFunc("/localapi/v0/login", auth(s.handleLogin))
	mux.HandleFunc("/localapi/v0/logout", auth(s.handleLogout))
	mux.HandleFunc("/localapi/v0/account", auth(s.handleAccountStatus))
	mux.HandleFunc("/localapi/v0/account/login", auth(s.handleAccountLogin))
	mux.HandleFunc("/localapi/v0/account/logout", auth(s.handleAccountLogout))
	mux.HandleFunc("/localapi/v0/account/refresh", auth(s.handleAccountRefresh))
	mux.HandleFunc("/localapi/v0/account/cancel", auth(s.handleAccountCancel))
	mux.HandleFunc("/localapi/v0/account/callback", auth(s.handleAccountCallback))
	mux.HandleFunc("/localapi/v0/subs", auth(s.handleSubs))
	mux.HandleFunc("/localapi/v0/subs/use", auth(s.handleSubUse))
	mux.HandleFunc("/localapi/v0/subs/update", auth(s.handleSubUpdate))
	mux.HandleFunc("/localapi/v0/subs/override", auth(s.handleSubOverride))
	mux.HandleFunc("/localapi/v0/subs/versions", auth(s.handleSubVersions))
	mux.HandleFunc("/localapi/v0/subs/rollback", auth(s.handleSubRollback))
	mux.HandleFunc("/localapi/v0/subs/source", auth(s.handleSubSource))
	mux.HandleFunc("/localapi/v0/subs/url", auth(s.handleSubURL))
	mux.HandleFunc("/localapi/v0/subs/unpin", auth(s.handleSubUnpin))
	mux.HandleFunc("/localapi/v0/subs/progress", auth(s.handleSubsProgress))
	mux.HandleFunc("/localapi/v0/mixins/global", auth(s.handleGlobalMixin))
	mux.HandleFunc("/localapi/v0/profiles", auth(s.handleProfiles))
	mux.HandleFunc("/localapi/v0/nodes", auth(s.handleNodes))
	mux.HandleFunc("/localapi/v0/nodes/select", auth(s.handleNodeSelect))
	mux.HandleFunc("/localapi/v0/nodes/test", auth(s.handleNodeTest))
	mux.HandleFunc("/localapi/v0/connections", auth(s.handleConnections))
	mux.HandleFunc("/localapi/v0/rules", auth(s.handleRules))
	mux.HandleFunc("/localapi/v0/rules/page", auth(s.handleRulesPage))
	mux.HandleFunc("/localapi/v0/dns/query", auth(s.handleDNSQuery))
	mux.HandleFunc("/localapi/v0/dns/flush", auth(s.handleDNSFlush))
	mux.HandleFunc("/localapi/v0/logs", auth(s.handleLogs))
	mux.HandleFunc("/localapi/v0/doctor", auth(s.handleDoctor))
	mux.HandleFunc("/localapi/v0/bugreport", auth(s.handleBugReport))

	s.server = &http.Server{Handler: httplocal.Guard(mux)}
	go func() {
		if err := s.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			svc.listener.OnLog("error", "local API server failed: "+err.Error())
		}
	}()
	_ = atomicfile.Write(paths.LocalAPITokenPath(), []byte(s.token), 0o600)
	_ = atomicfile.Write(paths.LocalAPIAddrPath(), []byte(fmt.Sprintf("127.0.0.1:%d", s.port)), 0o600)
	return s, nil
}

func (s *apiServer) close() {
	_ = s.server.Close()
}

// ---------------------------------------------------------------- status

func (s *apiServer) handleStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	prefs := s.svc.runtime.preferences()
	status := s.svc.managerStatus()

	var threeTier diag.ThreeTierStatus
	// light=1 keeps readiness probes and polling loops off the network (the
	// app process's own probes are unreliable behind the VPN anyway — see the
	// mobile spec's self-traffic note).
	if r.URL.Query().Get("light") != "1" {
		// Mobile takeover is TUN-only: no host proxy state exists to sample.
		threeTier = diag.EvaluateThreeTier(ctx, s.svc.engineManager().Client(), s.svc.engineManager().Status(), engine.ModeTun, s.svc.runtime.routing, 0, sysproxy.Snapshot{}, nil)
	}

	var activeSub *sub.SubscriptionMeta
	if id := s.svc.subMgr.ActiveID(); id != "" {
		activeSub, _ = s.svc.subMgr.Get(id)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"engine":       status,
		"preferences":  prefs,
		"threeTier":    threeTier,
		"activeSub":    activeSub,
		"vpnState":     s.svc.GetState(),
		"capabilities": map[string]any{"tun": true, "tunReasonCode": ""},
		"rulePaging":   true,
	})
}

// ------------------------------------------------------------------- up

func (s *apiServer) handleUp(w http.ResponseWriter, r *http.Request) {
	if s.svc.engineManager().IsRunning() {
		s.writeStatusOK(w)
		return
	}
	if s.svc.platform == nil {
		writeError(w, http.StatusServiceUnavailable, "platform bridge unavailable")
		return
	}
	// Synchronous JNI round trip: the platform establishes the VPN (consent
	// dialog when required) and hands the fd back, and startActive runs the
	// runtime apply before this call returns.
	if err := s.svc.platform.RequestConnect(); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	s.writeStatusOK(w)
}

func (s *apiServer) handleDown(w http.ResponseWriter, r *http.Request) {
	if !s.svc.engineManager().IsRunning() {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stopped": false})
		return
	}
	if s.svc.platform == nil {
		writeError(w, http.StatusServiceUnavailable, "platform bridge unavailable")
		return
	}
	// The platform tears the VPN interface down, which stops the core on the
	// way (tunnel.Stop); when this returns the engine is stopped.
	if err := s.svc.platform.RequestDisconnect(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stopped": true})
}

func (s *apiServer) handleRestart(w http.ResponseWriter, r *http.Request) {
	if !s.svc.engineManager().IsRunning() {
		writeError(w, http.StatusConflict, "tunnel is not running")
		return
	}
	if err := s.svc.runtime.apply(s.svc.activeTunFd); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.writeStatusOK(w)
}

func (s *apiServer) handleMode(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, s.svc.runtime.preferences())
		return
	}
	var req struct {
		Routing engine.RoutingMode `json:"routing"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Routing == "" {
		writeJSON(w, http.StatusOK, s.svc.runtime.preferences())
		return
	}
	if err := s.svc.runtime.setRouting(req.Routing); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "preferences": s.svc.runtime.preferences()})
}

func (s *apiServer) writeStatusOK(w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"status":      s.svc.managerStatus(),
		"preferences": s.svc.runtime.preferences(),
	})
}

// ---------------------------------------------------------------- subs

func (s *apiServer) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token     string `json:"token"`
		Name      string `json:"name"`
		Lang      string `json:"lang"`
		Protocol  string `json:"protocol"`
		URLOrFile string `json:"urlOrFile"`
		Content   string `json:"content"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<22)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	meta, err := s.addSubscription(addRequest{
		token: req.Token, name: req.Name, lang: req.Lang, protocol: req.Protocol,
		urlOrFile: req.URLOrFile, content: req.Content,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": meta})
}

type addRequest struct {
	token, name, lang, protocol, urlOrFile, content string
}

func (s *apiServer) addSubscription(req addRequest) (*sub.SubscriptionMeta, error) {
	if req.token == "" && req.urlOrFile == "" && req.content == "" {
		return nil, errors.New("must provide token, content or urlOrFile")
	}
	name := req.name
	if req.token != "" && name == "" {
		for _, item := range s.svc.subMgr.List() {
			if item.Type == sub.SubTypeXBond && item.Token == req.token {
				name = item.Name
				break
			}
		}
	}
	var (
		meta *sub.SubscriptionMeta
		err  error
	)
	switch {
	case req.token != "":
		meta, err = s.svc.subMgr.AddXBond(req.token, "", nil, req.protocol, req.lang, name, 24, false)
	case req.content != "":
		meta, err = s.svc.subMgr.AddUniversalContent(req.content, name, 24, false)
	default:
		meta, err = s.svc.subMgr.AddUniversal(req.urlOrFile, name, 24, false)
	}
	if err != nil {
		return nil, err
	}
	if err := s.svc.subMgr.Use(meta.ID); err != nil {
		return meta, err
	}
	// A running tunnel switches content in place; an idle one picks the new
	// subscription up on the next connect.
	if s.svc.engineManager().IsRunning() {
		if applyErr := s.svc.runtime.apply(s.svc.activeTunFd); applyErr != nil {
			return meta, applyErr
		}
	}
	return meta, nil
}

func (s *apiServer) handleLogout(w http.ResponseWriter, r *http.Request) {
	// No cloud account on this host yet; the closest semantic is dropping
	// every xbond subscription, which the daemon logout also performs.
	removed := make([]sub.SubscriptionMeta, 0)
	for _, item := range s.svc.subMgr.List() {
		if item.Type != sub.SubTypeXBond {
			continue
		}
		if err := s.svc.subMgr.Remove(item.ID); err == nil {
			removed = append(removed, item)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "removed": removed})
}

func (s *apiServer) handleAccountStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, s.svc.account.snapshot())
}

func (s *apiServer) handleAccountLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Origin         string `json:"origin"`
		Name           string `json:"name"`
		Lang           string `json:"lang"`
		Protocol       string `json:"protocol"`
		Device         bool   `json:"device"`
		NoBrowser      bool   `json:"noBrowser"`
		CallbackScheme string `json:"callbackScheme"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid account login request")
		return
	}
	if req.Lang != "" {
		s.svc.account.lang = req.Lang
	}
	writeJSON(w, http.StatusOK, s.svc.account.login(req.Origin, req.Device, req.NoBrowser, req.CallbackScheme))
}

// handleAccountCallback is the Android deep-link landing: the Activity hands
// over the browser's authorization code and the account controller — the
// only token holder — validates the state and completes the exchange.
func (s *apiServer) handleAccountCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Code  string `json:"code"`
		State string `json:"state"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid account callback request")
		return
	}
	if req.Code == "" || req.State == "" {
		writeError(w, http.StatusBadRequest, "code and state are required")
		return
	}
	if err := s.svc.account.deliverCallback(req.Code, req.State); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.svc.account.snapshot())
}

func (s *apiServer) handleAccountLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	removed := s.svc.account.logout()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "removed": removed})
}

func (s *apiServer) handleAccountRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Lang string `json:"lang"`
	}
	// The body is optional: an empty request keeps the persisted render
	// language. A new language follows the caller's interface language, the
	// same rule the login handler applies.
	if r.Body != nil {
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "invalid account refresh request")
			return
		}
	}
	if req.Lang != "" {
		s.svc.account.lang = req.Lang
	}
	// The refreshed state carries UpdateError with 200, so the UI renders
	// the retry path instead of treating the session as invalid.
	writeJSON(w, http.StatusOK, s.svc.account.refresh(r.Context()))
}

func (s *apiServer) handleAccountCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.svc.account.cancelPending()
	writeJSON(w, http.StatusOK, s.svc.account.snapshot())
}

func (s *apiServer) handleSubs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{
			"activeId":      s.svc.subMgr.ActiveID(),
			"subscriptions": s.svc.subMgr.List(),
		})
	case http.MethodPost:
		var req struct {
			Token     string `json:"token"`
			Name      string `json:"name"`
			Lang      string `json:"lang"`
			Protocol  string `json:"protocol"`
			URLOrFile string `json:"urlOrFile"`
			Content   string `json:"content"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<22)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		meta, err := s.addSubscription(addRequest{
			token: req.Token, name: req.Name, lang: req.Lang, protocol: req.Protocol,
			urlOrFile: req.URLOrFile, content: req.Content,
		})
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": meta})
	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if id == "" {
			writeError(w, http.StatusBadRequest, "missing subscription id")
			return
		}
		wasActive := id == s.svc.subMgr.ActiveID()
		if err := s.svc.subMgr.Remove(id); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if wasActive && s.svc.engineManager().IsRunning() && s.svc.platform != nil {
			_ = s.svc.platform.RequestDisconnect()
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": id})
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
			if err := s.svc.subMgr.Rename(req.ID, req.Name); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		if req.UpdateChannel != "" {
			if err := s.svc.subMgr.SetUpdateChannel(req.ID, req.UpdateChannel, req.UpdateProxy); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		if req.UpdateIntervalHours != nil {
			if err := s.svc.subMgr.SetUpdateSchedule(req.ID, *req.UpdateIntervalHours); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *apiServer) handleSubUse(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.ID == "" {
		writeError(w, http.StatusBadRequest, "missing subscription id")
		return
	}
	if err := s.svc.subMgr.Use(req.ID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if s.svc.engineManager().IsRunning() {
		if err := s.svc.runtime.apply(s.svc.activeTunFd); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	s.writeStatusOK(w)
}

func (s *apiServer) handleSubUpdate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID       string `json:"id"`
		Force    bool   `json:"force"`
		ViaProxy *bool  `json:"viaProxy"`
		All      bool   `json:"all"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.All {
		results := make([]sub.UpdateResult, 0)
		failures := make([]sub.UpdateFailure, 0)
		for _, item := range s.svc.subMgr.List() {
			res, err := s.svc.runtime.update(item.ID, req.Force)
			if err != nil {
				failures = append(failures, sub.UpdateFailure{ID: item.ID, Name: item.Name, Error: err.Error()})
				continue
			}
			if res != nil {
				results = append(results, *res)
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "results": results, "failures": failures})
		return
	}
	res, err := s.svc.runtime.update(req.ID, req.Force)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": res})
}

func (s *apiServer) handleSubsProgress(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.svc.subMgr.Progress())
}

// ------------------------------------------------- subscription authoring

// handleSubOverride reads (GET) or saves (PUT/POST) a subscription's
// structured override. Saving validates against the stored source (the sub
// store rejects conflicts up front); when the subscription is active and the
// tunnel runs, the change hot-reloads the core without bouncing the VPN.
func (s *apiServer) handleSubOverride(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		id := r.URL.Query().Get("id")
		if id == "" {
			writeError(w, http.StatusBadRequest, "missing subscription id")
			return
		}
		override, err := s.svc.subMgr.Override(id)
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
		if err := s.svc.subMgr.SetOverride(request.ID, override); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if s.svc.subMgr.ActiveID() == request.ID {
			if err := s.svc.runtime.reapplyIfRunning(); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleGlobalMixin reads (GET) or updates (PUT/POST) the system-wide mixin
// rules and DNS; a running tunnel hot-reloads immediately.
func (s *apiServer) handleGlobalMixin(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		mixin, err := s.svc.subMgr.GlobalMixin()
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
		if err := s.svc.subMgr.SetGlobalMixin(&mixin); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if s.svc.subMgr.ActiveID() != "" {
			if err := s.svc.runtime.reapplyIfRunning(); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "mixin": mixin})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleProfiles mirrors the daemon's unified profile endpoint: listing and
// URL / pasted-content import with optional immediate activation.
func (s *apiServer) handleProfiles(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list := s.svc.subMgr.List()
		activeID := s.svc.subMgr.ActiveID()
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
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<22)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		var (
			meta *sub.SubscriptionMeta
			err  error
		)
		if req.Kind == sub.KindInline || req.Content != "" {
			meta, err = s.svc.subMgr.AddUniversalContent(req.Content, req.Name, 0, false)
		} else {
			meta, err = s.svc.subMgr.AddUniversal(req.URL, req.Name, req.IntervalHours, false)
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		res, updateErr := s.svc.runtime.update(meta.ID, true)
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
			if err := s.svc.subMgr.Use(meta.ID); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			activated = true
			if err := s.svc.runtime.reapplyIfRunning(); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
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
func (s *apiServer) handleSubVersions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing subscription id")
		return
	}
	versions, err := s.svc.subMgr.Versions(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": versions})
}

// handleSubRollback restores the newest previous source version of a
// subscription; the restored source hot-reloads when the tunnel runs.
func (s *apiServer) handleSubRollback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var request struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if request.ID == "" {
		writeError(w, http.StatusBadRequest, "missing subscription id")
		return
	}
	meta, err := s.svc.subMgr.Rollback(request.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if s.svc.subMgr.ActiveID() == request.ID {
		if err := s.svc.runtime.reapplyIfRunning(); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": meta})
}

// handleSubSource reads (GET) the subscription's current source for the raw
// editor, or replaces it (PUT) via EditSource: the edited copy passes the
// detection, core and override gates and pins the subscription against
// automatic updates, then hot-reloads when active.
func (s *apiServer) handleSubSource(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		id := r.URL.Query().Get("id")
		if id == "" {
			writeError(w, http.StatusBadRequest, "missing subscription id")
			return
		}
		if _, err := s.svc.subMgr.Get(id); err != nil {
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
		meta, err := s.svc.subMgr.EditSource(request.ID, []byte(request.Content))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if s.svc.subMgr.ActiveID() == request.ID {
			if err := s.svc.runtime.reapplyIfRunning(); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": meta})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleSubURL replaces a remote subscription's source URL.
func (s *apiServer) handleSubURL(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var request struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := s.svc.subMgr.ChangeSourceURL(request.ID, request.URL); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleSubUnpin removes the pin an edited source carries, restoring
// automatic updates.
func (s *apiServer) handleSubUnpin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var request struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if request.ID == "" {
		writeError(w, http.StatusBadRequest, "missing subscription id")
		return
	}
	meta, err := s.svc.subMgr.SetSourcePinned(request.ID, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "meta": meta})
}

// handleRulesPage serves the paginated, searchable rule list the rules view
// reads instead of the full rule dump.
func (s *apiServer) handleRulesPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
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
	mgr := s.svc.engineManager()
	page, ok := mgr.RulesPage(query)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// ------------------------------------------------------- controller reads

func (s *apiServer) client() *engine.ClashClient {
	mgr := s.svc.engineManager()
	if !mgr.IsRunning() {
		return nil
	}
	return mgr.Client()
}

func (s *apiServer) handleNodes(w http.ResponseWriter, r *http.Request) {
	client := s.client()
	if client == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}
	proxies, err := client.GetProxies(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, proxies)
}

func (s *apiServer) handleNodeSelect(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Group string `json:"group"`
		Node  string `json:"node"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	client := s.client()
	if client == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}
	if err := client.SelectNode(r.Context(), req.Group, req.Node); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if group := s.svc.runtime.appliedSubID(); group != "" {
		_ = s.svc.subMgr.SaveSelection(s.svc.runtime.appliedSubID(), req.Group, req.Node)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *apiServer) handleNodeTest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Node      string `json:"node"`
		URL       string `json:"url"`
		TimeoutMs int    `json:"timeoutMs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	client := s.client()
	if client == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}
	delay, err := client.TestDelay(r.Context(), req.Node, req.URL, req.TimeoutMs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"node": req.Node, "delay": delay})
}

func (s *apiServer) handleConnections(w http.ResponseWriter, r *http.Request) {
	client := s.client()
	if client == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}
	switch r.Method {
	case http.MethodGet:
		conns, err := client.GetConnections(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, conns)
	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if id == "" || id == "all" {
			_ = client.CloseAllConnections(r.Context())
		} else {
			_ = client.CloseConnection(r.Context(), id)
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *apiServer) handleRules(w http.ResponseWriter, r *http.Request) {
	client := s.client()
	if client == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}
	rules, err := client.GetRules(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rules": rules})
}

func (s *apiServer) handleLogs(w http.ResponseWriter, r *http.Request) {
	level := engine.LogLevel(r.URL.Query().Get("level"))
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}
	logs := s.svc.engineManager().RingLog().Snapshot(level, limit)
	writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
}

func (s *apiServer) handleDNSQuery(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Domain string `json:"domain"`
		Type   string `json:"type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	client := s.client()
	if client == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}
	resp, err := client.QueryDNS(r.Context(), req.Domain, req.Type)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *apiServer) handleDNSFlush(w http.ResponseWriter, r *http.Request) {
	client := s.client()
	if client == nil {
		writeError(w, http.StatusServiceUnavailable, "engine is not running")
		return
	}
	if err := client.FlushFakeIP(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "flushed": true})
}

// ---------------------------------------------------------------- diag

func (s *apiServer) handleDoctor(w http.ResponseWriter, r *http.Request) {
	rep := diag.RunDoctor(r.Context(), s.svc.engineManager().Client(), s.svc.engineManager().Status(), s.svc.subMgr,
		engine.ModeTun, s.svc.runtime.routing, 0)
	writeJSON(w, http.StatusOK, rep)
}

func (s *apiServer) handleBugReport(w http.ResponseWriter, r *http.Request) {
	rep := diag.GenerateBugReport(r.Context(), s.svc.engineManager(), s.svc.engineManager().Client(), s.svc.engineManager().Status(), s.svc.subMgr,
		engine.ModeTun, s.svc.runtime.routing, 0)
	writeJSON(w, http.StatusOK, rep)
}

// ---------------------------------------------------------------- json

func writeJSON(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]any{"error": msg})
}
