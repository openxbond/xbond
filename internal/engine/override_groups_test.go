package engine

import (
	"encoding/json"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

const groupsClashFixture = `proxies:
  - name: edge
    type: trojan
    server: example.invalid
    port: 443
    password: fixture-only
proxy-groups:
  - name: policy
    type: select
    proxies: [edge]
rules:
  - DOMAIN-SUFFIX,example.invalid,policy
  - MATCH,policy
`

const groupsSingBoxFixture = `{
  "outbounds": [
    {"type": "direct", "tag": "direct"},
    {"type": "trojan", "tag": "edge", "server": "example.invalid", "server_port": 443, "password": "fixture-only"},
    {"type": "selector", "tag": "policy", "outbounds": ["edge", "direct"]}
  ],
  "route": {"rules": [{"domain_suffix": [".example.invalid"], "outbound": "direct"}], "final": "policy"}
}`

func groupOverride() *SubscriptionOverride {
	return &SubscriptionOverride{
		Groups: []RuleGroup{
			{Name: "Corp", Target: "DIRECT", Enabled: true, Rules: []string{"internal.example", "10.0.0.0/8"}},
			{Name: "Ads", Target: "REJECT", Enabled: true, Rules: []string{"ads.example"}},
			{Name: "Off", Target: "DIRECT", Enabled: false, Rules: []string{"off.example"}},
			{Name: "Empty", Target: "DIRECT", Enabled: true, Rules: []string{"  ", ""}},
		},
		DNS: &DNSOverride{Nameservers: []string{"223.5.5.5", " 8.8.8.8 "}},
	}
}

// Groups expand in order ahead of the source: normalized entries only, the
// disabled and empty groups dropped, DNS pointing nameserver/fallback at the
// upstream list.
func TestApplyOverrideGroupsClash(t *testing.T) {
	merged, err := ApplyOverride([]byte(groupsClashFixture), groupOverride())
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := yaml.Unmarshal(merged, &raw); err != nil {
		t.Fatal(err)
	}
	rules, _ := raw["rules"].([]any)
	want := []string{
		"DOMAIN-SUFFIX,internal.example,DIRECT",
		"IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
		"DOMAIN-SUFFIX,ads.example,REJECT",
		"DOMAIN-SUFFIX,example.invalid,policy",
		"MATCH,policy",
	}
	if len(rules) != len(want) {
		t.Fatalf("expected %d rules, got %v", len(want), rules)
	}
	for i, rule := range want {
		if rules[i] != rule {
			t.Fatalf("rule %d = %v, want %q (all: %v)", i, rules[i], rule, rules)
		}
	}
	dns, _ := raw["dns"].(map[string]any)
	servers, _ := dns["nameserver"].([]any)
	if len(servers) != 2 || servers[0] != "223.5.5.5" || servers[1] != "8.8.8.8" {
		t.Fatalf("nameserver = %v, want the upstream list", servers)
	}
	// The override carries no fallback, so the source's list (none here)
	// stays absent: the override owns DNS once present.
	if _, hasFallback := dns["fallback"]; hasFallback {
		t.Fatalf("override without fallback must remove the source's list: %v", dns)
	}
	if err := Validate(merged); err != nil {
		t.Fatalf("merged config must pass the core gate: %v", err)
	}
}

// Clash fallback is its own pollution-review list: a non-empty override
// replaces the source's list, an empty one removes it, and duplicates of
// nameserver entries are dropped.
func TestApplyOverrideClashFallback(t *testing.T) {
	source := []byte(`dns:
  enable: true
  nameserver: [1.1.1.1]
  fallback: [9.9.9.9]
` + groupsClashFixture)
	merged, err := ApplyOverride(source, &SubscriptionOverride{
		DNS: &DNSOverride{
			Nameservers: []string{"223.5.5.5"},
			Fallback:    []string{"8.8.8.8", "223.5.5.5"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := yaml.Unmarshal(merged, &raw); err != nil {
		t.Fatal(err)
	}
	dns, _ := raw["dns"].(map[string]any)
	if servers, _ := dns["nameserver"].([]any); len(servers) != 1 || servers[0] != "223.5.5.5" {
		t.Fatalf("nameserver = %v, want the override list", servers)
	}
	if fallback, _ := dns["fallback"].([]any); len(fallback) != 1 || fallback[0] != "8.8.8.8" {
		t.Fatalf("fallback = %v, want the override list without the nameserver duplicate", fallback)
	}
	if err := Validate(merged); err != nil {
		t.Fatalf("merged config with fallback must pass the core gate: %v", err)
	}

	// No fallback entries: the source's list is removed, not kept.
	merged, err = ApplyOverride(source, &SubscriptionOverride{
		DNS: &DNSOverride{Nameservers: []string{"223.5.5.5"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := yaml.Unmarshal(merged, &raw); err != nil {
		t.Fatal(err)
	}
	if _, hasFallback := raw["dns"].(map[string]any)["fallback"]; hasFallback {
		t.Fatalf("empty override fallback must remove the source's list: %v", raw["dns"])
	}
}

// sing-box has no fallback mechanism: one is rejected instead of being
// silently dropped.
func TestApplyOverrideSingBoxFallbackRejected(t *testing.T) {
	bad := &SubscriptionOverride{
		DNS: &DNSOverride{
			Nameservers: []string{"223.5.5.5"},
			Fallback:    []string{"8.8.8.8"},
		},
	}
	if _, err := ApplyOverride([]byte(groupsSingBoxFixture), bad); err == nil ||
		!strings.Contains(err.Error(), "only to Clash subscriptions") {
		t.Fatalf("expected fallback rejection for sing-box, got: %v", err)
	}
}

// sing-box renders DIRECT/REJECT as native actions and proxy targets as
// outbounds; DNS upstreams land as dns-custom-N servers with final on the
// first one.
func TestApplyOverrideGroupsSingBox(t *testing.T) {
	merged, err := ApplyOverride([]byte(groupsSingBoxFixture), groupOverride())
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(merged, &raw); err != nil {
		t.Fatal(err)
	}
	route, _ := raw["route"].(map[string]any)
	rules, _ := route["rules"].([]any)
	if len(rules) != 4 {
		t.Fatalf("expected 3 group rules + 1 source rule, got %v", rules)
	}
	first, _ := rules[0].(map[string]any)
	if first["action"] != "direct" {
		t.Fatalf("DIRECT group must render a native action: %v", first)
	}
	second, _ := rules[1].(map[string]any)
	if cidrs, _ := second["ip_cidr"].([]any); len(cidrs) != 1 || cidrs[0] != "10.0.0.0/8" {
		t.Fatalf("CIDR entry must render ip_cidr: %v", second)
	}
	dns, _ := raw["dns"].(map[string]any)
	if dns["final"] != "dns-custom-0" {
		t.Fatalf("final must point at the first custom server: %v", dns)
	}
	servers, _ := dns["servers"].([]any)
	if len(servers) != 2 {
		t.Fatalf("expected 2 custom servers, got %v", servers)
	}
	if err := Validate(merged); err != nil {
		t.Fatalf("merged sing-box config must pass the core gate: %v", err)
	}
}

// A target the source does not offer fails loudly at save time.
func TestApplyOverrideGroupMissingTarget(t *testing.T) {
	bad := &SubscriptionOverride{
		Groups: []RuleGroup{{Name: "Bad", Target: "ghost", Enabled: true, Rules: []string{"example.com"}}},
	}
	if _, err := ApplyOverride([]byte(groupsClashFixture), bad); err == nil ||
		!strings.Contains(err.Error(), `references missing policy "ghost"`) {
		t.Fatalf("expected missing policy error, got: %v", err)
	}
	if _, err := ApplyOverride([]byte(groupsSingBoxFixture), bad); err == nil ||
		!strings.Contains(err.Error(), `references missing outbound "ghost"`) {
		t.Fatalf("expected missing outbound error, got: %v", err)
	}
}

// A group whose target disappeared upstream fails the update gate the same way.
func TestApplyOverrideGroupInvalidLine(t *testing.T) {
	bad := &SubscriptionOverride{
		Groups: []RuleGroup{{Name: "Bad", Target: "DIRECT", Enabled: true, Rules: []string{"not a domain!"}}},
	}
	if _, err := ApplyOverride([]byte(groupsClashFixture), bad); err == nil ||
		!strings.Contains(err.Error(), "not a domain") {
		t.Fatalf("expected invalid entry error, got: %v", err)
	}
}

// Zero and invalid shapes: nil/empty is identity, limits fail with the
// offending count, bad DNS fails naming the entry.
func TestApplyOverrideGroupsNormalize(t *testing.T) {
	// Disabled groups survive normalization so the switch stays editable;
	// groups with no entries are dropped.
	normalized, err := groupOverride().Normalize()
	if err != nil {
		t.Fatalf("normalize failed: %v", err)
	}
	if len(normalized.Groups) != 3 {
		t.Fatalf("expected 3 stored groups, got %+v", normalized.Groups)
	}
	if normalized.Groups[2].Name != "Off" || normalized.Groups[2].Enabled {
		t.Fatalf("disabled group state lost: %+v", normalized.Groups[2])
	}
	if !normalized.applies() {
		t.Fatal("enabled groups must apply")
	}
	disabledOnly, err := (&SubscriptionOverride{Groups: []RuleGroup{
		{Name: "Off", Target: "DIRECT", Enabled: false, Rules: []string{"x.example"}},
	}}).Normalize()
	if err != nil || disabledOnly.applies() {
		t.Fatalf("disabled-only override must be stored but inert: %v %v", err, disabledOnly)
	}

	zero := []*SubscriptionOverride{nil, {}, {Groups: []RuleGroup{{Name: "Off", Target: "DIRECT", Rules: []string{"x.example"}}}}}
	for _, override := range zero {
		merged, err := ApplyOverride([]byte(groupsClashFixture), override)
		if err != nil || string(merged) != groupsClashFixture {
			t.Fatalf("zero override must be identity: %v", err)
		}
	}
	many := &SubscriptionOverride{}
	for i := 0; i < MaxRuleGroups+1; i++ {
		many.Groups = append(many.Groups, RuleGroup{Name: "g", Target: "DIRECT", Enabled: true, Rules: []string{"example.com"}})
	}
	if _, err := ApplyOverride([]byte(groupsClashFixture), many); err == nil || !strings.Contains(err.Error(), "at most 10") {
		t.Fatalf("expected group limit error, got: %v", err)
	}
	badDNS := &SubscriptionOverride{DNS: &DNSOverride{Nameservers: []string{"gopher://x"}}}
	if _, err := ApplyOverride([]byte(groupsClashFixture), badDNS); err == nil || !strings.Contains(err.Error(), "not a usable address") {
		t.Fatalf("expected DNS upstream error, got: %v", err)
	}
	fallbackOnly := &SubscriptionOverride{DNS: &DNSOverride{Fallback: []string{"8.8.8.8"}}}
	if _, err := ApplyOverride([]byte(groupsClashFixture), fallbackOnly); err == nil || !strings.Contains(err.Error(), "need at least one nameserver") {
		t.Fatalf("expected fallback-only rejection, got: %v", err)
	}
	tooMany := &SubscriptionOverride{DNS: &DNSOverride{Fallback: []string{
		"1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4", "9.9.9.9", "9.9.9.10",
		"208.67.222.222", "208.67.220.220", "94.140.14.14",
	}}}
	if _, err := ApplyOverride([]byte(groupsClashFixture), tooMany); err == nil || !strings.Contains(err.Error(), "DNS fallback holds 9") {
		t.Fatalf("expected per-list limit error, got: %v", err)
	}
}

// ListPolicies mirrors what the UI offers: policy groups first, built-ins
// appended, individual nodes only when the source ships no groups.
func TestListPolicies(t *testing.T) {
	format, policies, err := ListPolicies([]byte(groupsClashFixture))
	if err != nil || format != FormatClash {
		t.Fatalf("ListPolicies clash: %v %q", err, format)
	}
	if got := strings.Join(policies, ","); got != "policy,DIRECT,REJECT" {
		t.Fatalf("clash policies = %q, want %q", got, "policy,DIRECT,REJECT")
	}
	format, policies, err = ListPolicies([]byte(groupsSingBoxFixture))
	if err != nil || format != FormatSingBox {
		t.Fatalf("ListPolicies sing-box: %v %q", err, format)
	}
	if got := strings.Join(policies, ","); got != "policy,DIRECT,REJECT" {
		t.Fatalf("sing-box policies = %q, want %q", got, "policy,DIRECT,REJECT")
	}

	// No policy groups: individual nodes are the only targets a rule can use.
	nodeOnly := "proxies:\n  - name: edge\n    type: trojan\n    server: example.invalid\n    port: 443\n    password: fixture-only\n"
	format, policies, err = ListPolicies([]byte(nodeOnly))
	if err != nil || format != FormatClash {
		t.Fatalf("ListPolicies node-only: %v %q", err, format)
	}
	if got := strings.Join(policies, ","); got != "edge,DIRECT,REJECT" {
		t.Fatalf("node-only policies = %q, want %q", got, "edge,DIRECT,REJECT")
	}
}
