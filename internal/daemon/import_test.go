package daemon

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/sub"
)

// With the mihomo core, Clash YAML is native: a valid configuration imports
// on the default path, while content the core rejects must fail without
// touching the working runtime. The explicit node-extraction policy remains
// cloud-import exclusive.
func TestImportValidatesAgainstCoreAndPreservesWorkingRuntime(t *testing.T) {
	f := newRuntimeFixture(t)
	server := &Server{subMgr: f.subs, runtime: f.controller}
	before := string(f.core.configuration())
	const broken = `proxies:
  - {name: edge, type: unsupported-transport, server: example.invalid, port: 443, password: fixture-only}
`
	const valid = `proxies:
  - {name: edge, type: trojan, server: example.invalid, port: 443, password: fixture-only}
rules:
  - MATCH,DIRECT
`
	request := func(content string) *struct {
		OK          bool                  `json:"ok"`
		Meta        *sub.SubscriptionMeta `json:"meta"`
		UpdateError string                `json:"updateError"`
	} {
		body, err := json.Marshal(map[string]any{"content": content})
		if err != nil {
			t.Fatal(err)
		}
		response := runtimeRequest(server.handleLogin, string(body))
		if response.Code != http.StatusOK {
			t.Fatalf("unexpected import status %d", response.Code)
		}
		var result struct {
			OK          bool                  `json:"ok"`
			Meta        *sub.SubscriptionMeta `json:"meta"`
			UpdateError string                `json:"updateError"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return &result
	}

	rejected := request(broken)
	if rejected.UpdateError == "" || strings.Contains(rejected.UpdateError, "fixture-only") || f.subs.ActiveID() != f.first.ID || string(f.core.configuration()) != before {
		t.Fatal("failed import changed runtime or leaked credentials")
	}

	good := request(valid)
	if good.UpdateError != "" || good.Meta == nil || f.subs.ActiveID() != good.Meta.ID {
		t.Fatalf("valid import did not apply: %s", good.UpdateError)
	}
	if string(f.core.configuration()) == before {
		t.Fatal("successful import did not reach runtime")
	}

	response := runtimeRequest(server.handleLogin, `{"token":"fixture-only","clashNodesOnly":true}`)
	if response.Code != http.StatusBadRequest {
		t.Fatal("Cloud import accepted a Clash extraction policy")
	}
}
