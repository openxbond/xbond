package sub

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/openxbond/xbond/internal/engine"
	"gopkg.in/yaml.v3"
)

// DetectAndConvert normalizes any supported subscription input into the
// format its native core runs: Clash (mihomo) YAML or sing-box JSON. Both
// are native formats and pass through untouched; share-link lists become
// Clash YAML with default groups. The returned format records which core
// owns the subscription.
func DetectAndConvert(rawContent []byte) ([]byte, engine.CoreFormat, *QuotaInfo, error) {
	trimmed := bytes.TrimSpace(rawContent)
	if len(trimmed) == 0 {
		return nil, "", nil, fmt.Errorf("configuration content is empty")
	}

	quota := parseQuotaComment(trimmed)

	// 1. sing-box JSON — passthrough for the sing-box core.
	if trimmed[0] == '{' {
		var probe map[string]any
		if err := json.Unmarshal(trimmed, &probe); err == nil {
			if _, hasOutbounds := probe["outbounds"]; hasOutbounds {
				return trimmed, engine.FormatSingBox, quota, nil
			}
		}
	}

	// 2. Clash YAML — passthrough for the mihomo core; the core's own
	// validation gate (engine.Validate) is the authority on whether it runs.
	var fields map[string]any
	if err := yaml.Unmarshal(trimmed, &fields); err == nil {
		proxies, _ := fields["proxies"].([]any)
		providers, _ := fields["proxy-providers"].(map[string]any)
		_, hasGroups := fields["proxy-groups"]
		_, hasRules := fields["rules"]
		if len(proxies) > 0 || len(providers) > 0 || hasGroups || hasRules {
			if len(proxies) == 0 && len(providers) == 0 {
				return nil, "", nil, fmt.Errorf("Clash configuration has neither inline proxies nor proxy-providers")
			}
			return trimmed, engine.FormatClash, quota, nil
		}
	}

	// 3. Base64-wrapped share links or a plain URI list
	decoded := tryDecodeBase64(trimmed)
	proxies, err := parseShareLinks(decoded)
	if err != nil {
		return nil, "", nil, err
	}
	if len(proxies) > 0 {
		converted, err := buildClashFromProxies(proxies)
		if err != nil {
			return nil, "", nil, err
		}
		return converted, engine.FormatClash, nil, nil
	}

	return nil, "", nil, fmt.Errorf("unrecognized subscription format (neither Clash YAML, sing-box JSON, nor URI list)")
}

func tryDecodeBase64(content []byte) []byte {
	joined := strings.Join(strings.Fields(string(content)), "")
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if decoded, err := encoding.DecodeString(joined); err == nil {
			return decoded
		}
	}
	return content
}

// parseShareLinks parses trojan/vless share-link lists. Lines without a URI
// scheme are skipped so arbitrary text fails as "unrecognized format" in the
// caller instead of a confusing per-line error.
func parseShareLinks(content []byte) ([]map[string]any, error) {
	lines := strings.Split(string(content), "\n")
	var proxies []map[string]any
	var firstErr error
	for index, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if !strings.Contains(line, "://") {
			continue
		}
		proxy, err := parseProxyURI(line)
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("share-link line %d: %w", index+1, err)
			}
			continue
		}
		proxies = append(proxies, proxy)
	}
	if firstErr != nil {
		return nil, firstErr
	}
	return proxies, nil
}

// parseQuotaComment extracts quota info from a `# subscription-userinfo:`
// comment line, as injected by the XBond gateway and most airport panels.
func parseQuotaComment(content []byte) *QuotaInfo {
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "#") {
			continue
		}
		if _, rest, found := strings.Cut(line, "subscription-userinfo:"); found {
			return ParseQuotaHeader(strings.TrimSpace(rest))
		}
	}
	return nil
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
