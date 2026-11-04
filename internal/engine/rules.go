package engine

import (
	"strings"

	"github.com/metacubex/mihomo/tunnel"
)

type RuleQuery struct {
	Offset       int
	Limit        int
	Search       string
	MatchType    string
	MatchPayload string
}

type IndexedRule struct {
	RuleItem
	Index int `json:"index"`
}

type RulePage struct {
	Rules []IndexedRule `json:"rules"`
	Total int           `json:"total"`
}

var ruleTypeSeparators = strings.NewReplacer("-", "", "_", "", " ", "")

// RulesPage reads the active core's rules while excluding lifecycle changes.
// A page only materializes its own rows unless it needs to scan for matches.
func (m *Manager) RulesPage(query RuleQuery) (RulePage, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	switch core := m.core.(type) {
	case *mihomoCore:
		rules := tunnel.Rules()
		return selectRules(query, len(rules), func(index int) RuleItem {
			rule := rules[index]
			return RuleItem{Type: rule.RuleType().String(), Payload: rule.Payload(), Proxy: rule.Adapter()}
		}), true
	case *singBoxCore:
		rules := core.instance.Router().Rules()
		return selectRules(query, len(rules), func(index int) RuleItem {
			rule := rules[index]
			return RuleItem{Type: rule.Type(), Payload: rule.String(), Proxy: rule.Action().String()}
		}), true
	default:
		return RulePage{}, false
	}
}

func selectRules(query RuleQuery, count int, ruleAt func(int) RuleItem) RulePage {
	page := RulePage{Rules: make([]IndexedRule, 0, query.Limit)}
	needle := strings.ToLower(strings.TrimSpace(query.Search))
	typeNeedle := ruleTypeSeparators.Replace(needle)
	if needle == "" && query.MatchType == "" {
		page.Total = count
		for index := query.Offset; index < count && len(page.Rules) < query.Limit; index++ {
			page.Rules = append(page.Rules, IndexedRule{RuleItem: ruleAt(index), Index: index + 1})
		}
		return page
	}

	for index := range count {
		rule := ruleAt(index)
		if query.MatchType != "" && !matchesReportedRule(rule, query) {
			continue
		}
		if needle != "" && !strings.Contains(strings.ToLower(rule.Payload), needle) &&
			!strings.Contains(strings.ToLower(rule.Proxy), needle) &&
			!(typeNeedle != "" && strings.Contains(ruleTypeSeparators.Replace(strings.ToLower(rule.Type)), typeNeedle)) {
			continue
		}
		if page.Total >= query.Offset && len(page.Rules) < query.Limit {
			page.Rules = append(page.Rules, IndexedRule{RuleItem: rule, Index: index + 1})
		}
		page.Total++
	}
	return page
}

func matchesReportedRule(rule RuleItem, query RuleQuery) bool {
	if strings.EqualFold(rule.Type, query.MatchType) && rule.Payload == query.MatchPayload {
		return true
	}
	// sing-box reports the rule and action together in the connection's rule field.
	return query.MatchPayload == "" && query.MatchType == rule.Payload+" => "+rule.Proxy
}
