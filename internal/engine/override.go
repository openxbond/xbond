package engine

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
)

// Custom routing limits mirror the Cloud prefs contract: at most 10 groups,
// 50 entries per group and 100 entries in total. One text box per entry —
// domain, IP or CIDR — normalized by ParseCustomRule, so the UI and the
// daemon never disagree about what a line means.
const (
	MaxRuleGroups     = 10
	MaxRulesPerGroup  = 50
	MaxCustomRulesSum = 100
	maxDNSUpstreams   = 8
)

// RuleGroup is one user-defined routing group: entries share one target and
// one on/off switch. Groups expand in order ahead of the subscription's own
// rules; first match wins.
type RuleGroup struct {
	Name    string   `json:"name"`
	Target  string   `json:"target"`
	Enabled bool     `json:"enabled"`
	Rules   []string `json:"rules"`
}

// DNSOverride replaces the default resolution path with explicit upstream
// lists. Nameservers carry the primary resolvers; fallback (Clash only) is the
// pollution-review list consulted when a nameserver answer looks poisoned —
// a genuinely different mechanism, so it gets its own list. sing-box has no
// fallback concept and rejects one at save time.
type DNSOverride struct {
	Nameservers []string `json:"nameservers,omitempty"`
	Fallback    []string `json:"fallback,omitempty"`
}

// SubscriptionOverride is the structured local override spliced on top of a
// subscription source before derivation. The downloaded source is never
// rewritten; the override is a separate layer that survives updates.
type SubscriptionOverride struct {
	Groups []RuleGroup  `json:"groups,omitempty"`
	DNS    *DNSOverride `json:"dns,omitempty"`
}

// IsZero reports whether the override carries nothing worth storing: a group
// with entries counts even while disabled, so turning a group off keeps it
// editable instead of deleting it on save.
func (o *SubscriptionOverride) IsZero() bool {
	if o == nil {
		return true
	}
	for _, group := range o.Groups {
		for _, rule := range group.Rules {
			if strings.TrimSpace(rule) != "" {
				return false
			}
		}
	}
	if o.DNS != nil {
		for _, upstream := range append(o.DNS.Nameservers, o.DNS.Fallback...) {
			if strings.TrimSpace(upstream) != "" {
				return false
			}
		}
	}
	return true
}

// Normalize returns the canonical form of the override: blank lines dropped,
// entries normalized, empty groups removed, disabled groups kept as-is so the
// switch survives a save, DNS upstreams trimmed, validated and deduplicated.
// Invalid content fails with the group and entry named.
func (o *SubscriptionOverride) Normalize() (*SubscriptionOverride, error) {
	if o == nil {
		return &SubscriptionOverride{}, nil
	}
	if len(o.Groups) > MaxRuleGroups {
		return nil, fmt.Errorf("override holds %d rule groups, at most %d allowed", len(o.Groups), MaxRuleGroups)
	}
	normalized := &SubscriptionOverride{}
	total := 0
	for index, group := range o.Groups {
		name := strings.TrimSpace(group.Name)
		if name == "" {
			name = fmt.Sprintf("Group %d", index+1)
		}
		entries := make([]string, 0, len(group.Rules))
		for _, raw := range group.Rules {
			if strings.TrimSpace(raw) == "" {
				continue
			}
			value, ok := normalizeCustomRule(raw)
			if !ok {
				return nil, fmt.Errorf("rule group %q: %q is not a domain, IP address or CIDR", name, strings.TrimSpace(raw))
			}
			entries = append(entries, value)
		}
		if len(entries) == 0 {
			continue
		}
		if len(entries) > MaxRulesPerGroup {
			return nil, fmt.Errorf("rule group %q holds %d entries, at most %d allowed", name, len(entries), MaxRulesPerGroup)
		}
		target := strings.TrimSpace(group.Target)
		if group.Enabled && target == "" {
			return nil, fmt.Errorf("rule group %q has entries but no target", name)
		}
		total += len(entries)
		normalized.Groups = append(normalized.Groups, RuleGroup{
			Name:    name,
			Target:  target,
			Enabled: group.Enabled,
			Rules:   entries,
		})
	}
	if total > MaxCustomRulesSum {
		return nil, fmt.Errorf("override holds %d custom entries, at most %d allowed", total, MaxCustomRulesSum)
	}
	if o.DNS != nil {
		nameservers, err := normalizeDNSUpstreams(o.DNS.Nameservers, "nameserver")
		if err != nil {
			return nil, err
		}
		fallback, err := normalizeDNSUpstreams(o.DNS.Fallback, "fallback")
		if err != nil {
			return nil, err
		}
		// A fallback entry identical to a nameserver would be queried twice
		// for the same answer; drop the duplicate instead of storing it.
		primary := make(map[string]bool, len(nameservers))
		for _, upstream := range nameservers {
			primary[upstream] = true
		}
		fallback = slices.DeleteFunc(fallback, func(upstream string) bool {
			return primary[upstream]
		})
		if len(fallback) > 0 && len(nameservers) == 0 {
			return nil, fmt.Errorf("fallback DNS upstreams need at least one nameserver")
		}
		if len(nameservers) > 0 || len(fallback) > 0 {
			normalized.DNS = &DNSOverride{Nameservers: nameservers, Fallback: fallback}
		}
	}
	return normalized, nil
}

