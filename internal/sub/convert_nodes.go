package sub

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// reservedNames are mihomo's built-in outbound names; a subscription node or
// group may never shadow them.
func reservedNames() map[string]bool {
	return map[string]bool{
		"DIRECT": true, "REJECT": true, "REJECT-DROP": true,
		"COMPATIBLE": true, "PASS": true, "GLOBAL": true,
	}
}

// builtinRef maps sing-box built-in outbound tags onto their Clash equivalents.
var builtinRef = map[string]string{"direct": "DIRECT", "block": "REJECT"}

type singBoxRoute struct {
	Rules   []any  `json:"rules"`
	Final   string `json:"final"`
	RuleSet []any  `json:"rule_set"`
}

// convertSingBoxToClash converts a sing-box JSON subscription into canonical
// Clash YAML. The strict-compatibility rule is symmetric to the old
// Clash→sing-box direction: anything that cannot be preserved (unknown
// outbound types, unmappable rules, DNS sections, rule sets) is rejected
// instead of silently degraded; nodesOnly keeps only the proxy nodes with
// default groups and no rules.
func convertSingBoxToClash(sourceJSON []byte, nodesOnly bool) ([]byte, error) {
	var doc map[string]any
	if err := json.Unmarshal(sourceJSON, &doc); err != nil {
		return nil, fmt.Errorf("invalid sing-box JSON: %w", err)
	}
	for key := range doc {
		switch key {
		case "outbounds", "route", "dns", "inbounds", "experimental", "log":
			// inbounds/experimental/log describe the client app (listeners,
			// controller, log level) — the daemon owns all of those, so they
			// are intentionally dropped, not lost subscription content.
		default:
			return nil, fmt.Errorf("sing-box: unsupported top-level field %q", key)
		}
	}

	if dns, _ := doc["dns"].(map[string]any); !nodesOnly && len(dns) > 0 {
		return nil, fmt.Errorf("sing-box DNS settings cannot be preserved in Clash; import with node-only mode or use a Clash YAML subscription")
	}

	route := &singBoxRoute{}
	if rawRoute, ok := doc["route"].(map[string]any); ok {
		if err := remarshal(rawRoute, route); err != nil {
			return nil, fmt.Errorf("sing-box: invalid route section: %w", err)
		}
		if len(route.RuleSet) > 0 && !nodesOnly {
			return nil, fmt.Errorf("sing-box rule sets cannot be preserved in Clash; import with node-only mode")
		}
	}

	rawOutbounds, _ := doc["outbounds"].([]any)

	// Pass 1: collect definitions and validate names before resolving any
	// reference, so groups may reference outbounds declared later.
	type definition struct {
		index    int
		location string
		kind     string
		ob       map[string]any
	}
	defs := make([]definition, 0, len(rawOutbounds))
	names := reservedNames()
	for index, rawOb := range rawOutbounds {
		ob, ok := rawOb.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("outbounds[%d]: not an object", index)
		}
		kind, _ := ob["type"].(string)
		location := fmt.Sprintf("outbounds[%d]", index)
		switch kind {
		case "direct", "block":
			continue
		case "dns":
			// No Clash equivalent; references to it fail resolution below.
			continue
		case "shadowsocks", "trojan", "vless", "vmess", "socks", "http", "selector", "urltest":
		default:
			return nil, fmt.Errorf("%s: unsupported outbound type %q", location, kind)
		}
		tag, _ := ob["tag"].(string)
		if tag == "" || names[tag] {
			return nil, fmt.Errorf("%s: missing, duplicate or reserved tag", location)
		}
		names[tag] = true
		defs = append(defs, definition{index: index, location: location, kind: kind, ob: ob})
	}

	resolveRef := func(ref any, location string) (string, error) {
		name, ok := ref.(string)
		if !ok || name == "" {
			return "", fmt.Errorf("%s: invalid outbound reference", location)
		}
		if mapped, isBuiltin := builtinRef[name]; isBuiltin {
			return mapped, nil
		}
		if names[name] {
			return name, nil
		}
		return "", fmt.Errorf("%s: unresolved outbound reference %q", location, name)
	}

	var nodes []map[string]any
	var groups []map[string]any
	var firstGroup string
	for _, def := range defs {
		switch def.kind {
		case "shadowsocks", "trojan", "vless", "vmess", "socks", "http":
			proxy, err := convertSingBoxNode(def.ob, def.location)
			if err != nil {
				return nil, err
			}
			nodes = append(nodes, proxy)
		case "selector", "urltest":
			if nodesOnly {
				continue
			}
			group, err := convertSingBoxGroup(def.ob, def.location, resolveRef)
			if err != nil {
				return nil, err
			}
			if firstGroup == "" {
				firstGroup, _ = group["name"].(string)
			}
			groups = append(groups, group)
		}
	}

	if len(nodes) == 0 {
		return nil, fmt.Errorf("sing-box: no convertible proxy nodes")
	}

	// Pass 2: rules. nodesOnly discards them together with the groups.
	var rules []any
	if !nodesOnly {
		var err error
		rules, err = convertSingBoxRules(route, firstGroup, resolveRef)
		if err != nil {
			return nil, err
		}
	}

	if len(groups) == 0 {
		groups = defaultGroups(nodeTags(nodes))
		if len(rules) == 0 {
			rules = []any{"MATCH,Proxy"}
		}
	}

	converted := map[string]any{
		"proxies":      nodes,
		"proxy-groups": groups,
	}
	if len(rules) > 0 {
		converted["rules"] = rules
	}
	return yaml.Marshal(converted)
}

