package mobile

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
)

// sampleClashConfig is the minimal valid Clash YAML the API tests import as
// inline profile content.
const sampleClashConfig = `proxies:
  - name: "HK-01"
    type: trojan
    server: 1.2.3.4
    port: 443
    password: "pass"
    sni: "hk.example.com"
proxy-groups:
  - name: "Proxy"
    type: select
    proxies: ["HK-01"]
`

func newTestAPIServer(t *testing.T) (*TunnelService, *apiServer) {
	t.Helper()
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	svc := NewTunnelService(&mockPlatform{}, &mockListener{})
	if svc.api == nil {
		t.Fatal("in-process local API server did not start")
	}
	return svc, svc.api
}

// jsonQuote renders a Go string as a JSON string literal for request bodies.
func jsonQuote(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func apiCall(t *testing.T, s *apiServer, method, path, body string) (int, []byte, http.Header) {
	t.Helper()
	var reqBody io.Reader
	if body != "" {
		reqBody = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d%s", s.port, path), reqBody)
	if err != nil {
		t.Fatal(err)
	}
	if method != http.MethodOptions {
		req.Header.Set("X-XBond-Token", s.token)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res.StatusCode, data, res.Header
}

// The dev-server UI talks cross-origin to the loopback LocalAPI: preflight
// must pass without a token, and real calls without one must stay 401.
func TestAPICorsPreflightAndAuth(t *testing.T) {
	_, s := newTestAPIServer(t)

	code, _, header := apiCall(t, s, http.MethodOptions, "/localapi/v0/status", "")
	if code != http.StatusNoContent {
		t.Fatalf("expected OPTIONS preflight 204, got %d", code)
	}
	if header.Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("expected permissive CORS origin, got %q", header.Get("Access-Control-Allow-Origin"))
	}
	if !strings.Contains(header.Get("Access-Control-Allow-Methods"), "PUT") {
		t.Errorf("expected PUT in allowed methods, got %q", header.Get("Access-Control-Allow-Methods"))
	}

	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/localapi/v0/status", s.port), nil)
	if err != nil {
		t.Fatal(err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", res.StatusCode)
	}
}

func TestAPIStatusReportsRulePaging(t *testing.T) {
	_, s := newTestAPIServer(t)
	code, data, _ := apiCall(t, s, http.MethodGet, "/localapi/v0/status?light=1", "")
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", code, data)
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["rulePaging"] != true {
		t.Errorf("expected rulePaging capability, got %v", payload["rulePaging"])
	}
}

// The unified profiles endpoint: inline import lands as a subscription and
// the list reflects it with the active id.
func TestAPIProfilesImportAndList(t *testing.T) {
	svc, s := newTestAPIServer(t)

	code, data, _ := apiCall(t, s, http.MethodPost, "/localapi/v0/profiles",
		`{"kind":"inline","name":"Test Profile","content":`+jsonQuote(sampleClashConfig)+`,"use":true}`)
	if code != http.StatusOK {
		t.Fatalf("expected 200 on inline import, got %d: %s", code, data)
	}
	var added struct {
		Meta        *struct{ ID string } `json:"meta"`
		OK          bool                 `json:"ok"`
		UpdateError string               `json:"updateError"`
	}
	if err := json.Unmarshal(data, &added); err != nil {
		t.Fatal(err)
	}
	if added.Meta == nil || added.Meta.ID == "" {
		t.Fatalf("expected imported profile meta, got %s", data)
	}
	if added.UpdateError != "" {
		t.Logf("inline import update note (content subscriptions may defer): %s", added.UpdateError)
	}

	code, data, _ = apiCall(t, s, http.MethodGet, "/localapi/v0/profiles", "")
	if code != http.StatusOK {
		t.Fatalf("expected 200 on list, got %d", code)
	}
	var list struct {
		ActiveID string                `json:"activeId"`
		Profiles []struct{ ID string } `json:"profiles"`
	}
	if err := json.Unmarshal(data, &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Profiles) != 1 {
		t.Fatalf("expected exactly one profile, got %d", len(list.Profiles))
	}
	if list.ActiveID == "" {
		t.Errorf("expected an active profile id after import")
	}
	if svc.subMgr.ActiveID() == "" {
		t.Errorf("store should hold the active subscription")
	}
}

// Override and global mixin round-trip through the same endpoints the shared
// UI already calls against the daemon.
func TestAPISubOverrideAndGlobalMixinRoundtrip(t *testing.T) {
	_, s := newTestAPIServer(t)

	// Seed one subscription.
	code, data, _ := apiCall(t, s, http.MethodPost, "/localapi/v0/profiles",
		`{"kind":"inline","name":"Override Test","content":`+jsonQuote(sampleClashConfig)+`,"use":false}`)
	if code != http.StatusOK {
		t.Fatalf("seed import failed: %d %s", code, data)
	}
	var added struct {
		Meta *struct{ ID string } `json:"meta"`
	}
	if err := json.Unmarshal(data, &added); err != nil || added.Meta == nil {
		t.Fatalf("seed import produced no meta: %s", data)
	}
	id := added.Meta.ID

	// Empty override on GET.
	code, data, _ = apiCall(t, s, http.MethodGet, "/localapi/v0/subs/override?id="+id, "")
	if code != http.StatusOK {
		t.Fatalf("expected 200 on override read, got %d: %s", code, data)
	}

	// Save a prepend rule; conflicts are rejected by the store, so this must
	// pass against the stored source.
	code, data, _ = apiCall(t, s, http.MethodPut, "/localapi/v0/subs/override",
		`{"id":"`+id+`","rulesPrepend":["DOMAIN-SUFFIX,example.com,DIRECT"]}`)
	if code != http.StatusOK {
		t.Fatalf("expected 200 on override save, got %d: %s", code, data)
	}
	code, data, _ = apiCall(t, s, http.MethodGet, "/localapi/v0/subs/override?id="+id, "")
	var override struct {
		RulesPrepend []string `json:"rulesPrepend"`
	}
	if err := json.Unmarshal(data, &override); err != nil {
		t.Fatal(err)
	}
	if len(override.RulesPrepend) != 1 || override.RulesPrepend[0] != "DOMAIN-SUFFIX,example.com,DIRECT" {
		t.Fatalf("override round-trip lost the rule, got %s", data)
	}

	// Global mixin: bypass LAN + one DNS override.
	code, data, _ = apiCall(t, s, http.MethodPut, "/localapi/v0/mixins/global",
		`{"bypassLan":true,"dns":"fake-ip"}`)
	if code != http.StatusOK {
		t.Fatalf("expected 200 on mixin save, got %d: %s", code, data)
	}
	code, data, _ = apiCall(t, s, http.MethodGet, "/localapi/v0/mixins/global", "")
	var mixin struct {
		BypassLan bool   `json:"bypassLan"`
		DNS       string `json:"dns"`
	}
	if err := json.Unmarshal(data, &mixin); err != nil {
		t.Fatal(err)
	}
	if !mixin.BypassLan || mixin.DNS != "fake-ip" {
		t.Fatalf("mixin round-trip lost fields, got %s", data)
	}
}

// The controller reads honestly report a stopped core instead of pretending
// to serve data.
func TestAPIRulesPageAndConnectionsDeleteWithoutEngine(t *testing.T) {
	_, s := newTestAPIServer(t)

	code, _, _ := apiCall(t, s, http.MethodGet, "/localapi/v0/rules/page?q=github", "")
	if code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 from rules/page while engine is stopped, got %d", code)
	}
	code, _, _ = apiCall(t, s, http.MethodDelete, "/localapi/v0/connections?id=all", "")
	if code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 from connections DELETE while engine is stopped, got %d", code)
	}
}

// The mobile runtime must bake the override and mixin layers into the source
// before derivation — the daemon parity this file's routes edit on the phone.
func TestLayeredSourceAppliesOverrideAndMixin(t *testing.T) {
	svc, _ := newTestAPIServer(t)
	rt := svc.runtime

	meta, err := svc.subMgr.AddUniversalContent(sampleClashConfig, "layers-test", 24, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.subMgr.SetOverride(meta.ID, &engine.SubscriptionOverride{
		RulesPrepend: []string{"DOMAIN-SUFFIX,example.com,DIRECT"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.subMgr.SetGlobalMixin(&engine.GlobalMixin{
		BypassLAN: true,
		DNS:       "enhanced-mode: fake-ip",
	}); err != nil {
		t.Fatal(err)
	}

	id, source, err := rt.activeSource()
	if err != nil {
		t.Fatal(err)
	}
	if id != meta.ID {
		t.Fatalf("expected active sub %q, got %q", meta.ID, id)
	}
	merged := string(source)
	if !strings.Contains(merged, "DOMAIN-SUFFIX,example.com,DIRECT") {
		t.Errorf("override rule missing from layered source:\n%s", merged)
	}
	if !strings.Contains(merged, "IP-CIDR,127.0.0.0/8,DIRECT") {
		t.Errorf("mixin LAN bypass rules missing from layered source:\n%s", merged)
	}
	if !strings.Contains(merged, "enhanced-mode: fake-ip") {
		t.Errorf("mixin DNS missing from layered source:\n%s", merged)
	}
}

// The Android deep-link landing: the Activity delivers {code, state} and the
// pending scheme login accepts only the state it opened the browser with.
func TestAPIAccountCallbackScheme(t *testing.T) {
	svc, s := newTestAPIServer(t)
	account := svc.account

	// Simulate a pending scheme login (same-package test; the real flow
	// reaches this state through login() + the OAuth authorize round trip).
	account.mu.Lock()
	account.state.Status = "pending"
	account.state.Method = "scheme"
	account.codeCh = make(chan string, 1)
	account.mu.Unlock()
	delivered := make(chan string, 1)
	go func() {
		code, err := account.waitSchemeCode(context.Background(), "state-abc")
		if err != nil {
			t.Errorf("waitSchemeCode failed: %v", err)
			delivered <- ""
			return
		}
		delivered <- code
	}()
	// The HTTP calls must not race the flow's own state registration.
	deadline := time.Now().Add(2 * time.Second)
	for {
		account.mu.Lock()
		registered := account.schemeState == "state-abc"
		account.mu.Unlock()
		if registered {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("waitSchemeCode never registered its state")
		}
		time.Sleep(5 * time.Millisecond)
	}

	// A stale or forged state is refused, not guessed.
	code, data, _ := apiCall(t, s, http.MethodPost, "/localapi/v0/account/callback",
		`{"code":"auth-code","state":"forged"}`)
	if code != http.StatusBadRequest {
		t.Fatalf("expected 400 for state mismatch, got %d: %s", code, data)
	}

	// The matching state delivers the code into the pending flow.
	code, data, _ = apiCall(t, s, http.MethodPost, "/localapi/v0/account/callback",
		`{"code":"auth-code","state":"state-abc"}`)
	if code != http.StatusOK {
		t.Fatalf("expected 200 for matching state, got %d: %s", code, data)
	}
	select {
	case got := <-delivered:
		if got != "auth-code" {
			t.Fatalf("expected the delivered code, got %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("code was not delivered to the pending flow")
	}
}

// 本機任何應用都能連到 loopback 端口：/../.. 之類的路徑絕不能把 web 目錄外
// 的 app 私有文件（localapi.token 等）當靜態資源送出去。ServeMux 會把未規
// 範化路徑重定向，這裡固定整條鏈路的可觀測行為：回應裡不得出現文件內容。
func TestWebBlocksPathTraversal(t *testing.T) {
	_, s := newTestAPIServer(t)

	secret := "secret-token-content"
	tokenPath := filepath.Join(paths.DataDir(), "localapi.token")
	if err := os.WriteFile(tokenPath, []byte(secret), 0o600); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{"/../localapi.token", "/%2e%2e/localapi.token", "/..%2flocalapi.token"} {
		req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d%s", s.port, path), nil)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		req.Header.Set("X-XBond-Token", s.token)
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if strings.Contains(string(body), secret) {
			t.Fatalf("%s: traversal leaked the token file", path)
		}
	}
}