func normalizeDNSUpstreams(raw []string, list string) ([]string, error) {
	upstreams := make([]string, 0, len(raw))
	seen := map[string]bool{}
	for _, entry := range raw {
		value := strings.TrimSpace(entry)
		if value == "" {
			continue
		}
		if !validateDNSUpstream(value) {
			return nil, fmt.Errorf("DNS %s upstream %q is not a usable address (IP, hostname or dns:// URL)", list, value)
		}
		if seen[value] {
			continue
		}
		seen[value] = true
		upstreams = append(upstreams, value)
	}
	if len(upstreams) > maxDNSUpstreams {
		return nil, fmt.Errorf("DNS %s holds %d upstreams, at most %d allowed", list, len(upstreams), maxDNSUpstreams)
	}
	return upstreams, nil
}

// ListPolicies reports the routing targets a custom rule may point at for one
// source document: the subscription's own policy groups (falling back to
// individual nodes when it ships none) plus the built-in DIRECT and REJECT.
// The UI offers exactly this list, so a saved target always validates.
func ListPolicies(source []byte) (CoreFormat, []string, error) {
	format, err := DetectFormat(source)
	if err != nil {
		return "", nil, err
	}
	switch format {
	case FormatClash:
		raw, err := decodeYAMLMap(source)
		if err != nil {
			return "", nil, fmt.Errorf("failed to parse source config: %w", err)
		}
		policies := namesOf(raw, "proxy-groups")
		if len(policies) == 0 {
			policies = namesOf(raw, "proxies")
		}
		return format, withBuiltins(policies), nil
	case FormatSingBox:
		var raw map[string]any
		if err := json.Unmarshal(source, &raw); err != nil {
			return "", nil, fmt.Errorf("failed to parse source config: %w", err)
		}
		var groups, all []string
		if items, _ := raw["outbounds"].([]any); len(items) > 0 {
			for _, item := range items {
				entry, ok := item.(map[string]any)
				if !ok {
					continue
				}
				tag, _ := entry["tag"].(string)
				if tag == "" {
					continue
				}
				all = append(all, tag)
				switch entry["type"] {
				case "selector", "urltest":
					groups = append(groups, tag)
				}
			}
		}
		if len(groups) == 0 {
			groups = all
		}
		return format, withBuiltins(groups), nil
	default:
		return "", nil, fmt.Errorf("unsupported core format %q", format)
	}
}

// namesOf lists the non-empty name fields of one YAML list key.
func namesOf(raw map[string]any, key string) []string {
	var names []string
	seen := map[string]bool{}
	items, _ := raw[key].([]any)
	for _, item := range items {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, _ := entry["name"].(string)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		names = append(names, name)
	}
	return names
}

