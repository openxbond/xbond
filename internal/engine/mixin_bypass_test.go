package engine

import (
	"encoding/json"
	"testing"
)

// 缺 "direct" 出站的 sing-box 订阅能通过配置校验，但运行时每条私网连接
// 都报 "outbound not found"：BypassLAN 必须补上缺失的保留出站（审计 #19）。
func TestApplyLayersSingBoxBypassLANAppendsDirectOutbound(t *testing.T) {
	source := []byte(`{"outbounds":[
		{"type":"selector","tag":"PROXY","outbounds":["HK-01"]},
		{"type":"vless","tag":"HK-01","server":"1.2.3.4","server_port":443,"uuid":"fixture-only"}
	],"route":{"rules":[{"protocol":"dns","outbound":"dns-out"}]}}`)
	merged, err := ApplyLayers(source, nil, &GlobalMixin{BypassLAN: true})
	if err != nil {
		t.Fatalf("ApplyLayers failed: %v", err)
	}

	var raw struct {
		Outbounds []struct {
			Tag  string `json:"tag"`
			Type string `json:"type"`
		} `json:"outbounds"`
		Route struct {
			Rules []struct {
				IPPrivate bool   `json:"ip_is_private"`
				Outbound  string `json:"outbound"`
			} `json:"rules"`
		} `json:"route"`
	}
	if err := json.Unmarshal(merged, &raw); err != nil {
		t.Fatal(err)
	}
	hasDirect := false
	for _, outbound := range raw.Outbounds {
		if outbound.Tag == "direct" && outbound.Type == "direct" {
			hasDirect = true
		}
	}
	if !hasDirect {
		t.Fatalf("BypassLAN must append the missing direct outbound: %+v", raw.Outbounds)
	}
	if len(raw.Route.Rules) == 0 || raw.Route.Rules[0].Outbound != "direct" || !raw.Route.Rules[0].IPPrivate {
		t.Fatalf("the private-IP rule must ride the direct outbound and sit first: %+v", raw.Route.Rules)
	}
	if last := raw.Route.Rules[len(raw.Route.Rules)-1]; last.Outbound != "dns-out" {
		t.Fatalf("existing route rules must survive the prepend: %+v", raw.Route.Rules)
	}
}
