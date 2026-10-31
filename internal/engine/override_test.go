package engine

import (
	"encoding/json"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

const overrideClashFixture = `proxies:
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

const overrideSingBoxFixture = `{
  "outbounds": [
    {"type": "direct", "tag": "direct"},
    {"type": "trojan", "tag": "edge", "server": "example.invalid", "server_port": 443, "password": "fixture-only"},
    {"type": "selector", "tag": "policy", "outbounds": ["edge", "direct"]}
  ],
  "route": {"rules": [{"domain_suffix": [".example.invalid"], "outbound": "direct"}], "final": "policy"}
}`

func TestApplyOverrideClashSplicesAndKeepsSource(t *testing.T) {
	merged, err := ApplyOverride([]byte(overrideClashFixture), &SubscriptionOverride{
		RulesPrepend: []string{"DOMAIN,blocked.example.invalid,REJECT"},
		RulesAppend:  []string{"IP-CIDR,10.0.0.0/8,DIRECT,no-resolve"},
	})
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := yaml.Unmarshal(merged, &raw); err != nil {
		t.Fatal(err)
	}
	rules, _ := raw["rules"].([]any)
	if len(rules) != 4 {
		t.Fatalf("expected 4 rules after splice, got %v", rules)
	}
	if rules[0] != "DOMAIN,blocked.example.invalid,REJECT" || rules[len(rules)-1] != "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve" {
		t.Fatalf("unexpected rule order: %v", rules)
	}
	if rules[1] != "DOMAIN-SUFFIX,example.invalid,policy" || rules[2] != "MATCH,policy" {
		t.Fatalf("source rules must keep their order: %v", rules)
	}
	proxies, _ := raw["proxies"].([]any)
	if len(proxies) != 1 {
		t.Fatalf("source content must survive the splice: %v", raw)
	}
	if err := Validate(merged); err != nil {
		t.Fatalf("merged config must pass the core gate: %v", err)
	}
}

func TestApplyOverrideClashConflicts(t *testing.T) {
	for name, override := range map[string]*SubscriptionOverride{
		"missing-policy": {RulesAppend: []string{"DOMAIN,x.example,ghost"}},
		"malformed":      {RulesPrepend: []string{"not-a-rule"}},
	} {
		if _, err := ApplyOverride([]byte(overrideClashFixture), override); err == nil {
			t.Fatalf("%s: conflicting override accepted", name)
		} else if strings.Contains(err.Error(), "fixture-only") {
			t.Fatalf("credentials leaked: %v", err)
		}
	}
	// MATCH and logic rules resolve their policy from the right position.
	for _, rule := range []string{"MATCH,DIRECT", "AND,((DOMAIN,a.test),(DOMAIN,b.test)),REJECT"} {
		if _, err := ApplyOverride([]byte(overrideClashFixture), &SubscriptionOverride{RulesAppend: []string{rule}}); err != nil {
			t.Fatalf("rule %q rejected: %v", rule, err)
		}
	}
}

func TestApplyOverrideSingBoxSplicesAndConflicts(t *testing.T) {
	merged, err := ApplyOverride([]byte(overrideSingBoxFixture), &SubscriptionOverride{
		RulesPrepend: []string{`{"domain": ["blocked.example"], "outbound": "direct"}`},
		RulesAppend:  []string{`{"protocol": "dns", "outbound": "direct"}`},
	})
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(merged, &raw); err != nil {
		t.Fatal(err)
	}
	route, _ := raw["route"].(map[string]any)
	rules, _ := route["rules"].([]any)
	if len(rules) != 3 {
		t.Fatalf("expected 3 route rules after splice, got %v", rules)
	}
	first, _ := rules[0].(map[string]any)
	if first["outbound"] != "direct" {
		t.Fatalf("prepended rule must come first: %v", rules)
	}
	if err := Validate(merged); err != nil {
		t.Fatalf("merged config must pass the core gate: %v", err)
	}

	if _, err := ApplyOverride([]byte(overrideSingBoxFixture), &SubscriptionOverride{
		RulesAppend: []string{`{"outbound": "ghost"}`},
	}); err == nil {
		t.Fatal("override referencing a missing outbound was accepted")
	}
	// A line that is not a JSON object fails here; a structurally valid rule
	// with a wrong field type passes the splice and fails the core gate.
	if _, err := ApplyOverride([]byte(overrideSingBoxFixture), &SubscriptionOverride{
		RulesAppend: []string{`["not an object"]`},
	}); err == nil {
		t.Fatal("non-object override rule was accepted")
	}
	merged, err = ApplyOverride([]byte(overrideSingBoxFixture), &SubscriptionOverride{
		RulesAppend: []string{`{"outbound": 123}`},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := Validate(merged); err == nil {
		t.Fatal("type-wrong override rule must fail the core gate")
	}
}

// A zero override changes nothing: the source passes through byte-identical.
func TestApplyOverrideZeroIsIdentity(t *testing.T) {
	source := []byte(overrideClashFixture)
	merged, err := ApplyOverride(source, nil)
	if err != nil || string(merged) != string(source) {
		t.Fatalf("nil override must be an identity: %v", err)
	}
	merged, err = ApplyOverride(source, &SubscriptionOverride{})
	if err != nil || string(merged) != string(source) {
		t.Fatalf("empty override must be an identity: %v", err)
	}
	if _, err := ApplyOverride([]byte("{"), &SubscriptionOverride{RulesAppend: []string{"MATCH,DIRECT"}}); err == nil {
		t.Fatal("unparseable source must fail")
	}
}
