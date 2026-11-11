package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	C "github.com/metacubex/mihomo/constant"
	"gopkg.in/yaml.v3"
)

// sampleValidConfig is the canonical Clash subscription: a runnable mihomo
// YAML with two trojan nodes (loopback, never dialed by these tests) and one
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

// sampleSingBoxConfig is the canonical sing-box subscription for the
// sing-box core, with the same group/node naming as the Clash fixture.
func sampleSingBoxConfig() []byte {
	return []byte(`{
  "outbounds": [
    {"type": "direct", "tag": "direct"},
    {"type": "block", "tag": "block"},
    {"type": "trojan", "tag": "edge", "server": "127.0.0.1", "server_port": 443, "password": "fixture-only"},
    {"type": "selector", "tag": "proxy-group", "outbounds": ["direct", "block"]}
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

func decodeJSON(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}
	return raw
}

func TestDetectFormat(t *testing.T) {
	if format, err := DetectFormat(sampleValidConfig()); err != nil || format != FormatClash {
		t.Fatalf("expected clash format, got %q (%v)", format, err)
	}
	if format, err := DetectFormat(sampleSingBoxConfig()); err != nil || format != FormatSingBox {
		t.Fatalf("expected sing-box format, got %q (%v)", format, err)
	}
	if _, err := DetectFormat([]byte("")); err == nil {
		t.Fatal("empty content must fail")
	}
	if _, err := DetectFormat([]byte("garbage")); err == nil {
		t.Fatal("garbage must fail")
	}
}

// SourcePort reads the port a subscription requests for itself: the Clash
// `mixed-port` key or a sing-box mixed inbound. Legacy `port` and non-mixed
// inbounds never count.
func TestSourcePort(t *testing.T) {
	clashWithPort := append([]byte(nil), sampleValidConfig()...)
	clashWithPort = append(clashWithPort, []byte("mixed-port: 17897\n")...)
	if port, err := SourcePort(clashWithPort); err != nil || port != 17897 {
		t.Fatalf("expected mixed-port 17897, got %d (%v)", port, err)
	}
	if port, err := SourcePort(sampleValidConfig()); err != nil || port != 0 {
		t.Fatalf("expected no source port, got %d (%v)", port, err)
	}
	outOfRange := append([]byte(nil), sampleValidConfig()...)
	outOfRange = append(outOfRange, []byte("mixed-port: 70000\n")...)
	if _, err := SourcePort(outOfRange); err == nil {
		t.Fatal("out-of-range mixed-port must fail")
	}

	singBoxWithPort := []byte(`{
	  "outbounds": [
	    {"type": "direct", "tag": "direct"},
	    {"type": "trojan", "tag": "edge", "server": "127.0.0.1", "server_port": 443, "password": "fixture-only"}
	  ],
	  "inbounds": [{"type": "mixed", "tag": "mixed-in", "listen": "127.0.0.1", "listen_port": 17898}]
	}`)
	if port, err := SourcePort(singBoxWithPort); err != nil || port != 17898 {
		t.Fatalf("expected sing-box listen_port 17898, got %d (%v)", port, err)
	}
	if port, err := SourcePort(sampleSingBoxConfig()); err != nil || port != 0 {
		t.Fatalf("expected no sing-box source port, got %d (%v)", port, err)
	}
	if _, err := SourcePort([]byte("{")); err == nil {
		t.Fatal("garbage must fail")
	}
}

func TestValidate(t *testing.T) {
	isolateCoreHome(t)
	if err := Validate(sampleValidConfig()); err != nil {
		t.Fatalf("expected valid clash config to pass validation, got: %v", err)
	}
	if err := Validate(sampleSingBoxConfig()); err != nil {
		t.Fatalf("expected valid sing-box config to pass validation, got: %v", err)
	}

	noProxies := []byte("rules:\n  - MATCH,DIRECT\n")
	if err := Validate(noProxies); err == nil {
		t.Fatalf("expected clash config without proxies to fail validation")
	}
	noOutbounds := []byte(`{}`)
	if err := Validate(noOutbounds); err == nil {
		t.Fatalf("expected json without outbounds to fail validation")
	}
	badDocument := []byte("{not valid")
	if err := Validate(badDocument); err == nil {
		t.Fatalf("expected malformed document to fail validation")
	}
}

func TestValidateInitializesCoreHomeBeforeFirstStart(t *testing.T) {
	isolateCoreHome(t)
	dataDir := filepath.Join(os.Getenv("XBOND_DATA_DIR"), "fresh")
	t.Setenv("XBOND_DATA_DIR", dataDir)
	previousHome := C.Path.HomeDir()
	C.SetHomeDir(filepath.Join(dataDir, "uninitialized"))
	t.Cleanup(func() { C.SetHomeDir(previousHome) })
	if err := Validate(sampleValidConfig()); err != nil {
		t.Fatal(err)
	}
	if C.Path.HomeDir() != dataDir {
		t.Fatalf("validation used %q instead of the client data directory", C.Path.HomeDir())
	}
	if filepath.Clean(C.Path.MMDB()) != filepath.Join(dataDir, "geoip.metadb") {
		t.Fatalf("GeoIP path was not initialized: %q", C.Path.MMDB())
	}
}

func TestValidateWithDNSFallbackFilterGeoIP(t *testing.T) {
	isolateCoreHome(t)
	configYAML := []byte(`mixed-port: 7890
dns:
  enable: true
  nameserver:
    - 223.5.5.5
  fallback:
    - tls://1.1.1.1
  fallback-filter:
    geoip: true
    geoip-code: CN
    ipcidr:
      - 240.0.0.0/4
proxies:
  - name: test-node
    type: trojan
    server: 127.0.0.1
    port: 443
    password: test
rules:
  - MATCH,DIRECT
`)
	if err := Validate(configYAML); err != nil {
		t.Fatalf("validation with DNS fallback-filter geoip failed: %v", err)
	}
}

func TestDeriveRuntimeConfig(t *testing.T) {
	isolateCoreHome(t)

	// 1. Clash source, sysproxy mode: the source's tun and legacy port keys
	// never survive.
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
	if rawSysproxy["external-controller"] != "127.0.0.1:19090" {
		t.Errorf("unexpected controller: %v", rawSysproxy["external-controller"])
	}
	if rawSysproxy["secret"] != "secret123" {
		t.Errorf("unexpected secret: %v", rawSysproxy["secret"])
	}
	proxies, _ := rawSysproxy["proxies"].([]any)
	if len(proxies) != 2 {
		t.Errorf("expected subscription proxies preserved, got %d", len(proxies))
	}

	// 2. Clash source, tun mode: takeover enabled with sane DNS defaults.
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
	dns, _ := rawTun["dns"].(map[string]any)
	if dns == nil || dns["enable"] != true {
		t.Errorf("expected dns enabled in tun mode, got %v", rawTun["dns"])
	}

	// 3. sing-box source: inbounds are injected, clash_api wired.
	derivedSingBox, err := DeriveRuntimeConfig(sampleSingBoxConfig(), ModePort, RoutingRule, 17892, false, 19092, "secret789")
	if err != nil {
		t.Fatalf("failed to derive sing-box config: %v", err)
	}
	rawSingBox := decodeJSON(t, derivedSingBox)
	inbounds, _ := rawSingBox["inbounds"].([]any)
	var foundMixed bool
	for _, item := range inbounds {
		inbound, _ := item.(map[string]any)
		if inbound["type"] == "mixed" && inbound["listen_port"] == float64(17892) {
			foundMixed = true
		}
	}
	if !foundMixed {
		t.Errorf("expected mixed inbound injected, got %v", inbounds)
	}
	experimental, _ := rawSingBox["experimental"].(map[string]any)
	clashAPI, _ := experimental["clash_api"].(map[string]any)
	if clashAPI == nil || clashAPI["external_controller"] != "127.0.0.1:19092" || clashAPI["secret"] != "secret789" {
		t.Errorf("unexpected clash_api: %v", clashAPI)
	}
	outbounds, _ := rawSingBox["outbounds"].([]any)
	if len(outbounds) != 4 {
		t.Errorf("expected subscription outbounds preserved, got %d", len(outbounds))
	}

	// 4. Both derived configs pass their core's validation gate.
	if err := Validate(derivedSysproxy); err != nil {
		t.Errorf("derived clash config failed validation: %v", err)
	}
	if err := Validate(derivedTun); err != nil {
		t.Errorf("derived clash tun config failed validation: %v", err)
	}
	if err := Validate(derivedSingBox); err != nil {
		t.Errorf("derived sing-box config failed validation: %v", err)
	}
}

// TestManagerLifecycleAndClashClient starts each core once on the same
// manager: the Clash API surface must answer for both, and the status must
// report which core is running. Fresh ports per run — Windows releases a
// closed listener's port with a short delay, and the point here is the
// per-core lifecycle, not port reuse timing.
func TestManagerLifecycleAndClashClient(t *testing.T) {
	isolateCoreHome(t)
	secret := GenerateSecret()

	mgr := NewManager(100)
	if mgr.IsRunning() {
		t.Fatalf("manager should not be running initially")
	}

	runCore := func(name string, config []byte, wantCore CoreFormat) {
		t.Helper()
		mixedPort, clashPort := getFreePort(t), getFreePort(t)
		runtimeConfig, err := DeriveRuntimeConfig(config, ModePort, RoutingRule, mixedPort, false, clashPort, secret)
		if err != nil {
			t.Fatalf("%s: failed to derive config: %v", name, err)
		}
		if err := mgr.Start(runtimeConfig); err != nil {
			t.Fatalf("%s: failed to start manager: %v", name, err)
		}
		if !mgr.IsRunning() {
			t.Fatalf("%s: manager should be running after start", name)
		}
		if status := mgr.Status(); status.Core != wantCore {
			t.Fatalf("%s: expected core %q, got %q", name, wantCore, status.Core)
		}

		client := mgr.Client()
		if client == nil {
			t.Fatalf("%s: clash client is nil", name)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		proxies, err := client.GetProxies(ctx)
		if err != nil {
			t.Fatalf("%s: failed to get proxies from clash api: %v", name, err)
		}
		group, exists := proxies["proxy-group"]
		if !exists {
			t.Fatalf("%s: expected proxy-group to exist in proxies: %v", name, proxies)
		}
		if len(group.All) != 2 {
			t.Errorf("%s: expected 2 outbounds in group, got %d", name, len(group.All))
		}
		if err := client.SelectNode(ctx, "proxy-group", "block"); err != nil {
			t.Fatalf("%s: failed to select node: %v", name, err)
		}
		proxiesAfter, err := client.GetProxies(ctx)
		if err != nil {
			t.Fatalf("%s: failed to get proxies after select: %v", name, err)
		}
		if proxiesAfter["proxy-group"].Now != "block" {
			t.Errorf("%s: expected now to be block, got %s", name, proxiesAfter["proxy-group"].Now)
		}
		controllerRules, err := client.GetRules(ctx)
		if err != nil {
			t.Fatalf("%s: read controller rules: %v", name, err)
		}
		page, ok := mgr.RulesPage(RuleQuery{Limit: 50})
		if !ok || page.Total != len(controllerRules) || len(page.Rules) != min(len(controllerRules), 50) {
			t.Fatalf("%s: unexpected rule page %+v for %d controller rules", name, page, len(controllerRules))
		}
		for index, rule := range page.Rules {
			if rule.Index != index+1 || rule.RuleItem != controllerRules[index] {
				t.Fatalf("%s: rule %d differs from the controller response", name, index)
			}
		}
		if logs := mgr.RingLog().Snapshot(LogLevelInfo, 10); len(logs) == 0 {
			t.Errorf("%s: expected ring logger to have entries", name)
		}
		if err := mgr.Stop(); err != nil {
			t.Fatalf("%s: failed to stop manager: %v", name, err)
		}
		if mgr.IsRunning() {
			t.Fatalf("%s: manager should not be running after stop", name)
		}
	}

	runCore("mihomo", sampleValidConfig(), FormatClash)
	runCore("sing-box", sampleSingBoxConfig(), FormatSingBox)
}

func TestDeriveMobileRuntimeConfig(t *testing.T) {
	isolateCoreHome(t)

	// Invalid tunFd should fail for either format.
	if _, err := DeriveMobileRuntimeConfig(sampleValidConfig(), 0, RoutingRule, 19090, "secret"); err == nil {
		t.Fatalf("expected error for tunFd <= 0")
	}

	// Clash source.
	derived, err := DeriveMobileRuntimeConfig(sampleValidConfig(), 42, RoutingRule, 19090, "secret")
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
	// auto-detect-interface keeps mihomo from creating a sing-tun
	// NetworkUpdateMonitor: on Android its netlink socket is SELinux-banned
	// for untrusted_app and the monitor failure kills the whole TUN listener
	// (the core would silently run mixed-only behind a live VPN interface).
	if tun["auto-detect-interface"] != false {
		t.Errorf("interface detection must stay off on mobile (netlink banned): %v", tun)
	}
	// gvisor: the mixed stack's system path drops TCP on Android fd-adopted
	// tunnels (packets arrive, the handshake never completes). CMFA defaults
	// to gvisor for the same reason.
	if tun["stack"] != "gvisor" {
		t.Errorf("expected gvisor stack on mobile (mixed drops TCP over fd): %v", tun["stack"])
	}
	if raw["mixed-port"] != 0 {
		t.Errorf("expected no local proxy listener on mobile, got mixed-port %v", raw["mixed-port"])
	}
	if raw["external-controller"] != "127.0.0.1:19090" {
		t.Errorf("expected loopback controller, got %v", raw["external-controller"])
	}

	// sing-box source.
	derivedSingBox, err := DeriveMobileRuntimeConfig(sampleSingBoxConfig(), 43, RoutingRule, 19091, "secret")
	if err != nil {
		t.Fatalf("failed to derive sing-box mobile config: %v", err)
	}
	rawSingBox := decodeJSON(t, derivedSingBox)
	inbounds, _ := rawSingBox["inbounds"].([]any)
	if len(inbounds) == 0 {
		t.Fatalf("expected tun inbound")
	}
	tunInbound, _ := inbounds[0].(map[string]any)
	if tunInbound["type"] != "tun" {
		t.Fatalf("expected sing-box tun inbound, got %v", tunInbound)
	}
	// v1.13 strict parsing rejects file_descriptor: the fd rides
	// adapter.PlatformInterface.OpenInterface (TestMobileTunFDHook), never the config.
	if _, has := tunInbound["file_descriptor"]; has {
		t.Errorf("sing-box tun inbound must not carry file_descriptor: %v", tunInbound)
	}
	if tunInbound["auto_route"] != false {
		t.Errorf("routing must stay platform-owned on mobile: %v", tunInbound)
	}
}

// The sing-box TUN paths (mobile fd mode and desktop takeover) must inject
// the DNS module and the sniff/hijack route rules: hijacked port-53 queries
// have no server otherwise and every lookup dies inside the tunnel. Source
// content is preserved — own servers/rules stay, no duplicate rules.
func TestDeriveSingBoxTunDNSInjection(t *testing.T) {
	isolateCoreHome(t)

	t.Run("mobile injects dns and hijack rules", func(t *testing.T) {
		derived, err := DeriveMobileRuntimeConfig(sampleSingBoxConfig(), 43, RoutingRule, 19091, "secret")
		if err != nil {
			t.Fatalf("failed to derive sing-box mobile config: %v", err)
		}
		raw := decodeJSON(t, derived)

		dns, _ := raw["dns"].(map[string]any)
		if dns == nil {
			t.Fatalf("expected dns module injected, got %v", raw["dns"])
		}
		servers, _ := dns["servers"].([]any)
		if len(servers) != 1 {
			t.Fatalf("expected one fallback DNS server, got %v", servers)
		}
		server, _ := servers[0].(map[string]any)
		if server["type"] != "udp" || server["server"] != "8.8.8.8" {
			t.Errorf("unexpected fallback DNS server: %v", server)
		}
		if dns["final"] != "dns-fallback" {
			t.Errorf("expected final pointing at the injected server, got %v", dns["final"])
		}

		route, _ := raw["route"].(map[string]any)
		rules, _ := route["rules"].([]any)
		if len(rules) < 2 {
			t.Fatalf("expected sniff+hijack rules prepended, got %v", rules)
		}
		first, _ := rules[0].(map[string]any)
		second, _ := rules[1].(map[string]any)
		if first["action"] != "sniff" {
			t.Errorf("expected sniff rule first, got %v", first)
		}
		if second["action"] != "hijack-dns" {
			t.Errorf("expected hijack-dns rule second, got %v", second)
		}

		if err := Validate(derived); err != nil {
			t.Errorf("derived mobile config failed validation: %v", err)
		}
	})

	t.Run("source dns and rules are preserved without duplicates", func(t *testing.T) {
		source := []byte(`{
  "dns": {"servers": [{"type": "udp", "tag": "dns-own", "server": "1.1.1.1"}], "final": "dns-own"},
  "route": {"final": "direct", "rules": [
    {"action": "sniff"},
    {"outbound": "dns-out"},
    {"inbound": "dns-in", "outbound": "dns-out"},
    {"protocol": "dns", "action": "hijack-dns"}
  ]},
  "outbounds": [
    {"type": "direct", "tag": "direct"},
    {"type": "dns", "tag": "dns-out"},
    {"type": "trojan", "tag": "edge", "server": "127.0.0.1", "server_port": 443, "password": "fixture-only"}
  ]
}`)
		derived, err := DeriveMobileRuntimeConfig(source, 44, RoutingRule, 19092, "secret")
		if err != nil {
			t.Fatalf("failed to derive: %v", err)
		}
		raw := decodeJSON(t, derived)

		dns, _ := raw["dns"].(map[string]any)
		servers, _ := dns["servers"].([]any)
		if len(servers) != 1 || dns["final"] != "dns-own" {
			t.Errorf("own dns servers/final must be preserved: %v", dns)
		}
		route, _ := raw["route"].(map[string]any)
		rules, _ := route["rules"].([]any)
		if len(rules) != 4 {
			t.Fatalf("expected source rules untouched, got %v", rules)
		}
		if route["final"] != "direct" {
			t.Errorf("route final must stay source-owned, got %v", route["final"])
		}
	})

	t.Run("desktop tun takeover injects, port mode does not", func(t *testing.T) {
		derivedTun, err := DeriveRuntimeConfig(sampleSingBoxConfig(), ModeTun, RoutingRule, 17890, false, 19090, "secret")
		if err != nil {
			t.Fatalf("failed to derive desktop tun config: %v", err)
		}
		rawTun := decodeJSON(t, derivedTun)
		dnsTun, _ := rawTun["dns"].(map[string]any)
		if dnsTun == nil || dnsTun["servers"] == nil {
			t.Errorf("desktop tun derive must inject dns, got %v", rawTun["dns"])
		}
		routeTun, _ := rawTun["route"].(map[string]any)
		rulesTun, _ := routeTun["rules"].([]any)
		if len(rulesTun) < 2 {
			t.Errorf("desktop tun derive must prepend hijack rules, got %v", rulesTun)
		}
		if err := Validate(derivedTun); err != nil {
			t.Errorf("derived desktop tun config failed validation: %v", err)
		}

		derivedPort, err := DeriveRuntimeConfig(sampleSingBoxConfig(), ModePort, RoutingRule, 17891, false, 19091, "secret")
		if err != nil {
			t.Fatalf("failed to derive port-mode config: %v", err)
		}
		rawPort := decodeJSON(t, derivedPort)
		if _, has := rawPort["dns"]; has {
			t.Errorf("port mode must not inject a dns block, got %v", rawPort["dns"])
		}
		if _, has := rawPort["route"]; has {
			t.Errorf("port mode must not inject route rules, got %v", rawPort["route"])
		}
	})
}

// A mobile derivation (no mixed listener, platform-owned TUN fd) starts
// cleanly: the readiness probe must skip the listener check instead of
// probing the construction-default port forever. The fake fd means the TUN
// itself cannot carry traffic — core lifecycle is what's under test here.
func TestManagerMobileStartSkipsListenerProbe(t *testing.T) {
	isolateCoreHome(t)
	secret := GenerateSecret()
	clashPort := getFreePort(t)

	mgr := NewManager(100)
	derived, err := DeriveMobileRuntimeConfig(sampleValidConfig(), 4242, RoutingRule, clashPort, secret)
	if err != nil {
		t.Fatal(err)
	}
	if err := mgr.Start(derived); err != nil {
		t.Fatalf("mobile derivation failed to start: %v", err)
	}
	t.Cleanup(func() { _ = mgr.Stop() })

	status := mgr.Status()
	// Start must SUCCEED (probe skipped): the core runs over the platform
	// TUN even though this test's fd is fake — listener readiness is what
	// used to block mobile starts forever.
	if !status.Running {
		t.Fatalf("mobile start did not come up: %+v", status)
	}
	if status.MixedPort != 0 {
		t.Fatalf("mobile status must report no mixed listener, got %d", status.MixedPort)
	}
	if status.Core != FormatClash {
		t.Fatalf("unexpected core: %q", status.Core)
	}
}
