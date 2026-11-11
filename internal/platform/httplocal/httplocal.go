// Package httplocal guards loopback LocalAPI listeners against Host-header
// spoofing. Daemon and mobile serve the LocalAPI token inside the web page
// at "/" (unauthenticated); a browser page that DNS-rebinds its own domain
// to 127.0.0.1 could otherwise read that token and drive the whole LocalAPI
// afterwards (the port must first be found by scanning, which is exactly
// what makes this guard the fix rather than a nicety). Browsers address the
// UI by loopback names, so the three loopback names are the complete
// allowlist.
package httplocal

import (
	"net"
	"net/http"
	"strings"
)

// Guard wraps a loopback listener's handler with the Host allowlist.
func Guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(r.Host); err == nil {
			host = h
		}
		host = strings.Trim(host, "[]")
		switch host {
		case "127.0.0.1", "localhost", "::1":
			next.ServeHTTP(w, r)
		default:
			http.Error(w, `{"error": "untrusted host"}`, http.StatusForbidden)
		}
	})
}
