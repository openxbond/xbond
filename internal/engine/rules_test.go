package engine

import "testing"

func TestRulePageOnlyReadsRequestedUnfilteredRows(t *testing.T) {
	const count = 153157
	reads := 0
	page := selectRules(RuleQuery{Offset: 50, Limit: 50}, count, func(index int) RuleItem {
		reads++
		return RuleItem{Type: "DomainSuffix", Payload: "example.test", Proxy: "DIRECT"}
	})
	if reads != 50 || page.Total != count || len(page.Rules) != 50 ||
		page.Rules[0].Index != 51 || page.Rules[49].Index != 100 {
		t.Fatalf("page read %d rules and returned %+v", reads, page)
	}
}

func TestRulePageSearchAndReportedMatchPreservePriority(t *testing.T) {
	rules := []RuleItem{
		{Type: "DomainSuffix", Payload: "example.test", Proxy: "DIRECT"},
		{Type: "Domain", Payload: "sub.example.test", Proxy: "proxy"},
		{Type: "DomainSuffix", Payload: "example.test", Proxy: "proxy"},
		{Type: "Match", Proxy: "DIRECT"},
	}
	at := func(index int) RuleItem { return rules[index] }
	search := selectRules(RuleQuery{Search: " PROXY ", Offset: 1, Limit: 1}, len(rules), at)
	if search.Total != 2 || len(search.Rules) != 1 || search.Rules[0].Index != 3 {
		t.Fatalf("unexpected search page: %+v", search)
	}
	byType := selectRules(RuleQuery{Search: "DOMAIN-SUFFIX", Limit: 50}, len(rules), at)
	if byType.Total != 2 {
		t.Fatalf("configuration syntax did not match runtime rule types: %+v", byType)
	}
	exact := selectRules(RuleQuery{MatchType: "domainsuffix", MatchPayload: "example.test", Limit: 50}, len(rules), at)
	if exact.Total != 2 || len(exact.Rules) != 2 || exact.Rules[0].Index != 1 || exact.Rules[1].Index != 3 {
		t.Fatalf("unexpected reported-match page: %+v", exact)
	}
	match := selectRules(RuleQuery{MatchType: "Match", Limit: 50}, len(rules), at)
	if match.Total != 1 || len(match.Rules) != 1 || match.Rules[0].Index != 4 {
		t.Fatalf("catch-all rule was not found: %+v", match)
	}
	singBox := selectRules(RuleQuery{MatchType: "domain=example.test => proxy", Limit: 50}, 1, func(int) RuleItem {
		return RuleItem{Type: "default", Payload: "domain=example.test", Proxy: "proxy"}
	})
	if singBox.Total != 1 || len(singBox.Rules) != 1 {
		t.Fatalf("sing-box reported rule was not found: %+v", singBox)
	}
}
