package engine

import (
	"encoding/json"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestApplyLayersClash(t *testing.T) {
	mixin := &GlobalMixin{
		BypassLAN:    true,
		RulesPrepend: []string{"DOMAIN,global.direct.example,DIRECT"},
		RulesAppend:  []string{"DOMAIN-SUFFIX,global.append.example,REJECT"},
		DNS: `nameserver:
  - 1.1.1.1
  - 8.8.8.8
`,
	}
	override := &SubscriptionOverride{
		RulesPrepend: []string{"DOMAIN,sub.override.example,DIRECT"},
		RulesAppend:  []string{"DOMAIN-KEYWORD,sub.append,DIRECT"},
	}

	merged, err := ApplyLayers([]byte(overrideClashFixture), override, mixin)
	if err != nil {
		t.Fatalf("ApplyLayers failed: %v", err)
	}

	var raw map[string]any
	if err := yaml.Unmarshal(merged, &raw); err != nil {
		t.Fatal(err)
	}

	rules, _ := raw["rules"].([]any)
	// Check LAN bypass rules are at the very beginning
	if len(rules) < len(clashLANBypassRules) {
		t.Fatalf("expected at least %d rules, got %d", len(clashLANBypassRules), len(rules))
	}
	if rules[0] != "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve" {
		t.Fatalf("expected IP-CIDR,127.0.0.0/8 first, got %v", rules[0])
	}

	// Verify order: LAN bypass -> Global Prepend -> Sub Prepend -> Source -> Sub Append -> Global Append
	idx := len(clashLANBypassRules)
	if rules[idx] != "DOMAIN,global.direct.example,DIRECT" {
		t.Fatalf("expected global prepend at index %d, got %v", idx, rules[idx])
	}
	idx++
	if rules[idx] != "DOMAIN,sub.override.example,DIRECT" {
		t.Fatalf("expected sub prepend at index %d, got %v", idx, rules[idx])
	}

	// Last rule should be global append
	if rules[len(rules)-1] != "DOMAIN-SUFFIX,global.append.example,REJECT" {
		t.Fatalf("expected global append at end, got %v", rules[len(rules)-1])
	}
	if rules[len(rules)-2] != "DOMAIN-KEYWORD,sub.append,DIRECT" {
		t.Fatalf("expected sub append right before global append, got %v", rules[len(rules)-2])
	}

	// Verify DNS
	dns, _ := raw["dns"].(map[string]any)
	if dns == nil {
		t.Fatal("dns section missing after merge")
	}
	nameservers, _ := dns["nameserver"].([]any)
	if len(nameservers) != 2 || nameservers[0] != "1.1.1.1" {
		t.Fatalf("unexpected nameserver after mixin: %v", nameservers)
	}

	if err := Validate(merged); err != nil {
		t.Fatalf("merged config must pass the core gate: %v", err)
	}
}

func TestApplyLayersSingBox(t *testing.T) {
	mixin := &GlobalMixin{
		BypassLAN:    true,
		RulesPrepend: []string{`{"domain": ["global.direct"], "outbound": "direct"}`},
		RulesAppend:  []string{`{"domain_suffix": [".block.example"], "outbound": "direct"}`},
	}
	override := &SubscriptionOverride{
		RulesPrepend: []string{`{"domain": ["sub.direct"], "outbound": "direct"}`},
	}

	merged, err := ApplyLayers([]byte(overrideSingBoxFixture), override, mixin)
	if err != nil {
		t.Fatalf("ApplyLayers sing-box failed: %v", err)
	}

	var raw map[string]any
	if err := json.Unmarshal(merged, &raw); err != nil {
		t.Fatal(err)
	}

	route, _ := raw["route"].(map[string]any)
	rules, _ := route["rules"].([]any)
	if len(rules) != 5 {
		// 1 (bypassLAN) + 1 (mixinPrepend) + 1 (overridePrepend) + 1 (source) + 1 (mixinAppend) = 5
		t.Fatalf("expected 5 rules, got %d: %v", len(rules), rules)
	}

	firstRule, _ := rules[0].(map[string]any)
	if firstRule["ip_is_private"] != true || firstRule["outbound"] != "direct" {
		t.Fatalf("expected ip_is_private: true first rule, got %v", firstRule)
	}

	if err := Validate(merged); err != nil {
		t.Fatalf("merged sing-box config must pass validate: %v", err)
	}
}

func TestApplyLayersZeroIsIdentity(t *testing.T) {
	merged, err := ApplyLayers([]byte(overrideClashFixture), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if string(merged) != overrideClashFixture {
		t.Fatal("nil layers must return source unmodified")
	}

	merged, err = ApplyLayers([]byte(overrideClashFixture), &SubscriptionOverride{}, &GlobalMixin{})
	if err != nil {
		t.Fatal(err)
	}
	if string(merged) != overrideClashFixture {
		t.Fatal("zero layers must return source unmodified")
	}
}

func TestApplyLayersConflictFails(t *testing.T) {
	mixin := &GlobalMixin{
		RulesPrepend: []string{"DOMAIN,bad.example,non-existent-group"},
	}
	_, err := ApplyLayers([]byte(overrideClashFixture), nil, mixin)
	if err == nil || !strings.Contains(err.Error(), "references missing policy") {
		t.Fatalf("expected missing policy error, got: %v", err)
	}
}