func nodeTags(nodes []map[string]any) []string {
	tags := make([]string, 0, len(nodes))
	for _, node := range nodes {
		tag, _ := node["name"].(string)
		tags = append(tags, tag)
	}
	return tags
}

func defaultGroups(tags []string) []map[string]any {
	members := make([]any, 0, len(tags)+1)
	members = append(members, "Auto")
	for _, tag := range tags {
		members = append(members, tag)
	}
	return []map[string]any{
		{"name": "Proxy", "type": "select", "proxies": members},
		{"name": "Auto", "type": "url-test", "proxies": toAnySlice(tags), "url": "https://www.gstatic.com/generate_204", "interval": 300},
	}
}

func toAnySlice(values []string) []any {
	out := make([]any, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
}

func remarshal(raw any, target any) error {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, target)
}

// checkFields reports unsupported keys with their location, never their
// values, so diagnostics stay free of credentials.
func checkFields(fields map[string]any, location string, allowed ...string) error {
	known := make(map[string]bool, len(allowed))
	for _, field := range allowed {
		known[field] = true
	}
	var unsupported []string
	for key := range fields {
		if !known[key] {
			unsupported = append(unsupported, key)
		}
	}
	if len(unsupported) > 0 {
		return fmt.Errorf("%s: unsupported fields: %s", location, strings.Join(unsupported, ", "))
	}
	return nil
}

