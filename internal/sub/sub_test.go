package sub

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"
)

func TestFormatDetection(t *testing.T) {
	// 1. sing-box JSON
	validSingBox := []byte(`{"outbounds": [{"type": "direct", "tag": "direct"}]}`)
	converted, _, err := DetectAndConvert(validSingBox)
	if err != nil {
		t.Fatalf("expected sing-box json to pass, got: %v", err)
	}
	if string(converted) != string(validSingBox) {
		t.Errorf("expected verbatim sing-box json")
	}

	// 2. Clash YAML
	clashYaml := []byte(`# subscription-userinfo: upload=100; download=200; total=1000; expire=1800000000
proxies:
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
`)
	convertedYAML, quota, err := DetectAndConvert(clashYaml)
	if err != nil {
		t.Fatalf("expected clash yaml to convert, got: %v", err)
	}
	if quota == nil || quota.TotalBytes != 1000 {
		t.Errorf("expected quota to be parsed from yaml comment, got: %+v", quota)
	}

	var parsedYAML struct {
		Outbounds []struct {
			Tag  string `json:"tag"`
			Type string `json:"type"`
		} `json:"outbounds"`
	}
	if err := json.Unmarshal(convertedYAML, &parsedYAML); err != nil {
		t.Fatalf("failed to parse converted yaml: %v", err)
	}
	if len(parsedYAML.Outbounds) < 3 {
		t.Errorf("expected at least 3 outbounds (hk-01, direct, block, proxy), got %d", len(parsedYAML.Outbounds))
	}

	// 3. Base64 trojan link
	link := "trojan://password123@hk.node.com:443?sni=hk.node.com#HongKong-01\n"
	b64 := base64.StdEncoding.EncodeToString([]byte(link))
	convertedB64, _, err := DetectAndConvert([]byte(b64))
	if err != nil {
		t.Fatalf("expected base64 link to convert, got: %v", err)
	}
	var parsedB64 struct {
		Outbounds []struct {
			Tag string `json:"tag"`
		} `json:"outbounds"`
	}
	if err := json.Unmarshal(convertedB64, &parsedB64); err != nil {
		t.Fatalf("failed to parse converted base64: %v", err)
	}
	if len(parsedB64.Outbounds) == 0 {
		t.Fatalf("expected outbounds from base64")
	}
}

func TestComputeUpdateDiff(t *testing.T) {
	oldSource := []byte(`{
  "outbounds": [
    {"type": "direct", "tag": "direct"},
    {"type": "block", "tag": "block"},
    {"type": "trojan", "tag": "HK-01"},
    {"type": "trojan", "tag": "US-01"},
    {"type": "selector", "tag": "Proxy"}
  ]
}`)

	newSource := []byte(`{
  "outbounds": [
    {"type": "direct", "tag": "direct"},
    {"type": "block", "tag": "block"},
    {"type": "trojan", "tag": "HK-01"},
    {"type": "trojan", "tag": "SG-01"},
    {"type": "selector", "tag": "Proxy"},
    {"type": "selector", "tag": "AI"}
  ]
}`)

	diff, err := ComputeUpdateDiff(oldSource, newSource)
	if err != nil {
		t.Fatalf("ComputeUpdateDiff failed: %v", err)
	}

	if len(diff.AddedNodes) != 1 || diff.AddedNodes[0] != "SG-01" {
		t.Errorf("expected SG-01 added, got: %v", diff.AddedNodes)
	}
	if len(diff.RemovedNodes) != 1 || diff.RemovedNodes[0] != "US-01" {
		t.Errorf("expected US-01 removed, got: %v", diff.RemovedNodes)
	}
	if len(diff.AddedGroups) != 1 || diff.AddedGroups[0] != "AI" {
		t.Errorf("expected AI group added, got: %v", diff.AddedGroups)
	}
	if !diff.ReloadRequired {
		t.Errorf("expected reloadRequired to be true")
	}
}

func TestNextScheduledTick(t *testing.T) {
	loc := time.Local

	// 1. 03:59:00 -> 1 minute until 04:00
	t1 := time.Date(2026, 10, 27, 3, 59, 0, 0, loc)
	tick1 := NextScheduledTick(t1, 24*time.Hour)
	if tick1 != 1*time.Minute {
		t.Errorf("expected 1m at 03:59, got %v", tick1)
	}

	// 2. 04:00:00 -> 24 hours until next 04:00
	t2 := time.Date(2026, 10, 27, 4, 0, 0, 0, loc)
	tick2 := NextScheduledTick(t2, 24*time.Hour)
	if tick2 != 24*time.Hour {
		t.Errorf("expected 24h at 04:00, got %v", tick2)
	}

	// 3. 04:01:00 -> 23h59m
	t3 := time.Date(2026, 10, 27, 4, 1, 0, 0, loc)
	tick3 := NextScheduledTick(t3, 24*time.Hour)
	if tick3 != 23*time.Hour+59*time.Minute {
		t.Errorf("expected 23h59m at 04:01, got %v", tick3)
	}
}

