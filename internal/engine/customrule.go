package engine

import (
	"net"
	"regexp"
	"strings"

	"golang.org/x/net/idna"
)

// ParsedCustomRule is one normalized custom routing entry: a domain suffix,
// a single IP (shown as the plain address, expanded to /32 or /128 at render
// time) or a CIDR block. It mirrors the Cloud custom-rules value contract
// (packages/core/custom-rules): one text box in, domain/IP/CIDR out, so the
// desktop UI and the daemon never disagree about what a line means.
type ParsedCustomRule struct {
	Kind  string // "domain", "ip" or "cidr"
	Value string // display/normalized value
	CIDR  string // render-time CIDR for ip/cidr kinds
	IPv6  bool
}

var domainLabelPattern = regexp.MustCompile(`^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$`)

// ParseCustomRule normalizes one user-entered line. It accepts bare domains,
// IPs and CIDRs plus the paste shapes users actually produce (full URLs,
// host:port, host/path, "*.example.com", ".example.com"). Empty input
// reports ok=false so callers can drop blank lines without an error.
func ParseCustomRule(raw string) (ParsedCustomRule, bool) {
	value := strings.ToLower(strings.TrimSpace(stripZeroWidth(raw)))
	if value == "" {
		return ParsedCustomRule{}, false
	}

	// 1. CIDR: a slash whose left side is an IP literal (or something shaped
	// like a dotted number) must parse strictly — 10.0.0.0/33 stays invalid
	// instead of degrading into a plain IP.
	if slash := strings.Index(value, "/"); slash != -1 {
		left := value[:slash]
		if isIPLiteral(left) || isDottedNumber(left) {
			if cidr, ok := parseCIDR(value); ok {
				return cidr, true
			}
			return ParsedCustomRule{}, false
		}
	}
	if addr, ok := parseAddress(value); ok {
		return addr, true
	}

	// A dotted number that is not a valid address (256.1.1.1, 1.2.3) must not
	// fall through to the URL/domain branches.
	if isDottedNumber(value) {
		return ParsedCustomRule{}, false
	}

	// 2. URL / host:port / host/path: peel the shell, judge the hostname.
	if host := extractHost(value); host != "" && host != value {
		if addr, ok := parseAddress(host); ok {
			return addr, true
		}
		if domain, ok := parseDomain(host); ok {
			return domain, true
		}
	}

	// 3. Plain domain.
	if domain, ok := parseDomain(value); ok {
		return domain, true
	}
	return ParsedCustomRule{}, false
}

// normalizeCustomRule returns the stored display value for one line, or false
// when the line is blank or invalid.
func normalizeCustomRule(raw string) (string, bool) {
	parsed, ok := ParseCustomRule(raw)
	if !ok {
		return "", false
	}
	return parsed.Value, true
}

// validateDNSUpstream reports whether s is a usable DNS upstream entry: a
// plain IP, a hostname, or a DNS URL (udp/tcp/tls/https/http). Clash
// nameserver/fallback entries and sing-box server addresses share this
// vocabulary, so one check serves both cores.
func validateDNSUpstream(s string) bool {
	value := strings.ToLower(strings.TrimSpace(stripZeroWidth(s)))
	if value == "" || len(value) > 256 || strings.ContainsAny(value, " \t\r\n,") {
		return false
	}
	if idx := strings.Index(value, "://"); idx != -1 {
		scheme := value[:idx]
		switch scheme {
		case "udp", "tcp", "tls", "https", "http", "dhcp":
		default:
			return false
		}
		rest := value[idx+3:]
		if rest == "" {
			return false
		}
		host := rest
		if end := strings.IndexAny(host, "/?#"); end != -1 {
			host = host[:end]
		}
		host = stripPort(host)
		if host == "" {
			return false
		}
		if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
			return true
		}
		_, ok := parseDomain(host)
		return ok
	}
	if ip := net.ParseIP(strings.Trim(value, "[]")); ip != nil {
		return true
	}
	_, ok := parseDomain(stripPort(value))
	return ok
}

func stripZeroWidth(s string) string {
	return strings.Map(func(r rune) rune {
		switch r {
		case '\u200b', '\u200c', '\u200d', '\ufeff':
			return -1
		}
		return r
	}, s)
}

func isIPLiteral(s string) bool {
	return parseIPv4(s) != "" || parseIPv6(s) != ""
}

func isDottedNumber(s string) bool {
	if s == "" {
		return false
	}
	for _, part := range strings.Split(s, ".") {
		if part == "" {
			return false
		}
		for _, r := range part {
			if r < '0' || r > '9' {
				return false
			}
		}
	}
	return true
}

func parseAddress(value string) (ParsedCustomRule, bool) {
	if ipv4 := parseIPv4(value); ipv4 != "" {
		return ParsedCustomRule{Kind: "ip", Value: ipv4, CIDR: ipv4 + "/32"}, true
	}
	if ipv6 := parseIPv6(value); ipv6 != "" {
		return ParsedCustomRule{Kind: "ip", Value: ipv6, CIDR: ipv6 + "/128", IPv6: true}, true
	}
	return ParsedCustomRule{}, false
}

