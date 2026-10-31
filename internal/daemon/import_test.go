package daemon

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/sub"
)

func TestImportRequiresExplicitNodeExtractionAndPreservesWorkingRuntime(t *testing.T) {
	f := newRuntimeFixture(t)
	server := &Server{subMgr: f.subs, runtime: f.controller}
	before := string(f.core.configuration())
	const content = `proxies:
  - {name: edge, type: trojan, server: example.invalid, port: 443, password: fixture-only}
rules: [MATCH,DIRECT]
`
	request := func(nodesOnly bool) *struct {
		OK          bool                  `json:"ok"`
		Meta        *sub.SubscriptionMeta `json:"meta"`
		UpdateError string                `json:"updateError"`
	} { body, err := json.Marshal(map[string]any{"content": content, "clashNodesOnly": nodesOnly}); if err != nil {
		t.Fatal(err)
	}; response := runtimeRequest(server.handleLogin, string(body)); var result struct {
		OK          bool                  `json:"ok"`
		Meta        *sub.SubscriptionMeta `json:"meta"`
		UpdateError string                `json:"updateError"`
	}; if response.Code != http.StatusOK {
		t.Fatalf("unexpected import status %d", response.Code)
	}; if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}; return &result }
	strict := request(false)
	if strict.UpdateError == "" || strings.Contains(strict.UpdateError, "fixture-only") || f.subs.ActiveID() != f.first.ID || string(f.core.configuration()) != before {
		t.Fatal("failed strict import changed runtime or leaked credentials")
	}
	nodes := request(true)
	if nodes.UpdateError != "" || nodes.Meta == nil || !nodes.Meta.ClashNodesOnly || nodes.Meta.ID == strict.Meta.ID || f.subs.ActiveID() != nodes.Meta.ID {
		t.Fatalf("explicit extraction did not apply: %s", nodes.UpdateError)
	}
	if string(f.core.configuration()) == before {
		t.Fatal("successful extraction did not reach runtime")
	}
	response := runtimeRequest(server.handleLogin, `{"token":"fixture-only","clashNodesOnly":true}`)
	if response.Code != http.StatusBadRequest {
		t.Fatal("Cloud import accepted a Clash extraction policy")
	}
}