func nodeInteger(value any) (int, bool) {
	switch value := value.(type) {
	case int:
		return value, true
	case float64:
		return int(value), true
	case string:
		parsed, err := strconv.Atoi(value)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func nodeBool(value any) (bool, bool) {
	enabled, ok := value.(bool)
	return enabled, ok
}

func requireString(fields map[string]any, location, field string) (string, error) {
	value, _ := fields[field].(string)
	if value == "" {
		return "", fmt.Errorf("%s: missing or invalid %s", location, field)
	}
	return value, nil
}

// convertSingBoxNode maps one proxy outbound onto its Clash shape. Field
// allowlists keep the conversion honest: anything not listed is reported
// instead of dropped.
func convertSingBoxNode(ob map[string]any, location string) (map[string]any, error) {
	kind, _ := ob["type"].(string)
	tag, _ := ob["tag"].(string)

	var allowed []string
	switch kind {
	case "shadowsocks":
		allowed = []string{"type", "tag", "server", "server_port", "method", "password", "udp_over_tcp"}
	case "trojan":
		allowed = []string{"type", "tag", "server", "server_port", "password", "tls", "transport"}
	case "vless":
		allowed = []string{"type", "tag", "server", "server_port", "uuid", "flow", "tls", "transport"}
	case "vmess":
		allowed = []string{"type", "tag", "server", "server_port", "uuid", "security", "alter_id", "tls", "transport"}
	case "socks":
		allowed = []string{"type", "tag", "server", "server_port", "version", "username", "password"}
	case "http":
		allowed = []string{"type", "tag", "server", "server_port", "username", "password", "tls"}
	}
	if err := checkFields(ob, location, allowed...); err != nil {
		return nil, err
	}

	server, err := requireString(ob, location, "server")
	if err != nil {
		return nil, err
	}
	port, ok := nodeInteger(ob["server_port"])
	if !ok || port < 1 || port > 65535 {
		return nil, fmt.Errorf("%s: missing or invalid server_port", location)
	}

	proxy := map[string]any{"name": tag, "server": server, "port": port}
	switch kind {
	case "shadowsocks":
		cipher, err := requireString(ob, location, "method")
		if err != nil {
			return nil, err
		}
		password, err := requireString(ob, location, "password")
		if err != nil {
			return nil, err
		}
		proxy["type"] = "ss"
		proxy["cipher"] = cipher
		proxy["password"] = password
		proxy["udp"] = true
	case "trojan", "vless", "vmess":
		proxy["type"] = kind
		proxy["udp"] = true
		if kind == "trojan" {
			password, err := requireString(ob, location, "password")
			if err != nil {
				return nil, err
			}
			proxy["password"] = password
		} else {
			uuid, err := requireString(ob, location, "uuid")
			if err != nil {
				return nil, err
			}
			proxy["uuid"] = uuid
			if kind == "vmess" {
				cipher, _ := ob["security"].(string)
				if cipher == "" {
					cipher = "auto"
				}
				proxy["cipher"] = cipher
				if alterID, exists := ob["alter_id"]; exists {
					value, ok := nodeInteger(alterID)
					if !ok || value < 0 {
						return nil, fmt.Errorf("%s: invalid alter_id", location)
					}
					proxy["alterId"] = value
				}
			}
		}
		tlsFields, tlsEnabled, err := mapSingBoxTLS(ob["tls"], location, kind)
		if err != nil {
			return nil, err
		}
		// Clash names the TLS server name "sni" on trojan/http but
		// "servername" on vless/vmess.
		if sni, hasSNI := tlsFields["servername"]; hasSNI && (kind == "trojan" || kind == "http") {
			delete(tlsFields, "servername")
			tlsFields["sni"] = sni
		}
		for key, value := range tlsFields {
			proxy[key] = value
		}
		if kind == "trojan" && !tlsEnabled {
			return nil, fmt.Errorf("%s: trojan requires TLS", location)
		}
		if kind == "vless" {
			if flow, exists := ob["flow"]; exists {
				value, _ := flow.(string)
				proxy["flow"] = value
			}
		}
	case "socks":
		version, _ := ob["version"].(string)
		if version != "" && version != "5" {
			return nil, fmt.Errorf("%s: unsupported socks version %q", location, version)
		}
		proxy["type"] = "socks5"
		proxy["udp"] = true
		for _, field := range []string{"username", "password"} {
			if value, exists := ob[field]; exists {
				text, ok := value.(string)
				if !ok {
					return nil, fmt.Errorf("%s: invalid %s", location, field)
				}
				proxy[field] = text
			}
		}
	case "http":
		proxy["type"] = "http"
		for _, field := range []string{"username", "password"} {
			if value, exists := ob[field]; exists {
				text, ok := value.(string)
				if !ok {
					return nil, fmt.Errorf("%s: invalid %s", location, field)
				}
				proxy[field] = text
			}
		}
		tlsFields, _, err := mapSingBoxTLS(ob["tls"], location, kind)
		if err != nil {
			return nil, err
		}
		if sni, hasSNI := tlsFields["servername"]; hasSNI {
			delete(tlsFields, "servername")
			tlsFields["sni"] = sni
		}
		for key, value := range tlsFields {
			proxy[key] = value
		}
	}

	transportFields, hasTransport, err := mapSingBoxTransport(ob["transport"], location)
	if err != nil {
		return nil, err
	}
	if hasTransport {
		for key, value := range transportFields {
			proxy[key] = value
		}
	}
	return proxy, nil
}

// mapSingBoxTLS converts a sing-box TLS stanza (including REALITY) into the
// flat Clash fields. The returned bool reports whether TLS is enabled.
func mapSingBoxTLS(raw any, location string, kind string) (map[string]any, bool, error) {
	tls, ok := raw.(map[string]any)
	if !ok || raw == nil {
		if kind == "trojan" || kind == "vless" {
			// Both default to TLS in sing-box; emit no Clash TLS fields and
			// let the caller's minimum-TLS check decide.
			return nil, true, nil
		}
		return nil, false, nil
	}
	if err := checkFields(tls, location+" tls", "enabled", "server_name", "insecure", "alpn", "utls", "disable_sni", "reality"); err != nil {
		return nil, false, err
	}
	enabled := true
	if value, exists := tls["enabled"]; exists {
		enabled, ok = nodeBool(value)
		if !ok {
			return nil, false, fmt.Errorf("%s: invalid tls.enabled", location)
		}
	}
	if !enabled {
		return nil, false, nil
	}

	fields := map[string]any{"tls": true}
	if serverName, _ := tls["server_name"].(string); serverName != "" {
		fields["servername"] = serverName
	}
	if insecure, exists := tls["insecure"]; exists {
		value, ok := nodeBool(insecure)
		if !ok {
			return nil, false, fmt.Errorf("%s: invalid tls.insecure", location)
		}
		fields["skip-cert-verify"] = value
	}
	if alpn, exists := tls["alpn"]; exists {
		items, ok := alpn.([]any)
		if !ok {
			return nil, false, fmt.Errorf("%s: invalid tls.alpn", location)
		}
		for _, item := range items {
			if _, ok := item.(string); !ok {
				return nil, false, fmt.Errorf("%s: invalid tls.alpn", location)
			}
		}
		fields["alpn"] = items
	}
	if utls, exists := tls["utls"]; exists {
		utlsMap, ok := utls.(map[string]any)
		if !ok {
			return nil, false, fmt.Errorf("%s: invalid tls.utls", location)
		}
		if err := checkFields(utlsMap, location+" tls.utls", "enabled", "fingerprint"); err != nil {
			return nil, false, err
		}
		if fingerprint, _ := utlsMap["fingerprint"].(string); fingerprint != "" {
			fields["client-fingerprint"] = fingerprint
		}
	}
	if reality, exists := tls["reality"]; exists {
		realityMap, ok := reality.(map[string]any)
		if !ok {
			return nil, false, fmt.Errorf("%s: invalid tls.reality", location)
		}
		if err := checkFields(realityMap, location+" tls.reality", "enabled", "public_key", "short_id"); err != nil {
			return nil, false, err
		}
		realityEnabled, _ := nodeBool(realityMap["enabled"])
		if realityEnabled {
			publicKey, err := requireString(realityMap, location+" tls.reality", "public_key")
			if err != nil {
				return nil, false, err
			}
			realityOpts := map[string]any{"public-key": publicKey}
			if shortID, _ := realityMap["short_id"].(string); shortID != "" {
				realityOpts["short-id"] = shortID
			}
			if _, hasFingerprint := fields["client-fingerprint"]; !hasFingerprint {
				return nil, false, fmt.Errorf("%s: REALITY requires a uTLS fingerprint", location)
			}
			fields["reality-opts"] = realityOpts
		}
	}
	return fields, true, nil
}

// mapSingBoxTransport converts a sing-box transport stanza. Only WebSocket is
// supported, matching the historical conversion surface.
func mapSingBoxTransport(raw any, location string) (map[string]any, bool, error) {
	transport, ok := raw.(map[string]any)
	if !ok || raw == nil {
		return nil, false, nil
	}
	network, _ := transport["type"].(string)
	if network != "ws" {
		return nil, false, fmt.Errorf("%s: unsupported transport type %q (only ws)", location, network)
	}
	if err := checkFields(transport, location+" transport", "type", "path", "headers", "max_early_data", "early_data_header_name"); err != nil {
		return nil, false, err
	}
	wsOpts := map[string]any{}
	if path, _ := transport["path"].(string); path != "" {
		wsOpts["path"] = path
	}
	if headers, exists := transport["headers"]; exists {
		headersMap, ok := headers.(map[string]any)
		if !ok {
			return nil, false, fmt.Errorf("%s: invalid transport.headers", location)
		}
		wsOpts["headers"] = headersMap
	}
	if maxEarlyData, exists := transport["max_early_data"]; exists {
		value, ok := nodeInteger(maxEarlyData)
		if !ok || value < 0 {
			return nil, false, fmt.Errorf("%s: invalid transport.max_early_data", location)
		}
		wsOpts["max-early-data"] = value
	}
	if headerName, exists := transport["early_data_header_name"]; exists {
		value, _ := headerName.(string)
		wsOpts["early-data-header-name"] = value
	}
	return map[string]any{"network": "ws", "ws-opts": wsOpts}, true, nil
}

func convertSingBoxGroup(
	ob map[string]any,
	location string,
	resolveRef func(any, string) (string, error),
) (map[string]any, error) {
	kind, _ := ob["type"].(string)
	name, _ := ob["tag"].(string)
	allowed := []string{"type", "tag", "outbounds", "interrupt_exist_connections"}
	if kind == "urltest" {
		allowed = append(allowed, "url", "interval", "tolerance", "idle_timeout")
	}
	if err := checkFields(ob, location, allowed...); err != nil {
		return nil, err
	}
	members, ok := ob["outbounds"].([]any)
	if !ok || len(members) == 0 {
		return nil, fmt.Errorf("%s: a non-empty outbounds list is required", location)
	}
	references := make([]any, 0, len(members))
	for _, member := range members {
		reference, err := resolveRef(member, location)
		if err != nil {
			return nil, err
		}
		references = append(references, reference)
	}
	groupType := "select"
	if kind == "urltest" {
		groupType = "url-test"
	}
	group := map[string]any{"name": name, "type": groupType, "proxies": references}
	if kind == "urltest" {
		group["url"] = "https://www.gstatic.com/generate_204"
		group["interval"] = 300
		if rawURL, exists := ob["url"]; exists {
			text, _ := rawURL.(string)
			parsed, err := url.Parse(text)
			if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
				return nil, fmt.Errorf("%s: invalid test URL", location)
			}
			group["url"] = text
		}
		if rawInterval, exists := ob["interval"]; exists {
			text, _ := rawInterval.(string)
			duration, err := time.ParseDuration(text)
			if err != nil || duration <= 0 {
				return nil, fmt.Errorf("%s: invalid interval", location)
			}
			group["interval"] = int(duration.Seconds())
		}
		if tolerance, exists := ob["tolerance"]; exists {
			value, ok := nodeInteger(tolerance)
			if !ok || value < 0 {
				return nil, fmt.Errorf("%s: invalid tolerance", location)
			}
			group["tolerance"] = value
		}
	}
	return group, nil
}

// convertSingBoxRules maps sing-box route rules onto Clash rule strings. Only
// literal match types with a Clash equivalent are accepted; anything else is
// named and rejected so an import never silently changes routing behaviour.
func convertSingBoxRules(
	route *singBoxRoute,
	firstGroup string,
	resolveRef func(any, string) (string, error),
) ([]any, error) {
	stringMappings := []struct {
		field  string
		rule   string
		suffix string
	}{
		{"domain", "DOMAIN", ""},
		{"domain_suffix", "DOMAIN-SUFFIX", ""},
		{"domain_keyword", "DOMAIN-KEYWORD", ""},
		{"domain_regex", "DOMAIN-REGEX", ""},
		{"geosite", "GEOSITE", ""},
		{"geoip", "GEOIP", ",no-resolve"},
		{"ip_cidr", "IP-CIDR", ",no-resolve"},
	}
	var rules []any
	for index, rawRule := range route.Rules {
		rule, ok := rawRule.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("route.rules[%d]: not an object", index)
		}
		location := fmt.Sprintf("route.rules[%d]", index)
		if _, isLogical := rule["logic"]; isLogical {
			return nil, fmt.Errorf("%s: logical rules are unsupported", location)
		}
		if err := checkFields(rule, location,
			"domain", "domain_suffix", "domain_keyword", "domain_regex",
			"ip_cidr", "geoip", "geosite", "port", "outbound"); err != nil {
			return nil, err
		}
		target, exists := rule["outbound"]
		if !exists {
			return nil, fmt.Errorf("%s: missing outbound", location)
		}
		outbound, err := resolveRef(target, location)
		if err != nil {
			return nil, err
		}
		appended := 0
		for _, mapping := range stringMappings {
			values, exists := rule[mapping.field]
			if !exists {
				continue
			}
			items, ok := values.([]any)
			if !ok {
				items = []any{values}
			}
			for _, item := range items {
				value, ok := item.(string)
				if !ok {
					return nil, fmt.Errorf("%s: invalid %s value", location, mapping.field)
				}
				// Clash rule params: TYPE,ARG,POLICY,PARAM... — the policy
				// target precedes modifiers like no-resolve.
				rules = append(rules, fmt.Sprintf("%s,%s,%s%s", mapping.rule, value, outbound, mapping.suffix))
				appended++
			}
		}
		if ports, exists := rule["port"]; exists {
			items, ok := ports.([]any)
			if !ok {
				items = []any{ports}
			}
			for _, item := range items {
				value, ok := nodeInteger(item)
				if !ok || value < 1 || value > 65535 {
					return nil, fmt.Errorf("%s: invalid port value", location)
				}
				rules = append(rules, fmt.Sprintf("DST-PORT,%d,%s", value, outbound))
				appended++
			}
		}
		if appended == 0 {
			return nil, fmt.Errorf("%s: no mappable match conditions", location)
		}
	}

	if route.Final != "" {
		final, err := resolveRef(route.Final, "route.final")
		if err != nil {
			return nil, err
		}
		rules = append(rules, fmt.Sprintf("MATCH,%s", final))
		return rules, nil
	}
	final := firstGroup
	if final == "" {
		final = "DIRECT"
	}
	rules = append(rules, fmt.Sprintf("MATCH,%s", final))
	return rules, nil
}

