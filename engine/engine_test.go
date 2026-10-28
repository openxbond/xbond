package engine

import (
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"
)

func sampleValidConfig() []byte {
	return []byte(`{
  "outbounds": [
    {
      "type": "direct",
      "tag": "direct"
    },
    {
      "type": "block",
      "tag": "block"
    },
    {
      "type": "selector",
      "tag": "proxy-group",
      "outbounds": ["direct", "block"]
    }
  ]
}`)
}

func getFreePort(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen on free port: %v", err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func TestValidate(t *testing.T) {
	if err := Validate(sampleValidConfig()); err != nil {
		t.Fatalf("expected valid config to pass validation, got: %v", err)
	}

	invalidConfig := []byte(`{"outbounds": []}`)
	if err := Validate(invalidConfig); err == nil {
		t.Fatalf("expected empty outbounds config to fail validation")
	}

	badJSON := []byte(`{not valid json}`)
	if err := Validate(badJSON); err == nil {
		t.Fatalf("expected malformed json to fail validation")
	}
}

func TestDeriveRuntimeConfig(t *testing.T) {
	source := []byte(`{
  "inbounds": [
    {
      "type": "tun",
      "tag": "old-tun"
    }
  ],
  "outbounds": [
    {
      "type": "direct",
      "tag": "direct"
    }
  ]
}`)

	// 1. Sysproxy mode
	derivedSysproxy, err := DeriveRuntimeConfig(source, ModeSysproxy, RoutingRule, 17890, false, 19090, "secret123")
	if err != nil {
		t.Fatalf("failed to derive sysproxy config: %v", err)
	}

	var rawSysproxy struct {
		Inbounds []struct {
			Type       string `json:"type"`
			Listen     string `json:"listen"`
			ListenPort int    `json:"listen_port"`
		} `json:"inbounds"`
		Experimental struct {
			ClashAPI struct {
				ExternalController string `json:"external_controller"`
				Secret             string `json:"secret"`
				DefaultMode        string `json:"default_mode"`
			} `json:"clash_api"`
		} `json:"experimental"`
	}
	if err := json.Unmarshal(derivedSysproxy, &rawSysproxy); err != nil {
		t.Fatalf("failed to unmarshal derived sysproxy: %v", err)
	}

	for _, in := range rawSysproxy.Inbounds {
		if in.Type == "tun" {
			t.Fatalf("tun inbound should be stripped in sysproxy mode")
		}
	}
	var foundMixed bool
	for _, in := range rawSysproxy.Inbounds {
		if in.Type == "mixed" {
			foundMixed = true
			if in.ListenPort != 17890 {
				t.Errorf("expected mixedPort 17890, got %d", in.ListenPort)
			}
			if in.Listen != "127.0.0.1" {
				t.Errorf("expected listen 127.0.0.1, got %s", in.Listen)
			}
		}
	}
	if !foundMixed {
		t.Errorf("expected mixed inbound to be injected")
	}
	if rawSysproxy.Experimental.ClashAPI.ExternalController != "127.0.0.1:19090" {
		t.Errorf("unexpected clash controller: %s", rawSysproxy.Experimental.ClashAPI.ExternalController)
	}
	if rawSysproxy.Experimental.ClashAPI.Secret != "secret123" {
		t.Errorf("unexpected clash secret: %s", rawSysproxy.Experimental.ClashAPI.Secret)
	}

	// 2. Tun mode
	derivedTun, err := DeriveRuntimeConfig(source, ModeTun, RoutingGlobal, 17891, true, 19091, "secret456")
	if err != nil {
		t.Fatalf("failed to derive tun config: %v", err)
	}
	var rawTun struct {
		Inbounds []struct {
			Type   string `json:"type"`
			Listen string `json:"listen"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(derivedTun, &rawTun); err != nil {
		t.Fatalf("failed to unmarshal derived tun: %v", err)
	}
	var foundTun bool
	for _, in := range rawTun.Inbounds {
		if in.Type == "tun" {
			foundTun = true
		}
		if in.Type == "mixed" && in.Listen != "0.0.0.0" {
			t.Errorf("expected allowLan 0.0.0.0, got %s", in.Listen)
		}
	}
	if !foundTun {
		t.Errorf("expected tun inbound to be preserved/injected in tun mode")
	}
}

func TestManagerLifecycleAndClashClient(t *testing.T) {
	mixedPort := getFreePort(t)
	clashPort := getFreePort(t)
	secret := GenerateSecret()

	runtimeJSON, err := DeriveRuntimeConfig(sampleValidConfig(), ModePort, RoutingRule, mixedPort, false, clashPort, secret)
	if err != nil {
		t.Fatalf("failed to derive config: %v", err)
	}

	mgr := NewManager(100)
	if mgr.IsRunning() {
		t.Fatalf("manager should not be running initially")
	}

	if err := mgr.Start(runtimeJSON); err != nil {
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
	source := []byte(`{
  "outbounds": [
    {
      "type": "direct",
      "tag": "direct"
    }
  ]
}`)

	// Invalid tunFd should fail
	if _, err := DeriveMobileRuntimeConfig(source, 0, RoutingRule, 19090, "secret"); err == nil {
		t.Fatalf("expected error for tunFd <= 0")
	}

	// Valid tunFd
	derived, err := DeriveMobileRuntimeConfig(source, 42, RoutingRule, 19090, "secret")
	if err != nil {
		t.Fatalf("failed to derive mobile config: %v", err)
	}

	var parsed struct {
		Inbounds []struct {
			Type           string `json:"type"`
			FileDescriptor int32  `json:"file_descriptor"`
			AutoRoute      bool   `json:"auto_route"`
			StrictRoute    bool   `json:"strict_route"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(derived, &parsed); err != nil {
		t.Fatalf("failed to unmarshal derived: %v", err)
	}

	if len(parsed.Inbounds) == 0 {
		t.Fatalf("expected at least 1 inbound")
	}
	tun := parsed.Inbounds[0]
	if tun.Type != "tun" {
		t.Errorf("expected inbound type tun, got %s", tun.Type)
	}
	if tun.FileDescriptor != 42 {
		t.Errorf("expected file_descriptor 42, got %d", tun.FileDescriptor)
	}
	if tun.AutoRoute {
		t.Errorf("auto_route must be false in mobile config")
	}
	if tun.StrictRoute {
		t.Errorf("strict_route must be false in mobile config")
	}
}
