package engine

import "testing"

// InspectConfig is the delegated-TUN port source: the delegator addresses
// the machine session's clash API from these values, so both core formats
// must extract the same run-shape the manager records on start.
func TestInspectConfigReportsRunShapeForBothCores(t *testing.T) {
	clashYAML := []byte(`mixed-port: 17890
external-controller: 127.0.0.1:19090
secret: inspect-secret
tun:
  enable: true
  stack: mixed
  auto-route: true
mode: rule
proxies:
  - name: p
    type: trojan
    server: example.invalid
    port: 443
    password: x
`)
	meta, err := InspectConfig(clashYAML)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Core != FormatClash || meta.TakeoverMode != ModeTun || meta.RoutingMode != RoutingRule {
		t.Fatalf("clash metadata drifted: %+v", meta)
	}
	if meta.MixedPort != 17890 || meta.ClashPort != 19090 || meta.ClashSecret != "inspect-secret" {
		t.Fatalf("clash listeners drifted: %+v", meta)
	}
	if meta.AllowLan {
		t.Fatal("loopback-only config reported allow-lan")
	}

	singBoxJSON := []byte(`{"outbounds":[{"type":"direct","tag":"direct"}],"inbounds":[{"type":"tun","tag":"tun-in"},{"type":"mixed","listen":"0.0.0.0","listen_port":17891}],"experimental":{"clash_api":{"external_controller":"127.0.0.1:19091","secret":"sb-secret","default_mode":"global"}}}`)
	meta, err = InspectConfig(singBoxJSON)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Core != FormatSingBox || meta.TakeoverMode != ModeTun || meta.RoutingMode != RoutingGlobal {
		t.Fatalf("sing-box metadata drifted: %+v", meta)
	}
	if meta.MixedPort != 17891 || meta.ClashPort != 19091 || meta.ClashSecret != "sb-secret" || !meta.AllowLan {
		t.Fatalf("sing-box listeners drifted: %+v", meta)
	}

	if _, err := InspectConfig([]byte("not: [a: config")); err == nil {
		t.Fatal("garbage passed inspection")
	}
}
