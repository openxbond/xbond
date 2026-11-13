package daemon

import (
	"crypto/subtle"
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