// withBuiltins appends DIRECT and REJECT once, skipping a same-named source
// entry: the renderer maps those targets to the core's native action, so one
// spelling is enough.
func withBuiltins(policies []string) []string {
	seen := map[string]bool{}
	for _, name := range policies {
		seen[strings.ToUpper(name)] = true
	}
	for _, name := range []string{"DIRECT", "REJECT"} {
		if seen[name] {
			continue
		}
		seen[name] = true
		policies = append(policies, name)
	}
	return policies
}

// applies reports whether the override changes the document at all: some
// enabled group with entries, or DNS upstreams. A disabled-only override is
// stored (the switch survives) but leaves the source untouched.
func (o *SubscriptionOverride) applies() bool {
	if o == nil {
		return false
	}
	for _, group := range o.Groups {
		if group.Enabled && len(group.Rules) > 0 {
			return true
		}
	}
	return o.DNS != nil && (len(o.DNS.Nameservers) > 0 || len(o.DNS.Fallback) > 0)
}

// ApplyOverride splices the override's rule groups and DNS upstreams into the
// source document with the core native to the source format, then verifies
// every referenced target exists. A group pointing at a node or group the
// upstream removed is a conflict: it fails loudly instead of silently
// retargeting. Source content is left to the core's own validation gate.
func ApplyOverride(source []byte, override *SubscriptionOverride) ([]byte, error) {
	if override.IsZero() {
		return source, nil
	}
	normalized, err := override.Normalize()
	if err != nil {
		return nil, err
	}
	if !normalized.applies() {
		return source, nil
	}
	format, err := DetectFormat(source)
	if err != nil {
		return nil, err
	}
	switch format {
	case FormatClash:
		return applyClashOverride(source, normalized)
	case FormatSingBox:
		return applySingBoxOverride(source, normalized)
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
	rendered, err := renderClashRules(override, policies)
	if err != nil {
		return nil, err
	}
	existingRules, _ := raw["rules"].([]any)
	rules := make([]any, 0, len(rendered)+len(existingRules))
	for _, rule := range rendered {
		rules = append(rules, rule)
	}
	rules = append(rules, existingRules...)
	raw["rules"] = rules
	applyClashDNSUpstreams(raw, override.DNS)
	derived, err := yaml.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal overridden config: %w", err)
	}
	return derived, nil
}

// renderClashRules expands every enabled group in order: domain entries ride
// DOMAIN-SUFFIX, IP and CIDR entries ride IP-CIDR/IP-CIDR6 with no-resolve,
// matching the sing-box ip_cidr semantics (literal destination only, no
// pre-resolution).
func renderClashRules(override *SubscriptionOverride, policies map[string]bool) ([]string, error) {
	var rendered []string
	for _, group := range override.Groups {
		if !group.Enabled {
			continue
		}
		if _, ok := policies[group.Target]; !ok {
			return nil, fmt.Errorf("rule group %q references missing policy %q", group.Name, group.Target)
		}
		for _, value := range group.Rules {
			parsed, ok := ParseCustomRule(value)
			if !ok {
				return nil, fmt.Errorf("rule group %q: %q is not a domain, IP address or CIDR", group.Name, value)
			}
			switch parsed.Kind {
			case "domain":
				rendered = append(rendered, "DOMAIN-SUFFIX,"+parsed.Value+","+group.Target)
			case "ip", "cidr":
				keyword := "IP-CIDR"
				if parsed.IPv6 {
					keyword = "IP-CIDR6"
				}
				rendered = append(rendered, keyword+","+parsed.CIDR+","+group.Target+",no-resolve")
			default:
				return nil, fmt.Errorf("rule group %q: %q is not a domain, IP address or CIDR", group.Name, value)
			}
		}
	}
	return rendered, nil
}

// applyClashDNSUpstreams points the source's resolution at the override
// lists: nameserver is replaced wholesale; a non-empty fallback replaces the
// source's list, and an empty one removes it — the override owns DNS once
// present, so a stale source fallback cannot second-guess the new
// nameservers. Writing fallback is safe for the validation gate:
// suppressFallbackGeoIP keeps it parseable without an MMDB download.
func applyClashDNSUpstreams(raw map[string]any, dns *DNSOverride) {
	if dns == nil || len(dns.Nameservers) == 0 {
		return
	}
	section, _ := raw["dns"].(map[string]any)
	if section == nil {
		section = make(map[string]any)
	}
	servers := make([]any, 0, len(dns.Nameservers))
	for _, upstream := range dns.Nameservers {
		servers = append(servers, upstream)
	}
	section["nameserver"] = servers
	if len(dns.Fallback) > 0 {
		fallback := make([]any, 0, len(dns.Fallback))
		for _, upstream := range dns.Fallback {
			fallback = append(fallback, upstream)
		}
		section["fallback"] = fallback
	} else {
		delete(section, "fallback")
	}
	raw["dns"] = section
}

