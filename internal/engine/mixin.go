package engine

import (
	"encoding/json"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// GlobalMixin is the system-wide override layer applied across all active
// profiles, sitting above individual profile overrides. It allows users
// to define global direct/proxy rules, private network bypass, and custom DNS
// without having to repeat them in every single subscription.
type GlobalMixin struct {
	BypassLAN    bool     `json:"bypassLan,omitempty"`
	RulesPrepend []string `json:"rulesPrepend,omitempty"`
	RulesAppend  []string `json:"rulesAppend,omitempty"`
	DNS          string   `json:"dns,omitempty"`
}

// IsZero reports whether the mixin changes nothing.
func (m *GlobalMixin) IsZero() bool {
	return m == nil || (!m.BypassLAN && len(m.RulesPrepend) == 0 && len(m.RulesAppend) == 0 && strings.TrimSpace(m.DNS) == "")
}

// Standard LAN CIDR / domain rules for Clash
var clashLANBypassRules = []string{
	"IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
	"IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
	"IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
	"IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
	"IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
	"IP-CIDR6,fc00::/7,DIRECT,no-resolve",
	"IP-CIDR6,fe80::/10,DIRECT,no-resolve",
	"DOMAIN-SUFFIX,local,DIRECT",
	"DOMAIN-SUFFIX,localhost,DIRECT",
}

// ApplyLayers splices both the local subscription override and the global
// mixin on top of a source document. The evaluation order is:
//  1. Mixin LAN bypass rules (if enabled)
//  2. Mixin prepend rules
//  3. Subscription override prepend rules
//  4. Source rules
//  5. Subscription override append rules
//  6. Mixin append rules
//
// DNS merges start from source, then Mixin DNS, then Subscription override DNS.
func ApplyLayers(source []byte, override *SubscriptionOverride, mixin *GlobalMixin) ([]byte, error) {
	if (override == nil || override.IsZero()) && (mixin == nil || mixin.IsZero()) {
		return source, nil
	}
	format, err := DetectFormat(source)
	if err != nil {
		return nil, err
	}
	switch format {
	case FormatClash:
		return applyClashLayers(source, override, mixin)
	case FormatSingBox:
		return applySingBoxLayers(source, override, mixin)
	default:
		return nil, fmt.Errorf("unsupported core format %q", format)
	}
}

// ApplyGlobalMixin splices only the global mixin into the source.
func ApplyGlobalMixin(source []byte, mixin *GlobalMixin) ([]byte, error) {
	return ApplyLayers(source, nil, mixin)
}

func applyClashLayers(source []byte, override *SubscriptionOverride, mixin *GlobalMixin) ([]byte, error) {
	raw, err := decodeYAMLMap(source)
	if err != nil {
		return nil, fmt.Errorf("failed to parse source config: %w", err)
	}
	policies := clashPolicies(raw)

	if override != nil && !override.IsZero() {
		if err := checkClashRuleTargets(override, policies); err != nil {
			return nil, err
		}
	}
	if mixin != nil && !mixin.IsZero() {
		fakeOverride := &SubscriptionOverride{
			RulesPrepend: mixin.RulesPrepend,
			RulesAppend:  mixin.RulesAppend,
		}
		if err := checkClashRuleTargets(fakeOverride, policies); err != nil {
			return nil, fmt.Errorf("global mixin rule conflict: %w", err)
		}
	}

	var totalPrepend []string
	if mixin != nil && mixin.BypassLAN {
		totalPrepend = append(totalPrepend, clashLANBypassRules...)
	}
	if mixin != nil && len(mixin.RulesPrepend) > 0 {
		totalPrepend = append(totalPrepend, mixin.RulesPrepend...)
	}
	if override != nil && len(override.RulesPrepend) > 0 {
		totalPrepend = append(totalPrepend, override.RulesPrepend...)
	}

	existingRules, _ := raw["rules"].([]any)
	var totalAppend []string
	if override != nil && len(override.RulesAppend) > 0 {
		totalAppend = append(totalAppend, override.RulesAppend...)
	}
	if mixin != nil && len(mixin.RulesAppend) > 0 {
		totalAppend = append(totalAppend, mixin.RulesAppend...)
	}

	rules := make([]any, 0, len(totalPrepend)+len(existingRules)+len(totalAppend))
	for _, rule := range totalPrepend {
		rules = append(rules, rule)
	}
	rules = append(rules, existingRules...)
	for _, rule := range totalAppend {
		rules = append(rules, rule)
	}
	raw["rules"] = rules

	// DNS
	if mixin != nil && strings.TrimSpace(mixin.DNS) != "" {
		if err := applyClashDNSText(raw, mixin.DNS); err != nil {
			return nil, fmt.Errorf("global mixin DNS malformed: %w", err)
		}
	}
	if override != nil && strings.TrimSpace(override.DNS) != "" {
		if err := applyClashDNSText(raw, override.DNS); err != nil {
			return nil, err
		}
	}

	derived, err := yaml.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal layers config: %w", err)
	}
	return derived, nil
}

