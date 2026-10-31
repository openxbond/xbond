package sub

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// Diagnostics identify fields and list positions, never credentials or source text.
func checkFields(fields map[string]any, location string, allowed ...string) error {
	known := make(map[string]bool, len(allowed))
	for _, field := range allowed {
		known[field] = true
	}
	var unsupported []string
	for key := range fields {
		if !known[key] {
			safe := key
			if len(safe) > 48 || strings.IndexFunc(safe, func(r rune) bool {
				return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-')
			}) >= 0 {
				safe = "unknown-field"
			}
			unsupported = append(unsupported, safe)
		}
	}
	if len(unsupported) > 0 {
		sort.Strings(unsupported)
		return fmt.Errorf("%s: unsupported fields %s", location, strings.Join(unsupported, ", "))
	}
	return nil
}

func nodeInteger(value any) (int, bool) {
	switch value := value.(type) {
	case int:
		return value, true
	case string:
		parsed, err := strconv.Atoi(value)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func convertClashToSingBox(clash *ClashConfig) ([]byte, error) {
	var nodes []map[string]any
	var tags []string
	used := map[string]bool{"DIRECT": true}
	for index, proxy := range clash.Proxies {
		node, err := convertClashProxy(proxy)
		if err != nil {
			return nil, fmt.Errorf("proxies[%d]: %w", index, err)
		}
		tag := node["tag"].(string)
		if used[tag] {
			return nil, fmt.Errorf("proxies[%d]: duplicate or reserved name", index)
		}
		used[tag] = true
		nodes = append(nodes, node)
		tags = append(tags, tag)
	}
	if len(clash.ProxyGroups) == 0 {
		return buildSingBoxFromOutbounds(nodes, tags)
	}
	for index, group := range clash.ProxyGroups {
		name, _ := group["name"].(string)
		if name == "" || used[name] {
			return nil, fmt.Errorf("proxy-groups[%d]: missing, duplicate or reserved name", index)
		}
		used[name] = true
	}
	outbounds := append(nodes, map[string]any{"type": "direct", "tag": "DIRECT"})
	dependencies := make(map[string][]string, len(clash.ProxyGroups))
	for index, group := range clash.ProxyGroups {
		location := fmt.Sprintf("proxy-groups[%d]", index)
		kind, _ := group["type"].(string)
		allowed := []string{"name", "type", "proxies"}
		if kind == "url-test" {
			allowed = append(allowed, "url", "interval", "tolerance")
		} else if kind != "select" {
			return nil, fmt.Errorf("%s: unsupported strategy type", location)
		}
		if err := checkFields(group, location, allowed...); err != nil {
			return nil, err
		}
		members, ok := group["proxies"].([]any)
		if !ok || len(members) == 0 {
			return nil, fmt.Errorf("%s: a non-empty proxy list is required", location)
		}
		var references []string
		for _, member := range members {
			name, ok := member.(string)
			if !ok || !used[name] {
				return nil, fmt.Errorf("%s: unresolved proxy reference", location)
			}
			references = append(references, name)
		}
		outbound := map[string]any{"type": "selector", "tag": group["name"], "outbounds": references}
		dependencies[group["name"].(string)] = references
		if kind == "url-test" {
			outbound["type"] = "urltest"
			outbound["url"] = "https://www.gstatic.com/generate_204"
			outbound["interval"] = "300s"
			if value, exists := group["url"]; exists {
				text, ok := value.(string)
				parsed, err := url.Parse(text)
				if !ok || err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
					return nil, fmt.Errorf("%s: invalid test URL", location)
				}
				outbound["url"] = text
			}
			for _, field := range []string{"interval", "tolerance"} {
				if value, exists := group[field]; exists {
					number, ok := nodeInteger(value)
					if !ok || number < 0 || field == "interval" && number == 0 {
						return nil, fmt.Errorf("%s: invalid %s", location, field)
					}
					if field == "interval" {
						outbound[field] = strconv.Itoa(number) + "s"
					} else {
						outbound[field] = number
					}
				}
			}
		}
		outbounds = append(outbounds, outbound)
	}
	// The core resolves selector dependencies at Start, after our validation
	// gate. Reject cycles here so an unusable graph is never saved as valid.
	visited := make(map[string]uint8, len(dependencies))
	var visit func(string) error
	visit = func(name string) error {
		if visited[name] == 1 {
			return fmt.Errorf("proxy-groups: circular dependency")
		}
		if visited[name] == 2 {
			return nil
		}
		visited[name] = 1
		for _, dependency := range dependencies[name] {
			if err := visit(dependency); err != nil {
				return err
			}
		}
		visited[name] = 2
		return nil
	}
	for _, group := range clash.ProxyGroups {
		if err := visit(group["name"].(string)); err != nil {
			return nil, err
		}
	}
	return json.MarshalIndent(map[string]any{"outbounds": outbounds, "route": map[string]any{"final": clash.ProxyGroups[0]["name"]}}, "", "  ")
}

func convertClashProxy(proxy map[string]any) (map[string]any, error) {
	kind, _ := proxy["type"].(string)
	allowed := []string{"name", "type", "server", "port", "udp"}
	tlsCapable := false
	switch kind {
	case "ss", "shadowsocks":
		allowed = append(allowed, "cipher", "password")
	case "trojan":
		allowed = append(allowed, "password", "sni", "network", "ws-opts")
		tlsCapable = true
	case "vless":
		allowed = append(allowed, "uuid", "flow", "tls", "servername", "network", "ws-opts")
		tlsCapable = true
	case "vmess":
		allowed = append(allowed, "uuid", "cipher", "alterId", "tls", "servername", "network", "ws-opts")
		tlsCapable = true
	case "socks5":
		allowed = append(allowed, "username", "password")
	case "http":
		allowed = append(allowed, "username", "password", "tls", "sni")
		tlsCapable = true
	default:
		return nil, fmt.Errorf("unsupported proxy type")
	}
	if tlsCapable {
		allowed = append(allowed, "skip-cert-verify", "alpn")
	}
	if err := checkFields(proxy, "node", allowed...); err != nil {
		return nil, err
	}
	name, nameOK := proxy["name"].(string)
	server, serverOK := proxy["server"].(string)
	port, portOK := nodeInteger(proxy["port"])
	if !nameOK || strings.TrimSpace(name) == "" || !serverOK || strings.TrimSpace(server) == "" || !portOK || port < 1 || port > 65535 {
		return nil, fmt.Errorf("name, server and port (1-65535) are required")
	}
	out := map[string]any{"tag": name, "server": server, "server_port": port, "type": kind}
	requireString := func(field string) (string, error) {
		value, ok := proxy[field].(string)
		if !ok || value == "" {
			return "", fmt.Errorf("missing or invalid %s", field)
		}
		return value, nil
	}
	switch kind {
	case "ss", "shadowsocks":
		out["type"] = "shadowsocks"
		method, err := requireString("cipher")
		if err != nil {
			return nil, err
		}
		out["method"] = method
		password, err := requireString("password")
		if err != nil {
			return nil, err
		}
		out["password"] = password
	case "trojan":
		password, err := requireString("password")
		if err != nil {
			return nil, err
		}
		out["password"] = password
	case "vless", "vmess":
		uuid, err := requireString("uuid")
		if err != nil {
			return nil, err
		}
		out["uuid"] = uuid
		if kind == "vless" {
			if flow, exists := proxy["flow"]; exists {
				if _, ok := flow.(string); !ok {
					return nil, fmt.Errorf("invalid flow")
				}
				out["flow"] = flow
			}
		} else {
			out["security"] = "auto"
			if cipher, exists := proxy["cipher"]; exists {
				if _, ok := cipher.(string); !ok {
					return nil, fmt.Errorf("invalid cipher")
				}
				out["security"] = cipher
			}
			if value, exists := proxy["alterId"]; exists {
				number, ok := nodeInteger(value)
				if !ok || number < 0 {
					return nil, fmt.Errorf("invalid alterId")
				}
				out["alter_id"] = number
			}
		}
	case "socks5", "http":
		if kind == "socks5" {
			out["type"] = "socks"
			out["version"] = "5"
		}
		for _, field := range []string{"username", "password"} {
			if value, exists := proxy[field]; exists {
				if _, ok := value.(string); !ok {
					return nil, fmt.Errorf("invalid %s", field)
				}
				out[field] = value
			}
		}
	}
	if value, exists := proxy["udp"]; exists {
		enabled, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("invalid udp")
		}
		if kind == "http" {
			if enabled {
				return nil, fmt.Errorf("HTTP proxy UDP is unsupported")
			}
		} else if !enabled {
			out["network"] = "tcp"
		}
	}
	if tlsCapable {
		enabled := kind == "trojan"
		if value, exists := proxy["tls"]; exists {
			var ok bool
			enabled, ok = value.(bool)
			if !ok {
				return nil, fmt.Errorf("invalid tls")
			}
		}
		tls := map[string]any{"enabled": enabled}
		for _, field := range []string{"sni", "servername"} {
			if value, exists := proxy[field]; exists {
				if _, ok := value.(string); !ok {
					return nil, fmt.Errorf("invalid %s", field)
				}
				tls["server_name"] = value
			}
		}
		if value, exists := proxy["skip-cert-verify"]; exists {
			if _, ok := value.(bool); !ok {
				return nil, fmt.Errorf("invalid skip-cert-verify")
			}
			tls["insecure"] = value
		}
		if value, exists := proxy["alpn"]; exists {
			items, ok := value.([]any)
			if !ok {
				return nil, fmt.Errorf("invalid alpn")
			}
			for _, item := range items {
				if _, ok := item.(string); !ok {
					return nil, fmt.Errorf("invalid alpn")
				}
			}
			tls["alpn"] = items
		}
		if !enabled && len(tls) > 1 {
			return nil, fmt.Errorf("TLS options require tls: true")
		}
		if enabled {
			out["tls"] = tls
		}
	}
	if value, exists := proxy["network"]; exists {
		switch value {
		case "tcp":
		case "ws":
			transport := map[string]any{"type": "ws"}
			if raw, exists := proxy["ws-opts"]; exists {
				opts, ok := raw.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("invalid ws-opts")
				}
				if err := checkFields(opts, "ws-opts", "path", "headers"); err != nil {
					return nil, err
				}
				if value, exists := opts["path"]; exists {
					if _, ok := value.(string); !ok {
						return nil, fmt.Errorf("invalid WebSocket path")
					}
					transport["path"] = value
				}
				if value, exists := opts["headers"]; exists {
					headers, ok := value.(map[string]any)
					if !ok {
						return nil, fmt.Errorf("invalid WebSocket headers")
					}
					for _, value := range headers {
						if _, ok := value.(string); !ok {
							return nil, fmt.Errorf("invalid WebSocket header value")
						}
					}
					transport["headers"] = headers
				}
			}
			out["transport"] = transport
		default:
			return nil, fmt.Errorf("unsupported network transport")
		}
	}
	if _, exists := proxy["ws-opts"]; exists && proxy["network"] != "ws" {
		return nil, fmt.Errorf("ws-opts require network: ws")
	}
	return out, nil
}

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
	if network := query.Get("type"); network != "" {
		proxy["network"] = network
	}
	if query.Get("type") == "ws" {
		opts := map[string]any{"path": query.Get("path")}
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
	return convertClashProxy(proxy)
}

func buildSingBoxFromOutbounds(nodes []map[string]any, nodeTags []string) ([]byte, error) {
	used := map[string]bool{"DIRECT": true}
	for index, tag := range nodeTags {
		if used[tag] {
			return nil, fmt.Errorf("node %d: duplicate or reserved name", index)
		}
		used[tag] = true
	}
	unique := func(base string) string {
		name := base
		for index := 1; used[name]; index++ {
			name = fmt.Sprintf("%s-%d", base, index)
		}
		used[name] = true
		return name
	}
	selector, auto := unique("Proxy"), unique("Auto")
	outbounds := append(nodes,
		map[string]any{"type": "direct", "tag": "DIRECT"},
		map[string]any{"type": "selector", "tag": selector, "outbounds": append([]string{auto}, nodeTags...)},
		map[string]any{"type": "urltest", "tag": auto, "outbounds": nodeTags, "url": "https://www.gstatic.com/generate_204", "interval": "300s"},
	)
	return json.MarshalIndent(map[string]any{"outbounds": outbounds, "route": map[string]any{"final": selector}}, "", "  ")
}