func parseCIDR(value string) (ParsedCustomRule, bool) {
	slash := strings.Index(value, "/")
	if slash == -1 || strings.Contains(value[slash+1:], "/") {
		return ParsedCustomRule{}, false
	}
	prefixPart := value[slash+1:]
	if prefixPart == "" || len(prefixPart) > 3 {
		return ParsedCustomRule{}, false
	}
	prefix := 0
	for _, r := range prefixPart {
		if r < '0' || r > '9' {
			return ParsedCustomRule{}, false
		}
		prefix = prefix*10 + int(r-'0')
	}
	if ipv4 := parseIPv4(value[:slash]); ipv4 != "" {
		if prefix > 32 {
			return ParsedCustomRule{}, false
		}
		cidr := ipv4 + "/" + prefixPart
		return ParsedCustomRule{Kind: "cidr", Value: cidr, CIDR: cidr}, true
	}
	if ipv6 := parseIPv6(value[:slash]); ipv6 != "" {
		if prefix > 128 {
			return ParsedCustomRule{}, false
		}
		cidr := ipv6 + "/" + prefixPart
		return ParsedCustomRule{Kind: "cidr", Value: cidr, CIDR: cidr, IPv6: true}, true
	}
	return ParsedCustomRule{}, false
}

// parseIPv4 is strict dotted-decimal: four 0-255 octets, no leading zeros
// (which URLs would otherwise read as octal).
func parseIPv4(value string) string {
	parts := strings.Split(value, ".")
	if len(parts) != 4 {
		return ""
	}
	octets := make([]string, 0, 4)
	for _, part := range parts {
		if part == "" || len(part) > 3 {
			return ""
		}
		if len(part) > 1 && part[0] == '0' {
			return ""
		}
		n := 0
		for _, r := range part {
			if r < '0' || r > '9' {
				return ""
			}
			n = n*10 + int(r-'0')
		}
		if n > 255 {
			return ""
		}
		octets = append(octets, part)
	}
	// Rejoin through net.ParseIP to canonicalize, then format back without
	// any leading-zero residue.
	ip := net.ParseIP(strings.Join(octets, "."))
	if ip == nil {
		return ""
	}
	if v4 := ip.To4(); v4 != nil {
		return v4.String()
	}
	return ""
}

func parseIPv6(value string) string {
	trimmed := strings.Trim(value, "[]")
	if !strings.Contains(trimmed, ":") {
		return ""
	}
	// Zone ids never route; reject them instead of silently dropping the zone.
	if strings.Contains(trimmed, "%") {
		return ""
	}
	ip := net.ParseIP(trimmed)
	if ip == nil || ip.To4() != nil {
		return ""
	}
	return ip.String()
}

func parseDomain(value string) (ParsedCustomRule, bool) {
	ascii, err := idna.ToASCII(value)
	if err != nil {
		return ParsedCustomRule{}, false
	}
	domain := strings.ToLower(ascii)
	domain = strings.TrimPrefix(domain, "*.")
	domain = strings.Trim(domain, ".")
	if domain == "" || len(domain) > 253 {
		return ParsedCustomRule{}, false
	}
	labels := strings.Split(domain, ".")
	for _, label := range labels {
		if !domainLabelPattern.MatchString(label) {
			return ParsedCustomRule{}, false
		}
	}
	// A purely numeric TLD is a mistyped IP, not a hostname.
	tld := labels[len(labels)-1]
	if isDottedNumber(tld) {
		return ParsedCustomRule{}, false
	}
	return ParsedCustomRule{Kind: "domain", Value: domain}, true
}

// extractHost peels URL/port/path shells down to a hostname. A bare hostname
// parses back to itself, so callers only take the peeled detour when it
// differs from the input.
func extractHost(value string) string {
	rest := value
	if idx := strings.Index(rest, "://"); idx != -1 {
		rest = rest[idx+3:]
		if rest == "" {
			return ""
		}
	} else if strings.HasPrefix(rest, "//") {
		rest = rest[2:]
	} else if !strings.Contains(rest, "/") && !strings.Contains(rest, "?") && !strings.Contains(rest, "#") && !strings.Contains(rest, "@") && strings.Count(rest, ":") <= 1 {
		// Bare host or host:port: peel the port, judge the hostname below.
		// IPv6 literals (several colons) fall through to parseAddress.
		host := stripPort(rest)
		host = strings.Trim(host, "[]")
		if ip := net.ParseIP(host); ip != nil {
			return host
		}
		if _, ok := parseDomain(host); ok {
			return strings.ToLower(host)
		}
		return rest
	}
	// Strip userinfo, then cut at the first path/query/fragment boundary.
	if at := strings.LastIndex(rest, "@"); at != -1 {
		rest = rest[at+1:]
	}
	if end := strings.IndexAny(rest, "/?#"); end != -1 {
		rest = rest[:end]
	}
	host := stripPort(rest)
	host = strings.Trim(host, "[]")
	if host == "" {
		return ""
	}
	ascii, err := idna.ToASCII(strings.ToLower(host))
	if err != nil {
		return ""
	}
	return strings.ToLower(ascii)
}

func stripPort(hostport string) string {
	if strings.HasPrefix(hostport, "[") {
		if end := strings.Index(hostport, "]"); end != -1 {
			return hostport[1:end]
		}
		return hostport
	}
	// A bare IPv6 address holds several colons and no port; a single colon
	// separates host:port.
	if strings.Count(hostport, ":") != 1 {
		return hostport
	}
	if idx := strings.LastIndex(hostport, ":"); idx != -1 {
		return hostport[:idx]
	}
	return hostport
}
