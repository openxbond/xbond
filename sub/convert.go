package sub

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type ClashConfig struct {
	Port        int                      `yaml:"port,omitempty"`
	SocksPort   int                      `yaml:"socks-port,omitempty"`
	Proxies     []map[string]any         `yaml:"proxies,omitempty"`
	ProxyGroups []map[string]any         `yaml:"proxy-groups,omitempty"`
}

func DetectAndConvert(rawContent []byte) ([]byte, *QuotaInfo, error) {
	trimmed := bytes.TrimSpace(rawContent)
	if len(trimmed) == 0 {
		return nil, nil, fmt.Errorf("configuration content is empty")
	}

	// 1. Try sing-box JSON
	if trimmed[0] == '{' {
		var testMap map[string]any
		if err := json.Unmarshal(trimmed, &testMap); err == nil {
			if _, hasOutbounds := testMap["outbounds"]; hasOutbounds {
				return trimmed, nil, nil
			}
		}
	}

	// 2. Try Clash YAML
	var clash ClashConfig
	yamlErr := yaml.Unmarshal(trimmed, &clash)
	if yamlErr == nil && len(clash.Proxies) > 0 {
		var quota *QuotaInfo
		// Check for line 1 comment: # subscription-userinfo: ...
		lines := strings.Split(string(trimmed), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "#") && strings.Contains(line, "subscription-userinfo:") {
				parts := strings.SplitN(line, "subscription-userinfo:", 2)
				if len(parts) == 2 {
					quota = ParseQuotaHeader(strings.TrimSpace(parts[1]))
				}
				break
			}
		}

		converted, err := convertClashToSingBox(&clash)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to convert clash yaml: %w", err)
		}
		return converted, quota, nil
	}

	// 3. Try Base64 or Line-delimited URIs
	decoded := trimmed
	if b64, err := base64.StdEncoding.DecodeString(string(trimmed)); err == nil {
		decoded = b64
	} else if b64url, err := base64.RawURLEncoding.DecodeString(string(trimmed)); err == nil {
		decoded = b64url
	}

	lines := strings.Split(string(decoded), "\n")
	var outbounds []map[string]any
	var nodeTags []string

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		outbound, err := parseProxyURI(line)
		if err == nil && outbound != nil {
			outbounds = append(outbounds, outbound)
			if tag, ok := outbound["tag"].(string); ok {
				nodeTags = append(nodeTags, tag)
			}
		}
	}

	if len(outbounds) > 0 {
		converted, err := buildSingBoxFromOutbounds(outbounds, nodeTags)
		if err != nil {
			return nil, nil, err
		}
		return converted, nil, nil
	}

	return nil, nil, fmt.Errorf("unrecognized subscription format (neither sing-box JSON, Clash YAML, nor URI list)")
}

func convertClashToSingBox(clash *ClashConfig) ([]byte, error) {
	outbounds := make([]map[string]any, 0, len(clash.Proxies)+len(clash.ProxyGroups)+2)
	nodeTags := make([]string, 0, len(clash.Proxies))

	for _, p := range clash.Proxies {
		outbound := convertClashProxy(p)
		if outbound != nil {
			outbounds = append(outbounds, outbound)
			if tag, ok := outbound["tag"].(string); ok {
				nodeTags = append(nodeTags, tag)
			}
		}
	}

	// Direct and block outbounds
	outbounds = append(outbounds,
		map[string]any{"type": "direct", "tag": "direct"},
		map[string]any{"type": "block", "tag": "block"},
	)

	// Groups
	if len(clash.ProxyGroups) > 0 {
		for _, g := range clash.ProxyGroups {
			name, _ := g["name"].(string)
			groupType, _ := g["type"].(string)
			proxies, _ := g["proxies"].([]any)
			subOutbounds := make([]string, 0, len(proxies))
			for _, item := range proxies {
				if s, ok := item.(string); ok {
					subOutbounds = append(subOutbounds, s)
				}
			}

			switch strings.ToLower(groupType) {
			case "select":
				outbounds = append(outbounds, map[string]any{
					"type":      "selector",
					"tag":       name,
					"outbounds": subOutbounds,
				})
			case "url-test", "fallback", "load-balance":
				outbounds = append(outbounds, map[string]any{
					"type":      "urltest",
					"tag":       name,
					"outbounds": subOutbounds,
					"url":       "https://www.gstatic.com/generate_204",
					"interval":  "300s",
				})
			default:
				outbounds = append(outbounds, map[string]any{
					"type":      "selector",
					"tag":       name,
					"outbounds": subOutbounds,
				})
			}
		}
	} else {
		// Default groups if none specified
		outbounds = append(outbounds,
			map[string]any{
				"type":      "selector",
				"tag":       "Proxy",
				"outbounds": append([]string{"Auto"}, nodeTags...),
			},
			map[string]any{
				"type":      "urltest",
				"tag":       "Auto",
				"outbounds": nodeTags,
				"url":       "https://www.gstatic.com/generate_204",
				"interval":  "300s",
			},
		)
	}

	root := map[string]any{
		"outbounds": outbounds,
	}

	return json.MarshalIndent(root, "", "  ")
}

