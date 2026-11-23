// Package httplocal guards LocalAPI listeners against Host-header DNS-rebinding.
// Daemon and mobile serve the LocalAPI token inside the web page at "/"
// (unauthenticated); a browser page that DNS-rebinds its own domain to
// 127.0.0.1 or a LAN address could otherwise read that token and drive the
// whole LocalAPI afterwards. We allow loopback names, IP literals (browsers do
// not DNS-resolve IP literals; loopback look-alikes such as 127.0.0.2 and
// unspecified addresses remain rejected), and non-public LAN hostnames
// (single-label names or reserved local suffixes), while rejecting external
// domains that can be DNS-rebound.
package httplocal

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

var localHostSuffixes = []string{
	".lan",
	".local",
	".home.arpa",
	".internal",
	".localdomain",
	".home",
}

// Guard wraps a LocalAPI listener's handler with the trusted Host allowlist.
func Guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(r.Host); err == nil {
			host = h
		}
		host = strings.Trim(host, "[]")
		if trustedHost(host) {
			next.ServeHTTP(w, r)
			return
		}
		http.Error(w, `{"error": "untrusted host"}`, http.StatusForbidden)
	})
}

func trustedHost(host string) bool {
	if host == "" {
		return false
	}
	if host == "127.0.0.1" || strings.EqualFold(host, "localhost") || host == "::1" {
		return true
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		unmapped := addr.Unmap()
		return !unmapped.IsLoopback() && !unmapped.IsUnspecified()
	}
	return isLocalLANHost(strings.ToLower(host))
}

func isLocalLANHost(host string) bool {
	if !isValidHostname(host) {
		return false
	}
	if !strings.Contains(host, ".") {
		return hasASCIILetter(host)
	}
	for _, suffix := range localHostSuffixes {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

func isValidHostname(host string) bool {
	if host == "" || len(host) > 253 {
		return false
	}
	for label := range strings.SplitSeq(host, ".") {
		if len(label) == 0 || len(label) > 63 {
			return false
		}
		if label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for i := 0; i < len(label); i++ {
			c := label[i]
			if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
				return false
			}
		}
	}
	return true
}

func hasASCIILetter(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 'a' && s[i] <= 'z' {
			return true
		}
	}
	return false
}
