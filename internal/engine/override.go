package engine

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
)

// SubscriptionOverride is the structured local override spliced on top of a
// subscription source before derivation (client-rethink §四: 来源原文 → 本地
// 覆盖 → 宿主派生 → 校验后运行配置). The downloaded source is never
// rewritten; the override is a separate layer that survives updates.
type SubscriptionOverride struct {
	RulesPrepend []string `json:"rulesPrepend,omitempty"`
	RulesAppend  []string `json:"rulesAppend,omitempty"`
}

// IsZero reports whether the override changes nothing.
func (o *SubscriptionOverride) IsZero() bool {
	return o == nil || (len(o.RulesPrepend) == 0 && len(o.RulesAppend) == 0)
}

// ApplyOverride splices the override's rules into the source document with
// the core native to the source format, then verifies every referenced
// policy exists. A rule pointing at a node or group the upstream removed is
// a conflict: it fails loudly instead of silently retargeting (client-rethink
// §四.3). Source rules are left to the core's own validation gate.
func ApplyOverride(source []byte, override *SubscriptionOverride) ([]byte, error) {
	if override.IsZero() {
		return source, nil
	}
	format, err := DetectFormat(source)
	if err != nil {
		return nil, err
	}
	switch format {
	case FormatClash:
		return applyClashOverride(source, override)
	case FormatSingBox:
		return applySingBoxOverride(source, override)
	default:
		return nil, fmt.Errorf("unsupported core format %q", format)
	}
}

func applyClashOverride(source []byte, override *SubscriptionOverride) ([]byte, error) {
	raw, err := decodeYAMLMap(source)
	if err != nil {
		return nil, fmt.Errorf("failed to parse source config: %w", err)
	}
	policies := clashPolicies(raw)
	if err := checkClashRuleTargets(override, policies); err != nil {
		return nil, err
	}
	existingRules, _ := raw["rules"].([]any)
	rules := make([]any, 0, len(override.RulesPrepend)+len(existingRules)+len(override.RulesAppend))
	for _, rule := range override.RulesPrepend {
		rules = append(rules, rule)
	}
	rules = append(rules, existingRules...)
	for _, rule := range override.RulesAppend {
		rules = append(rules, rule)
	}
	raw["rules"] = rules
	derived, err := yaml.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal overridden config: %w", err)
	}
	return derived, nil
}

// reservedPolicyNames are built into the cores and can never be a
// subscription node or group.
var reservedPolicyNames = []string{"DIRECT", "REJECT", "REJECT-DROP", "COMPATIBLE", "PASS", "GLOBAL"}

// ReservedPolicy reports whether a policy name is built into the cores.
func ReservedPolicy(name string) bool {
	return slices.Contains(reservedPolicyNames, name)
}

// ReservedAllPolicies lists the built-in policy names.
func ReservedAllPolicies() []string {
	return slices.Clone(reservedPolicyNames)
}

// clashPolicies collects every policy a rule may target: proxies, groups and
// the core's built-in policies.
func clashPolicies(raw map[string]any) map[string]bool {
	policies := map[string]bool{}
	for _, key := range []string{"proxies", "proxy-groups"} {
		items, _ := raw[key].([]any)
		for _, item := range items {
			entry, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if name, _ := entry["name"].(string); name != "" {
				policies[name] = true
			}
		}
	}
	for _, name := range reservedPolicyNames {
		policies[name] = true
	}
	return policies
}

// clashRulePolicy extracts a rule's target policy: the second field for
// MATCH, the last for logic rules (AND/OR/NOT — payloads contain commas),
// the third for everything else.
func clashRulePolicy(rule string) (string, bool) {
	fields := strings.Split(strings.TrimSpace(rule), ",")
	if len(fields) == 0 {
		return "", false
	}
	switch strings.ToUpper(strings.TrimSpace(fields[0])) {
	case "MATCH":
		if len(fields) >= 2 {
			return strings.TrimSpace(fields[1]), true
		}
	case "AND", "OR", "NOT":
		if len(fields) >= 3 {
			return strings.TrimSpace(fields[len(fields)-1]), true
		}
	default:
		if len(fields) >= 3 {
			return strings.TrimSpace(fields[2]), true
		}
	}
	return "", false
}

func checkClashRuleTargets(override *SubscriptionOverride, policies map[string]bool) error {
	for _, rule := range append(append([]string{}, override.RulesPrepend...), override.RulesAppend...) {
		policy, ok := clashRulePolicy(rule)
		if !ok {
			return fmt.Errorf("override rule %q is malformed: expected TYPE,PAYLOAD,POLICY", rule)
		}
		if !policies[policy] {
			return fmt.Errorf("override rule %q references missing policy %q", rule, policy)
		}
	}
	return nil
}

func applySingBoxOverride(source []byte, override *SubscriptionOverride) ([]byte, error) {
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
	prepend, err := singBoxOverrideRules(override.RulesPrepend, outboundTags)
	if err != nil {
		return nil, err
	}
	appendRules, err := singBoxOverrideRules(override.RulesAppend, outboundTags)
	if err != nil {
		return nil, err
	}

	route, _ := raw["route"].(map[string]any)
	if route == nil {
		route = make(map[string]any)
	}
	existingRules, _ := route["rules"].([]any)
	rules := make([]any, 0, len(prepend)+len(existingRules)+len(appendRules))
	rules = append(rules, prepend...)
	rules = append(rules, existingRules...)
	rules = append(rules, appendRules...)
	route["rules"] = rules
	raw["route"] = route

	derived, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal overridden config: %w", err)
	}
	return derived, nil
}

// singBoxOverrideRules parses each override line as a JSON rule object and
// checks its outbound reference, if any, against the source's outbounds.
func singBoxOverrideRules(lines []string, outboundTags map[string]bool) ([]any, error) {
	if len(lines) == 0 {
		return nil, nil
	}
	rules := make([]any, 0, len(lines))
	for _, line := range lines {
		var rule map[string]any
		if err := json.Unmarshal([]byte(line), &rule); err != nil {
			return nil, fmt.Errorf("override rule %q is malformed: expected a JSON object per line", line)
		}
		if outbound, _ := rule["outbound"].(string); outbound != "" && !outboundTags[outbound] {
			return nil, fmt.Errorf("override rule %q references missing outbound %q", line, outbound)
		}
		rules = append(rules, rule)
	}
	return rules, nil
}
