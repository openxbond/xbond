package engine

import (
	"bytes"
	"encoding/json"
	"fmt"

	"gopkg.in/yaml.v3"
)

// CoreFormat identifies which embedded core runs a configuration. Both cores
// are native to their format: Clash (mihomo) YAML and sing-box JSON pass
// through without conversion, so no subscription semantics are lost.
type CoreFormat string

const (
	FormatClash   CoreFormat = "clash"
	FormatSingBox CoreFormat = "sing-box"
)

// DetectFormat sniffs a stored source configuration and returns the core
// that natively runs it.
func DetectFormat(source []byte) (CoreFormat, error) {
	trimmed := bytes.TrimSpace(source)
	if len(trimmed) == 0 {
		return "", fmt.Errorf("configuration is empty")
	}
	if trimmed[0] == '{' {
		var probe map[string]any
		if err := json.Unmarshal(trimmed, &probe); err == nil {
			if _, hasOutbounds := probe["outbounds"]; hasOutbounds {
				return FormatSingBox, nil
			}
		}
		return "", fmt.Errorf("JSON configuration has no outbounds")
	}
	var fields map[string]any
	if err := yaml.Unmarshal(trimmed, &fields); err != nil {
		return "", fmt.Errorf("not a valid configuration document")
	}
	_, hasProxies := fields["proxies"]
	_, hasProviders := fields["proxy-providers"]
	_, hasGroups := fields["proxy-groups"]
	_, hasRules := fields["rules"]
	if hasProxies || hasProviders || hasGroups || hasRules {
		return FormatClash, nil
	}
	return "", fmt.Errorf("unrecognized configuration format")
}

func coreDisplayName(format CoreFormat) string {
	switch format {
	case FormatClash:
		return "mihomo"
	case FormatSingBox:
		return "sing-box"
	default:
		return string(format)
	}
}
