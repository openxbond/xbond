package diag

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/sub"
)

func TestRedact(t *testing.T) {
	input := `
token=sub-abcdef1234567890
proxy=px-9876543210fedcba
path=/ws/secret-stream-endpoint?param=1
url=https://www.xbond.net/api/subscription/config?token=sub-abcdef1234567890&target=clash
header: Authorization: Bearer eyJhbGciOi...
json: {
  "password": "super-secret-password",
  "uuid": "12345678-1234-1234-1234-1234567890ab",
  "secret": "my-clash-secret"
}
`
	redacted := Redact(input)

	forbidden := []string{
		"sub-abcdef1234567890",
		"px-9876543210fedcba",
		"/ws/secret-stream-endpoint",
		"super-secret-password",
		"12345678-1234-1234-1234-1234567890ab",
		"my-clash-secret",
		"eyJhbGciOi...",
	}

	for _, token := range forbidden {
		if strings.Contains(redacted, token) {
			t.Errorf("expected %q to be redacted, but was found in output:\n%s", token, redacted)
		}
	}

	if !strings.Contains(redacted, "sub-[REDACTED]") {
		t.Errorf("expected sub-[REDACTED] in output")
	}
	if !strings.Contains(redacted, "px-[REDACTED]") {
		t.Errorf("expected px-[REDACTED] in output")
	}
	if !strings.Contains(redacted, "/ws/[REDACTED]") {
		t.Errorf("expected /ws/[REDACTED] in output")
	}
}

func TestResolveStrategyChain(t *testing.T) {
	proxies := map[string]engine.ProxyItem{
		"🔥節點選擇": {
			Name: "🔥節點選擇",
			Type: "Selector",
			Now:  "♻️自動選擇",
			All:  []string{"♻️自動選擇", "🇭🇰 香港 01"},
		},
		"♻️自動選擇": {
			Name: "♻️自動選擇",
			Type: "URLTest",
			Now:  "🇭🇰 香港 01",
			All:  []string{"🇭🇰 香港 01", "🇯🇵 日本 01"},
		},
		"🇭🇰 香港 01": {
			Name: "🇭🇰 香港 01",
			Type: "Trojan",
		},
		"🇯🇵 日本 01": {
			Name: "🇯🇵 日本 01",
			Type: "Trojan",
		},
	}

	root, chain := ResolveStrategyChain(proxies)
	if root != "🔥節點選擇" {
		t.Errorf("expected root group '🔥節點選擇', got %q", root)
	}

	expectedChain := []string{"🔥節點選擇", "♻️自動選擇", "🇭🇰 香港 01"}
	if len(chain) != len(expectedChain) {
		t.Fatalf("expected chain length %d, got %d (%v)", len(expectedChain), len(chain), chain)
	}
	for i, item := range expectedChain {
		if chain[i] != item {
			t.Errorf("chain item %d expected %s, got %s", i, item, chain[i])
		}
	}
}

func TestEvaluateThreeTierPortMode(t *testing.T) {
	st := EvaluateThreeTier(context.Background(), nil, engine.EngineStatus{}, engine.ModePort, engine.RoutingRule, 7890)
	if st.TrafficIntercepted {
		t.Errorf("port mode should have trafficIntercepted=false")
	}
	if !strings.Contains(st.InterceptNote, "port mode only") {
		t.Errorf("expected interceptNote in port mode, got %q", st.InterceptNote)
	}
}

// bug report 的设计用途是交给第三方：doctor 嵌入的订阅 meta 带原始凭据、
// 旧存储里可能还有未脱敏的拉取错误文本，任何一处漏网都等于把订阅 token
// 发布出去（审计：安全第二条）。
func TestGenerateBugReportRedactsEmbeddedSubscription(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	subMgr, err := sub.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	token := "sub-" + strings.Repeat("a", 32)
	if _, err := subMgr.AddXBond(token, "", nil, "", "zh-HK", "XBond", 24, true); err != nil {
		t.Fatal(err)
	}

	report := GenerateBugReport(context.Background(), nil, nil, engine.EngineStatus{}, subMgr, engine.ModePort, engine.RoutingRule, 0)
	data, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), token) {
		t.Fatal("bug report JSON carries the raw subscription token")
	}
	if !strings.Contains(string(data), "sub-[REDACTED]") {
		t.Fatal("expected the token to appear redacted in the report")
	}
}