// reservedPolicyNames are built into the cores and can never be a
// subscription node or group.
var reservedPolicyNames = []string{"DIRECT", "REJECT", "REJECT-DROP", "COMPATIBLE", "PASS", "GLOBAL"}

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
	prepend, err := renderSingBoxRules(override, outboundTags)
	if err != nil {
		return nil, err
	}

	route, _ := raw["route"].(map[string]any)
	if route == nil {
		route = make(map[string]any)
	}
	existingRules, _ := route["rules"].([]any)
	rules := make([]any, 0, len(prepend)+len(existingRules))
	rules = append(rules, prepend...)
	rules = append(rules, existingRules...)
	route["rules"] = rules
	raw["route"] = route
	if override.DNS != nil && len(override.DNS.Fallback) > 0 {
		return nil, fmt.Errorf("fallback DNS upstreams apply only to Clash subscriptions")
	}
	applySingBoxDNSUpstreams(raw, override.DNS)

	derived, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal overridden config: %w", err)
	}
	return derived, nil
}

// renderSingBoxRules expands every enabled group in order. DIRECT and REJECT
// ride the native actions so they never depend on a subscription shipping a
// matching outbound; every other target must name an existing outbound.
func renderSingBoxRules(override *SubscriptionOverride, outboundTags map[string]bool) ([]any, error) {
	var rendered []any
	for _, group := range override.Groups {
		if !group.Enabled {
			continue
		}
		action := ""
		switch strings.ToUpper(group.Target) {
		case "DIRECT":
			action = "direct"
		case "REJECT":
			action = "reject"
		default:
			if !outboundTags[group.Target] {
				return nil, fmt.Errorf("rule group %q references missing outbound %q", group.Name, group.Target)
			}
		}
		for _, value := range group.Rules {
			parsed, ok := ParseCustomRule(value)
			if !ok {
				return nil, fmt.Errorf("rule group %q: %q is not a domain, IP address or CIDR", group.Name, value)
			}
			rule := map[string]any{}
			switch parsed.Kind {
			case "domain":
				rule["domain_suffix"] = []any{parsed.Value}
			case "ip", "cidr":
				rule["ip_cidr"] = []any{parsed.CIDR}
			default:
				return nil, fmt.Errorf("rule group %q: %q is not a domain, IP address or CIDR", group.Name, value)
			}
			if action != "" {
				rule["action"] = action
			} else {
				rule["outbound"] = group.Target
			}
			rendered = append(rendered, rule)
		}
	}
	return rendered, nil
}

// applySingBoxDNSUpstreams appends the override nameservers as dns-custom-N
// servers and points final at the first one. Existing servers and rules stay
// untouched, so per-domain routing from the source keeps resolving.
func applySingBoxDNSUpstreams(raw map[string]any, dns *DNSOverride) {
	if dns == nil || len(dns.Nameservers) == 0 {
		return
	}
	section, _ := raw["dns"].(map[string]any)
	if section == nil {
		section = make(map[string]any)
	}
	servers, _ := section["servers"].([]any)
	kept := make([]any, 0, len(servers))
	for _, item := range servers {
		server, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if tag, _ := server["tag"].(string); strings.HasPrefix(tag, "dns-custom-") {
			continue
		}
		kept = append(kept, item)
	}
	for index, upstream := range dns.Nameservers {
		kept = append(kept, map[string]any{
			"tag":     fmt.Sprintf("dns-custom-%d", index),
			"address": upstream,
		})
	}
	section["servers"] = kept
	section["final"] = "dns-custom-0"
	raw["dns"] = section
}