func applySingBoxLayers(source []byte, override *SubscriptionOverride, mixin *GlobalMixin) ([]byte, error) {
	var raw map[string]any
	if err := json.Unmarshal(source, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse source config: %w", err)
	}
	outboundTags := map[string]bool{}
	if items, _ := raw["outbounds"].([]any); len(items) > 0 {
		for _, item := range items {
			entry, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if tag, _ := entry["tag"].(string); tag != "" {
				outboundTags[tag] = true
			}
		}
	}

	var prependRules []any
	if mixin != nil && mixin.BypassLAN {
		if !outboundTags["direct"] {
			// sing-box 校验规则引用的出站时机在每条连接而非配置加载：缺
			// "direct" 出站的订阅能通过 Validate，然后运行时每条私网连接
			// 都报 "outbound not found"。补上缺失的保留出站。
			items, _ := raw["outbounds"].([]any)
			raw["outbounds"] = append(items, map[string]any{"type": "direct", "tag": "direct"})
			outboundTags["direct"] = true
		}
		prependRules = append(prependRules, map[string]any{
			"ip_is_private": true,
			"outbound":      "direct",
		})
	}
	if mixin != nil && len(mixin.RulesPrepend) > 0 {
		mixinPrepend, err := singBoxOverrideRules(mixin.RulesPrepend, outboundTags)
		if err != nil {
			return nil, fmt.Errorf("global mixin rule conflict: %w", err)
		}
		prependRules = append(prependRules, mixinPrepend...)
	}
	if override != nil && len(override.RulesPrepend) > 0 {
		overridePrepend, err := singBoxOverrideRules(override.RulesPrepend, outboundTags)
		if err != nil {
			return nil, err
		}
		prependRules = append(prependRules, overridePrepend...)
	}

	var appendRules []any
	if override != nil && len(override.RulesAppend) > 0 {
		overrideAppend, err := singBoxOverrideRules(override.RulesAppend, outboundTags)
		if err != nil {
			return nil, err
		}
		appendRules = append(appendRules, overrideAppend...)
	}
	if mixin != nil && len(mixin.RulesAppend) > 0 {
		mixinAppend, err := singBoxOverrideRules(mixin.RulesAppend, outboundTags)
		if err != nil {
			return nil, fmt.Errorf("global mixin rule conflict: %w", err)
		}
		appendRules = append(appendRules, mixinAppend...)
	}

	route, _ := raw["route"].(map[string]any)
	if route == nil {
		route = make(map[string]any)
	}
	existingRules, _ := route["rules"].([]any)
	rules := make([]any, 0, len(prependRules)+len(existingRules)+len(appendRules))
	rules = append(rules, prependRules...)
	rules = append(rules, existingRules...)
	rules = append(rules, appendRules...)
	route["rules"] = rules
	raw["route"] = route

	// DNS
	if mixin != nil && strings.TrimSpace(mixin.DNS) != "" {
		if err := applySingBoxDNSText(raw, mixin.DNS, outboundTags); err != nil {
			return nil, fmt.Errorf("global mixin DNS error: %w", err)
		}
	}
	if override != nil && strings.TrimSpace(override.DNS) != "" {
		if err := applySingBoxDNSText(raw, override.DNS, outboundTags); err != nil {
			return nil, err
		}
	}

	derived, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal layers config: %w", err)
	}
	return derived, nil
}