// buildClashFromProxies wraps a node list into a runnable Clash document with
// the same default Proxy/Auto group pair the share-link path always produced.
func buildClashFromProxies(proxies []map[string]any) ([]byte, error) {
	if len(proxies) == 0 {
		return nil, fmt.Errorf("no usable nodes found")
	}
	used := reservedNames()
	tags := make([]string, 0, len(proxies))
	for index, proxy := range proxies {
		name, _ := proxy["name"].(string)
		if name == "" || used[name] {
			return nil, fmt.Errorf("node %d: missing, duplicate or reserved name", index)
		}
		used[name] = true
		tags = append(tags, name)
	}
	doc := map[string]any{
		"proxies":      proxies,
		"proxy-groups": defaultGroups(tags),
		"rules":        []any{"MATCH,Proxy"},
	}
	return yaml.Marshal(doc)
}

// parseProxyURI parses a trojan/vless share link into a Clash proxy map.
// The query allowlist matches the historical converter; anything else is
// rejected rather than silently dropped.
func parseProxyURI(text string) (map[string]any, error) {
	parsed, err := url.Parse(text)
	if err != nil || parsed.User == nil || parsed.User.Username() == "" || parsed.Hostname() == "" {
		return nil, fmt.Errorf("invalid share link")
	}
	if parsed.Scheme != "trojan" && parsed.Scheme != "vless" {
		return nil, fmt.Errorf("unsupported share-link protocol")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return nil, fmt.Errorf("unsupported share-link path; WebSocket paths use the path query option")
	}
	port := 443
	if parsed.Port() != "" {
		port, err = strconv.Atoi(parsed.Port())
		if err != nil || port < 1 || port > 65535 {
			return nil, fmt.Errorf("invalid share-link port")
		}
	}
	query, err := url.ParseQuery(parsed.RawQuery)
	if err != nil {
		return nil, fmt.Errorf("invalid share-link options")
	}
	for key, values := range query {
		if len(values) != 1 {
			return nil, fmt.Errorf("duplicate share-link option")
		}
		switch key {
		case "sni", "security", "type", "path", "host", "flow":
		default:
			return nil, fmt.Errorf("unsupported share-link option")
		}
	}
	name := parsed.Fragment
	if name == "" {
		name = parsed.Host
	}
	proxy := map[string]any{"type": parsed.Scheme, "name": name, "server": parsed.Hostname(), "port": port}
	if parsed.Scheme == "trojan" {
		proxy["password"] = parsed.User.Username()
		if query.Get("sni") != "" {
			proxy["sni"] = query.Get("sni")
		}
	} else {
		proxy["uuid"] = parsed.User.Username()
		proxy["tls"] = query.Get("security") == "tls"
		if query.Get("sni") != "" {
			proxy["servername"] = query.Get("sni")
		}
		if query.Get("flow") != "" {
			proxy["flow"] = query.Get("flow")
		}
	}
	if _, hasPassword := parsed.User.Password(); hasPassword {
		return nil, fmt.Errorf("unsupported share-link userinfo")
	}
	if security := query.Get("security"); security != "" && security != "tls" && !(security == "none" && parsed.Scheme == "vless") {
		return nil, fmt.Errorf("unsupported share-link security")
	}
	if network := query.Get("type"); network != "" && network != "tcp" && network != "ws" {
		return nil, fmt.Errorf("unsupported share-link transport %q", network)
	}
	if query.Get("type") == "ws" {
		proxy["network"] = "ws"
		opts := map[string]any{}
		if query.Get("path") != "" {
			opts["path"] = query.Get("path")
		}
		if query.Get("host") != "" {
			opts["headers"] = map[string]any{"Host": query.Get("host")}
		}
		proxy["ws-opts"] = opts
	} else if query.Has("path") || query.Has("host") {
		return nil, fmt.Errorf("WebSocket options require type=ws")
	}
	if parsed.Scheme == "trojan" && query.Has("flow") {
		return nil, fmt.Errorf("flow is unsupported for Trojan")
	}
	return proxy, nil
}