func convertClashProxy(p map[string]any) map[string]any {
	pType, _ := p["type"].(string)
	name, _ := p["name"].(string)
	server, _ := p["server"].(string)
	port := getInt(p["port"])

	out := map[string]any{
		"tag":         name,
		"server":      server,
		"server_port": port,
	}

	switch strings.ToLower(pType) {
	case "ss", "shadowsocks":
		out["type"] = "shadowsocks"
		out["method"] = p["cipher"]
		out["password"] = p["password"]
	case "trojan":
		out["type"] = "trojan"
		out["password"] = p["password"]
		tlsMap := map[string]any{"enabled": true}
		if sni, ok := p["sni"].(string); ok && sni != "" {
			tlsMap["server_name"] = sni
		}
		out["tls"] = tlsMap
	case "vless":
		out["type"] = "vless"
		out["uuid"] = p["uuid"]
		tlsMap := map[string]any{"enabled": true}
		if sni, ok := p["servername"].(string); ok && sni != "" {
			tlsMap["server_name"] = sni
		}
		out["tls"] = tlsMap
	case "vmess":
		out["type"] = "vmess"
		out["uuid"] = p["uuid"]
		out["security"] = "auto"
	case "socks5":
		out["type"] = "socks"
		if user, ok := p["username"].(string); ok {
			out["username"] = user
		}
		if pass, ok := p["password"].(string); ok {
			out["password"] = pass
		}
	case "http":
		out["type"] = "http"
		if user, ok := p["username"].(string); ok {
			out["username"] = user
		}
		if pass, ok := p["password"].(string); ok {
			out["password"] = pass
		}
	default:
		return nil
	}

	return out
}

func parseProxyURI(uriStr string) (map[string]any, error) {
	u, err := url.Parse(uriStr)
	if err != nil {
		return nil, err
	}

	scheme := strings.ToLower(u.Scheme)
	tag := u.Fragment
	if tag == "" {
		tag = u.Host
	} else {
		if unescaped, err := url.QueryUnescape(tag); err == nil {
			tag = unescaped
		}
	}

	port := 443
	if p, err := strconv.Atoi(u.Port()); err == nil && p > 0 {
		port = p
	}

	switch scheme {
	case "trojan":
		return map[string]any{
			"type":        "trojan",
			"tag":         tag,
			"server":      u.Hostname(),
			"server_port": port,
			"password":    u.User.Username(),
			"tls": map[string]any{
				"enabled":     true,
				"server_name": u.Query().Get("sni"),
			},
		}, nil
	case "vless":
		return map[string]any{
			"type":        "vless",
			"tag":         tag,
			"server":      u.Hostname(),
			"server_port": port,
			"uuid":        u.User.Username(),
			"tls": map[string]any{
				"enabled":     true,
				"server_name": u.Query().Get("sni"),
			},
		}, nil
	}

	return nil, fmt.Errorf("unsupported uri scheme: %s", scheme)
}

func buildSingBoxFromOutbounds(nodes []map[string]any, nodeTags []string) ([]byte, error) {
	outbounds := make([]map[string]any, 0, len(nodes)+4)
	outbounds = append(outbounds, nodes...)

	outbounds = append(outbounds,
		map[string]any{"type": "direct", "tag": "direct"},
		map[string]any{"type": "block", "tag": "block"},
		map[string]any{
			"type":      "selector",
			"tag":       "Proxy",
			"outbounds": append([]string{"Auto"}, nodeTags...),
		},
		map[string]any{
			"type":      "urltest",
			"tag":       "Auto",
			"outbounds": nodeTags,
			"url":       "https://www.gstatic.com/generate_204",
			"interval":  "300s",
		},
	)

	root := map[string]any{
		"outbounds": outbounds,
	}
	return json.MarshalIndent(root, "", "  ")
}

func ParseQuotaHeader(headerVal string) *QuotaInfo {
	if headerVal == "" {
		return nil
	}

	info := &QuotaInfo{}
	parts := strings.Split(headerVal, ";")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(kv[0]))
		val, err := strconv.ParseInt(strings.TrimSpace(kv[1]), 10, 64)
		if err != nil {
			continue
		}

		switch key {
		case "upload":
			info.UploadBytes = val
		case "download":
			info.DownloadBytes = val
		case "total":
			info.TotalBytes = val
		case "expire":
			info.ExpireUnix = val
		}
	}
	return info
}

func getInt(val any) int {
	switch v := val.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case string:
		i, _ := strconv.Atoi(v)
		return i
	default:
		return 0
	}
}
