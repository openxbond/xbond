package daemon

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
)

const controllerProxyPath = "/localapi/v0/controller/"

func (s *Server) handleControllerProxy(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, controllerProxyPath)
	websocket := strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
	token, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if websocket {
		token = r.URL.Query().Get("token")
	}
	if token == "" || subtle.ConstantTimeCompare([]byte(token), []byte(s.token)) != 1 {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !dashboardCoreRoute(r.Method, path, websocket) {
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodPatch && path == "configs" {
		if err := validateControllerPatch(w, r); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	status := s.coreStatus()
	if !status.Running || status.ClashPort == 0 {
		writeError(w, http.StatusServiceUnavailable, "core is not running")
		return
	}

	proxy := httputil.ReverseProxy{
		Rewrite: func(req *httputil.ProxyRequest) {
			req.SetURL(&url.URL{Scheme: "http", Host: "127.0.0.1:" + strconv.Itoa(status.ClashPort)})
			req.Out.URL.Path = "/" + path
			// Keep escaped slashes in node and provider names.
			req.Out.URL.RawPath = "/" + strings.TrimPrefix(r.URL.EscapedPath(), controllerProxyPath)
			query := req.Out.URL.Query()
			query.Del("token")
			req.Out.URL.RawQuery = query.Encode()
			req.Out.Header.Set("Authorization", "Bearer "+status.ClashSecret)
			req.Out.Header.Del("Cookie")
			req.Out.Header.Del("Origin")
		},
	}
	proxy.ServeHTTP(w, r)
}

// Keep the bridge limited to controller routes used by the dashboard.
func dashboardCoreRoute(method, path string, websocket bool) bool {
	root, tail, nested := strings.Cut(path, "/")
	if websocket {
		return method == http.MethodGet && !nested &&
			(root == "traffic" || root == "connections" || root == "logs" || root == "memory")
	}
	switch root {
	case "configs":
		return !nested && (method == http.MethodGet || method == http.MethodPatch)
	case "version", "rules":
		return !nested && method == http.MethodGet
	case "connections", "proxies":
		return method == http.MethodGet || (root == "connections" && method == http.MethodDelete) ||
			(root == "proxies" && nested && method == http.MethodPut)
	case "providers":
		group, name, item := strings.Cut(tail, "/")
		return (group == "proxies" || group == "rules") &&
			(method == http.MethodGet || (item && name != "" && method == http.MethodPut))
	case "dns":
		return method == http.MethodGet && tail == "query"
	case "cache":
		return method == http.MethodPost && (tail == "dns/flush" || tail == "fakeip/flush")
	default:
		return false
	}
}

// LocalAPI owns the listeners, routing mode and takeover. The dashboard
// only uses the core PATCH directly for the live log level.
var errControllerPatch = errors.New("only the core log level can be changed here")

func validateControllerPatch(w http.ResponseWriter, r *http.Request) error {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1024))
	if err != nil {
		return err
	}
	var fields map[string]string
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if len(fields) != 1 {
		return errControllerPatch
	}
	switch fields["log-level"] {
	case "debug", "info", "warn", "error", "silent":
		r.Body = io.NopCloser(bytes.NewReader(data))
		return nil
	default:
		return errControllerPatch
	}
}
