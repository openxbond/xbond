package engine

import (
	"strings"
	"testing"
)

func mustParse(t *testing.T, raw string) ParsedCustomRule {
	t.Helper()
	parsed, ok := ParseCustomRule(raw)
	if !ok {
		t.Fatalf("ParseCustomRule(%q) rejected", raw)
	}
	return parsed
}

func mustReject(t *testing.T, raw string) {
	t.Helper()
	if parsed, ok := ParseCustomRule(raw); ok {
		t.Fatalf("ParseCustomRule(%q) accepted: %+v", raw, parsed)
	}
}

func TestParseCustomRuleDomain(t *testing.T) {
	for raw, want := range map[string]string{
		"example.com":                      "example.com",
		" Example.COM ":                    "example.com",
		"*.example.com":                    "example.com",
		".example.com.":                    "example.com",
		"https://sub.example.com/path?q=1": "sub.example.com",
		"example.com:8443":                 "example.com",
		"user@example.com":                 "example.com",
		"xn--fsq092a.com":                  "xn--fsq092a.com",
		"under_score.example.com":          "under_score.example.com",
	} {
		parsed := mustParse(t, raw)
		if parsed.Kind != "domain" || parsed.Value != want {
			t.Fatalf("ParseCustomRule(%q) = %+v, want domain %q", raw, parsed, want)
		}
	}
}

func TestParseCustomRuleIPAndCIDR(t *testing.T) {
	parsed := mustParse(t, "1.2.3.4")
	if parsed.Kind != "ip" || parsed.Value != "1.2.3.4" || parsed.CIDR != "1.2.3.4/32" || parsed.IPv6 {
		t.Fatalf("unexpected IPv4 parse: %+v", parsed)
	}
	parsed = mustParse(t, "10.0.0.0/8")
	if parsed.Kind != "cidr" || parsed.CIDR != "10.0.0.0/8" || parsed.IPv6 {
		t.Fatalf("unexpected IPv4 CIDR parse: %+v", parsed)
	}
	parsed = mustParse(t, "2001:db8::1")
	if parsed.Kind != "ip" || !parsed.IPv6 || parsed.CIDR != "2001:db8::1/128" {
		t.Fatalf("unexpected IPv6 parse: %+v", parsed)
	}
	parsed = mustParse(t, "https://[2001:db8::1]:443/x")
	if parsed.Kind != "ip" || !parsed.IPv6 || parsed.Value != "2001:db8::1" {
		t.Fatalf("unexpected bracketed IPv6 peel: %+v", parsed)
	}
}

func TestParseCustomRuleRejects(t *testing.T) {
	for _, raw := range []string{
		"",
		"   ",
		"256.1.1.1",
		"1.2.3",
		"01.2.3.4",
		"10.0.0.0/33",
		"2001:db8::1%eth0",
		"not a domain!",
		"http://",
		"example.com:badport:bad",
	} {
		mustReject(t, raw)
	}
}

func TestValidateDNSUpstream(t *testing.T) {
	for _, upstream := range []string{
		"1.1.1.1",
		"223.5.5.5",
		"dns.example.com",
		"tls://dns.example.com",
		"https://1.1.1.1/dns-query",
		"udp://8.8.8.8:53",
	} {
		if !validateDNSUpstream(upstream) {
			t.Fatalf("validateDNSUpstream(%q) rejected", upstream)
		}
	}
	for _, upstream := range []string{
		"",
		"gopher://example.com",
		"1.2.3.4,5.6.7.8",
		strings.Repeat("a", 300),
	} {
		if validateDNSUpstream(upstream) {
			t.Fatalf("validateDNSUpstream(%q) accepted", upstream)
		}
	}
}
