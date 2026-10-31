package sub

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type ClashConfig struct {
	Proxies     []map[string]any `yaml:"proxies,omitempty"`
	ProxyGroups []map[string]any `yaml:"proxy-groups,omitempty"`
}

func DetectAndConvert(rawContent []byte, clashNodesOnly bool) ([]byte, *QuotaInfo, error) {
	trimmed := bytes.TrimSpace(rawContent)
	if len(trimmed) == 0 {
		return nil, nil, fmt.Errorf("configuration content is empty")
	}

	// 1. Try sing-box JSON
	if trimmed[0] == '{' {
		var testMap map[string]any
		if err := json.Unmarshal(trimmed, &testMap); err == nil {
			if _, hasOutbounds := testMap["outbounds"]; hasOutbounds {
				if clashNodesOnly {
					return nil, nil, fmt.Errorf("Clash nodes-only mode requires Clash YAML, not sing-box JSON")
				}
				return trimmed, nil, nil
			}
		}
	}

	// 2. Try Clash YAML
	var clash ClashConfig
	yamlErr := yaml.Unmarshal(trimmed, &clash)
	var fields map[string]any
	if yaml.Unmarshal(trimmed, &fields) == nil {
		for _, key := range []string{"proxies", "proxy-groups", "proxy-providers", "rules", "rule-providers"} {
			if _, exists := fields[key]; exists && (yamlErr != nil || len(clash.Proxies) == 0) {
				return nil, nil, fmt.Errorf("Clash requires a non-empty inline proxy list; proxy providers are unsupported")
			}
		}
	}
	if yamlErr == nil && len(clash.Proxies) > 0 {
		if !clashNodesOnly {
			if err := checkFields(fields, "Clash", "proxies", "proxy-groups"); err != nil {
				return nil, nil, fmt.Errorf("%w; use sing-box JSON to preserve policy, or explicitly choose Clash nodes-only import", err)
			}
		} else {
			clash.ProxyGroups = nil
		}
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
	if clashNodesOnly {
		return nil, nil, fmt.Errorf("Clash nodes-only mode requires a Clash YAML proxy list")
	}
	decoded := trimmed
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if content, err := encoding.DecodeString(strings.Join(strings.Fields(string(trimmed)), "")); err == nil {
			decoded = content
			break
		}
	}

	lines := strings.Split(string(decoded), "\n")
	var outbounds []map[string]any
	var nodeTags []string

	for index, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		outbound, err := parseProxyURI(line)
		if err != nil {
			return nil, nil, fmt.Errorf("share-link line %d: %w", index+1, err)
		}
		outbounds = append(outbounds, outbound)
		nodeTags = append(nodeTags, outbound["tag"].(string))
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
