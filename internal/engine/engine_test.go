package engine

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

// sampleValidConfig is the canonical test subscription: a runnable Clash YAML
// with two trojan nodes (loopback, never dialed by these tests) and one
// selector group. The names match the scenarios in reload_test.go.
func sampleValidConfig() []byte {
	return []byte(`port: 12345
proxies:
  - name: block
    type: trojan
    server: 127.0.0.1
    port: 443
    password: fixture-only
  - name: direct
    type: trojan
    server: 127.0.0.1
    port: 443
    password: fixture-only
proxy-groups:
  - name: proxy-group
    type: select
    proxies:
      - block
      - direct
rules:
  - MATCH,proxy-group
`)
}

func getFreePort(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen on free port: %v", err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// isolateCoreHome points the core's cache.db/geodata home at a scratch dir so
// tests never touch the real user data directory. Cleanup is best effort:
// mihomo's cache.db singleton stays open after Stop and Windows refuses to
// delete an open file.
func isolateCoreHome(t *testing.T) {
	t.Helper()
	dir := filepath.Join(os.TempDir(), fmt.Sprintf("xbond-core-test-%d", time.Now().UnixNano()))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatalf("create core home: %v", err)
	}
	t.Setenv("XBOND_DATA_DIR", dir)
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
}

func decodeYAML(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var raw map[string]any
	if err := yaml.Unmarshal(data, &raw); err != nil {
		t.Fatalf("failed to unmarshal YAML: %v", err)
	}
	return raw
}

func TestValidate(t *testing.T) {
	isolateCoreHome(t)
	if err := Validate(sampleValidConfig()); err != nil {
		t.Fatalf("expected valid config to pass validation, got: %v", err)
	}

	noProxies := []byte("rules:\n  - MATCH,DIRECT\n")
	if err := Validate(noProxies); err == nil {
		t.Fatalf("expected config without proxies to fail validation")
	}

	badYAML := []byte("{not valid yaml")
	if err := Validate(badYAML); err == nil {
		t.Fatalf("expected malformed yaml to fail validation")
	}
}

func TestDeriveRuntimeConfig(t *testing.T) {
	isolateCoreHome(t)

	// 1. Sysproxy mode: the source's tun and legacy port keys never survive.
	derivedSysproxy, err := DeriveRuntimeConfig(sampleValidConfig(), ModeSysproxy, RoutingRule, 17890, false, 19090, "secret123")
	if err != nil {
		t.Fatalf("failed to derive sysproxy config: %v", err)
	}
	rawSysproxy := decodeYAML(t, derivedSysproxy)

	if rawSysproxy["port"] != nil {
		t.Errorf("legacy port key should be dropped, got %v", rawSysproxy["port"])
	}
	if rawSysproxy["mixed-port"] != 17890 {
		t.Errorf("expected mixed-port 17890, got %v", rawSysproxy["mixed-port"])
	}
	tun, _ := rawSysproxy["tun"].(map[string]any)
	if len(tun) == 0 || tun["enable"] != false {
		t.Errorf("expected tun to be disabled in sysproxy mode, got %v", rawSysproxy["tun"])
	}
	if rawSysproxy["allow-lan"] != false || rawSysproxy["bind-address"] != "127.0.0.1" {
		t.Errorf("unexpected lan binding: %v / %v", rawSysproxy["allow-lan"], rawSysproxy["bind-address"])
	}
	if rawSysproxy["external-controller"] != "127.0.0.1:19090" {
		t.Errorf("unexpected controller: %v", rawSysproxy["external-controller"])
	}
	if rawSysproxy["secret"] != "secret123" {
		t.Errorf("unexpected secret: %v", rawSysproxy["secret"])
	}
	if rawSysproxy["mode"] != "rule" {
		t.Errorf("unexpected mode: %v", rawSysproxy["mode"])
	}
	profile, _ := rawSysproxy["profile"].(map[string]any)
	if profile == nil || profile["store-selected"] != true {
		t.Errorf("expected profile.store-selected, got %v", rawSysproxy["profile"])
	}
	proxies, _ := rawSysproxy["proxies"].([]any)
	if len(proxies) != 2 {
		t.Errorf("expected subscription proxies preserved, got %d", len(proxies))
	}

	// 2. Tun mode: takeover enabled with sane DNS defaults.
	derivedTun, err := DeriveRuntimeConfig(sampleValidConfig(), ModeTun, RoutingGlobal, 17891, true, 19091, "secret456")
	if err != nil {
		t.Fatalf("failed to derive tun config: %v", err)
	}
	rawTun := decodeYAML(t, derivedTun)
	tunMap, _ := rawTun["tun"].(map[string]any)
	if tunMap == nil || tunMap["enable"] != true {
		t.Fatalf("expected tun enabled, got %v", rawTun["tun"])
	}
	if tunMap["auto-route"] != true || tunMap["strict-route"] != true || tunMap["stack"] != "mixed" {
		t.Errorf("unexpected tun options: %v", tunMap)
	}
	if rawTun["mode"] != "global" || rawTun["bind-address"] != "*" {
		t.Errorf("unexpected general: mode=%v bind=%v", rawTun["mode"], rawTun["bind-address"])
	}
	dns, _ := rawTun["dns"].(map[string]any)
	if dns == nil || dns["enable"] != true {
		t.Errorf("expected dns enabled in tun mode, got %v", rawTun["dns"])
	}
	if nameservers, _ := dns["nameserver"].([]any); len(nameservers) == 0 {
		t.Errorf("expected default nameservers in tun mode, got %v", dns)
	}

	// 3. The derived config passes the core's own validation gate.
	if err := Validate(derivedSysproxy); err != nil {
		t.Errorf("derived sysproxy config failed validation: %v", err)
	}
	if err := Validate(derivedTun); err != nil {
		t.Errorf("derived tun config failed validation: %v", err)
	}
}