func TestBuildXBondURLNormalizesRenderLang(t *testing.T) {
	cases := map[string]string{
		"":      "zh-HK",
		"zh-HK": "zh-HK",
		"zh-CN": "zh",
		"zh_CN": "zh",
		"en-US": "en",
		"en_US": "en",
		"ko":    "ko",
		"fa":    "fa",
		"fr":    "zh-HK",
	}
	for input, want := range cases {
		raw := BuildXBondURL("https://example.com", "sub-test", "vless-reality", input)
		parsed, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("BuildXBondURL(%q) produced invalid URL: %v", input, err)
		}
		if got := parsed.Query().Get("lang"); got != want {
			t.Errorf("lang %q normalized to %q, want %q", input, got, want)
		}
	}
}

func TestSubscriptionLifecycleAndErrors(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "xbond-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)
	t.Setenv("XBOND_DATA_DIR", tempDir)

	validJSON := `{
  "outbounds": [
    {"type": "direct", "tag": "direct"},
    {"type": "block", "tag": "block"}
  ]
}`

	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++

		if r.URL.Path == "/api/subscription/health" {
			nonce := r.URL.Query().Get("nonce")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "nonce": nonce})
			return
		}

		if r.URL.Path == "/api/subscription/config" {
			token := r.URL.Query().Get("token")
			if token == "sub-invalid" {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error": "invalid token"}`))
				return
			}
			if token == "sub-exhausted" {
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error": "Data quota exhausted"}`))
				return
			}

			if r.Header.Get("If-None-Match") == `"v1-etag"` {
				w.WriteHeader(http.StatusNotModified)
				w.Header().Set("Subscription-Userinfo", "upload=10; download=20; total=100; expire=1900000000")
				return
			}

			w.Header().Set("ETag", `"v1-etag"`)
			w.Header().Set("Subscription-Userinfo", "upload=10; download=20; total=100; expire=1900000000")
			w.Header().Set("Profile-Update-Interval", "12")
			w.Header().Set("Content-Disposition", `attachment; filename="XBond-Pro.json"`)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(validJSON))
			return
		}

		http.NotFound(w, r)
	}))
	defer server.Close()

	mgr, err := NewManager()
	if err != nil {
		t.Fatalf("NewManager failed: %v", err)
	}

	// 1. Add valid XBond subscription
	subMeta, err := mgr.AddXBond("sub-valid123456", server.URL, nil, "vless-reality", "zh-HK", "MySub", 24, true)
	if err != nil {
		t.Fatalf("AddXBond failed: %v", err)
	}
	if mgr.ActiveID() != subMeta.ID {
		t.Errorf("expected activeID %s, got %s", subMeta.ID, mgr.ActiveID())
	}

	// 2. Fetch update (200 OK)
	res, err := mgr.Update(subMeta.ID, false, false, 0)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if !res.ContentChanged {
		t.Errorf("expected contentChanged true on first fetch")
	}
	if res.Meta.Quota.TotalBytes != 100 {
		t.Errorf("expected quota total 100, got %d", res.Meta.Quota.TotalBytes)
	}
	if res.Meta.UpdateIntervalHours != 12 {
		t.Errorf("expected update interval 12, got %d", res.Meta.UpdateIntervalHours)
	}

	// 3. Update again with ETag -> 304 Not Modified
	res304, err := mgr.Update(subMeta.ID, false, false, 0)
	if err != nil {
		t.Fatalf("Update 304 failed: %v", err)
	}
	if !res304.StatusNotMod {
		t.Errorf("expected 304 StatusNotMod true, got false")
	}

	// 4. Test 401 Credential Invalid
	subInvalid, _ := mgr.AddXBond("sub-invalid", server.URL, nil, "vless-reality", "zh-HK", "InvalidSub", 24, false)
	_, err = mgr.Update(subInvalid.ID, false, false, 0)
	if err == nil {
		t.Fatalf("expected error on 401, got nil")
	}
	updatedInvalid, _ := mgr.Get(subInvalid.ID)
	if updatedInvalid.Health != HealthCredentialInvalid {
		t.Errorf("expected health credential_invalid, got: %s", updatedInvalid.Health)
	}

	// 5. Test 403 Quota Exhausted
	subExhausted, _ := mgr.AddXBond("sub-exhausted", server.URL, nil, "vless-reality", "zh-HK", "ExhaustedSub", 24, false)
	_, err = mgr.Update(subExhausted.ID, false, false, 0)
	if err == nil {
		t.Fatalf("expected error on 403, got nil")
	}
	updatedExhausted, _ := mgr.Get(subExhausted.ID)
	if updatedExhausted.Health != HealthQuotaExhausted {
		t.Errorf("expected health quota_exhausted, got: %s", updatedExhausted.Health)
	}

	// 6. Test gateway probe
	ok, err := ProbeGatewayHealth(context.Background(), server.URL, false, 0)
	if err != nil || !ok {
		t.Fatalf("ProbeGatewayHealth failed: ok=%v, err=%v", ok, err)
	}
}
