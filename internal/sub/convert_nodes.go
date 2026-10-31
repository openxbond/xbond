package sub

import (
	"fmt"
	"net/url"
	"strconv"

	"gopkg.in/yaml.v3"
)

// reservedNames are the built-in outbound names both cores shadow; a
// subscription node or group may never use them.
func reservedNames() map[string]bool {
	return map[string]bool{
		"DIRECT": true, "REJECT": true, "REJECT-DROP": true,
		"COMPATIBLE": true, "PASS": true, "GLOBAL": true,
	}
}

func nodeTags(nodes []map[string]any) []string {
	tags := make([]string, 0, len(nodes))
	for _, node := range nodes {
		tag, _ := node["name"].(string)
		tags = append(tags, tag)
	}
	return tags
}

// defaultGroups is the standard Proxy/Auto pair for node lists without
// upstream policy, matching the shape share-link imports always produced.
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

// buildClashFromProxies wraps a node list into a runnable Clash document.
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
// The query allowlist keeps the conversion honest: anything else is
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