func TestManagerLifecycleAndClashClient(t *testing.T) {
	isolateCoreHome(t)
	mixedPort := getFreePort(t)
	clashPort := getFreePort(t)
	secret := GenerateSecret()

	runtimeYAML, err := DeriveRuntimeConfig(sampleValidConfig(), ModePort, RoutingRule, mixedPort, false, clashPort, secret)
	if err != nil {
		t.Fatalf("failed to derive config: %v", err)
	}

	mgr := NewManager(100)
	if mgr.IsRunning() {
		t.Fatalf("manager should not be running initially")
	}

	if err := mgr.Start(runtimeYAML); err != nil {
		t.Fatalf("failed to start manager: %v", err)
	}

	if !mgr.IsRunning() {
		t.Fatalf("manager should be running after start")
	}

	status := mgr.Status()
	if status.MixedPort != mixedPort || status.ClashPort != clashPort {
		t.Errorf("status ports mismatch: mixed=%d, clash=%d", status.MixedPort, status.ClashPort)
	}

	// Query Clash API
	client := mgr.Client()
	if client == nil {
		t.Fatalf("clash client is nil")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	proxies, err := client.GetProxies(ctx)
	if err != nil {
		t.Fatalf("failed to get proxies from clash api: %v", err)
	}

	group, exists := proxies["proxy-group"]
	if !exists {
		t.Fatalf("expected proxy-group to exist in proxies: %v", proxies)
	}
	if len(group.All) != 2 {
		t.Errorf("expected 2 outbounds in group, got %d", len(group.All))
	}

	// Select a node
	if err := client.SelectNode(ctx, "proxy-group", "block"); err != nil {
		t.Fatalf("failed to select node: %v", err)
	}

	// Verify selection
	proxiesAfter, err := client.GetProxies(ctx)
	if err != nil {
		t.Fatalf("failed to get proxies after select: %v", err)
	}
	if proxiesAfter["proxy-group"].Now != "block" {
		t.Errorf("expected now to be block, got %s", proxiesAfter["proxy-group"].Now)
	}

	// Test ring log
	logs := mgr.RingLog().Snapshot(LogLevelInfo, 10)
	if len(logs) == 0 {
		t.Errorf("expected ring logger to have entries")
	}

	// Graceful stop
	if err := mgr.Stop(); err != nil {
		t.Fatalf("failed to stop manager: %v", err)
	}
	if mgr.IsRunning() {
		t.Fatalf("manager should not be running after stop")
	}
}

func TestDeriveMobileRuntimeConfig(t *testing.T) {
	source := sampleValidConfig()

	// Invalid tunFd should fail
	if _, err := DeriveMobileRuntimeConfig(source, 0, RoutingRule, 19090, "secret"); err == nil {
		t.Fatalf("expected error for tunFd <= 0")
	}

	// Valid tunFd
	derived, err := DeriveMobileRuntimeConfig(source, 42, RoutingRule, 19090, "secret")
	if err != nil {
		t.Fatalf("failed to derive mobile config: %v", err)
	}

	raw := decodeYAML(t, derived)
	tun, _ := raw["tun"].(map[string]any)
	if tun == nil {
		t.Fatalf("expected tun in mobile config, got %v", raw["tun"])
	}
	if tun["file-descriptor"] != 42 {
		t.Errorf("expected file-descriptor 42, got %v", tun["file-descriptor"])
	}
	if tun["auto-route"] != false || tun["strict-route"] != false {
		t.Errorf("routing must stay platform-owned on mobile: %v", tun)
	}
	if raw["mixed-port"] != 0 {
		t.Errorf("expected no local proxy listener on mobile, got mixed-port %v", raw["mixed-port"])
	}
	if raw["external-controller"] != "127.0.0.1:19090" {
		t.Errorf("expected loopback controller, got %v", raw["external-controller"])
	}
}
