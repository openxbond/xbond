package sub

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
)

const clashNodeFixture = `proxies:
  - name: edge
    type: trojan
    server: example.invalid
    port: 443
    password: fixture-only
    sni: tls.example.invalid
    network: ws
    ws-opts:
      path: /socket
      headers:
        Host: ws.example.invalid
`

const singBoxFixture = `{
  "outbounds": [
    {"type": "direct", "tag": "direct"},
    {"type": "block", "tag": "block"},
    {"type": "trojan", "tag": "edge", "server": "example.invalid", "server_port": 443, "password": "fixture-only"},
    {"type": "selector", "tag": "Proxy", "outbounds": ["Auto", "edge", "direct"]},
    {"type": "urltest", "tag": "Auto", "outbounds": ["edge"], "url": "https://www.gstatic.com/generate_204", "interval": "3m"}
  ],
  "route": {"rules": [{"domain_suffix": [".example.invalid"], "outbound": "direct"}], "final": "Proxy"},
  "dns": {"servers": [{"tag": "local-udp", "address": "8.8.8.8"}]}
}`

func validateWithCore(t *testing.T, converted []byte) {
	t.Helper()
	if err := engine.Validate(converted); err != nil {
		t.Fatalf("config is not usable by its native core: %v", err)
	}
}

// Each format is native to its core and passes through untouched: Clash YAML
// (rules, DNS, TUN, fallback/load-balance groups, providers) to mihomo,
// sing-box JSON to sing-box. No subscription semantics are ever converted.
func TestFormatsPassThroughNatively(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())

	clashInput := "# subscription-userinfo: upload=1; download=2; total=10; expire=1800000000\n" + clashNodeFixture + `proxy-groups:
  - name: policy
    type: fallback
    proxies: [edge, DIRECT]
  - name: balance
    type: load-balance
    proxies: [edge]
rules:
  - DOMAIN-SUFFIX,example.invalid,DIRECT
  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
  - MATCH,policy
dns:
  enable: true
  nameserver: [8.8.8.8]
`
	converted, format, quota, err := DetectAndConvert([]byte(clashInput))
	if err != nil {
		t.Fatal(err)
	}
	if format != engine.FormatClash {
		t.Fatalf("expected clash format, got %q", format)
	}
	if string(converted) != strings.TrimSpace(clashInput) {
		t.Fatalf("Clash YAML must pass through verbatim:\n%s", converted)
	}
	if quota == nil || quota.TotalBytes != 10 {
		t.Fatalf("expected quota parsed from comment, got %+v", quota)
	}
	validateWithCore(t, converted)

	singboxConverted, format, quota, err := DetectAndConvert([]byte(singBoxFixture))
	if err != nil {
		t.Fatal(err)
	}
	if format != engine.FormatSingBox {
		t.Fatalf("expected sing-box format, got %q", format)
	}
	if string(singboxConverted) != strings.TrimSpace(singBoxFixture) {
		t.Fatalf("sing-box JSON must pass through verbatim:\n%s", singboxConverted)
	}
	validateWithCore(t, singboxConverted)
}

// DetectAndConvert no longer deep-validates passthrough content — the
// core's validation gate (engine.Validate, wired into Update) is the
// authority. It still rejects documents with nothing usable at all.
func TestPassthroughDelegatesValidationToCore(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())

	empty := "rules:\n  - MATCH,DIRECT\n"
	if _, _, _, err := DetectAndConvert([]byte(empty)); err == nil {
		t.Fatal("configuration without proxies or providers must be rejected")
	}
	providers := clashNodeFixture + "proxy-providers:\n  remote:\n    type: http\n    url: https://example.invalid/sub\n"
	converted, format, _, err := DetectAndConvert([]byte(providers))
	if err != nil {
		t.Fatalf("provider-style configuration must pass through: %v", err)
	}
	if format != engine.FormatClash {
		t.Fatalf("expected clash format, got %q", format)
	}
	validateWithCore(t, converted)

	for _, broken := range []string{
		clashNodeFixture + "  - {name: edge, type: http, server: example.invalid, port: 80}\n",
		strings.Replace(clashNodeFixture, "type: trojan", "type: unsupported", 1),
		clashNodeFixture + "proxy-groups: [{name: policy, type: select, proxies: [missing]}]\n",
	} {
		converted, _, _, err := DetectAndConvert([]byte(broken))
		if err != nil {
			t.Fatalf("detection must not gate passthrough content: %v", err)
		}
		if err := engine.Validate(converted); err == nil {
			t.Fatal("invalid Clash configuration passed the core validation gate")
		}
	}
}

// The manager-level guarantees survive the dual-core swap: a failed update
// keeps the last known-good source untouched, and each format is stored
// verbatim with the owning core recorded on the meta.
func TestImportFormatsPersistAndFailedUpdatesKeepKnownGoodConfiguration(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(paths.DataDir(), "clash.yaml")
	if err := os.WriteFile(source, []byte(clashNodeFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	imported, err := manager.AddUniversal(source, "example", 24, true)
	if err != nil {
		t.Fatal(err)
	}
	initial, err := manager.Update(imported.ID, true, "")
	if err != nil {
		t.Fatal(err)
	}
	if initial.Meta.Format != engine.FormatClash {
		t.Fatalf("expected clash format on meta, got %q", initial.Meta.Format)
	}
	before, err := os.ReadFile(paths.SubSourcePath(imported.ID))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("proxies:\n  - {name: edge, type: unsupported, server: example.invalid, port: 443}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(imported.ID, true, ""); err == nil {
		t.Fatal("invalid configuration update succeeded")
	}
	after, _ := os.ReadFile(paths.SubSourcePath(imported.ID))
	current, _ := manager.Get(imported.ID)
	if !bytes.Equal(before, after) || current.ContentHash != initial.Meta.ContentHash || !current.LastUpdatedAt.Equal(initial.Meta.LastUpdatedAt) || manager.ActiveID() != imported.ID {
		t.Fatal("failed conversion changed known good state")
	}

	singbox := filepath.Join(paths.DataDir(), "singbox.json")
	if err := os.WriteFile(singbox, []byte(singBoxFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	fromSingBox, err := manager.AddUniversal(singbox, "singbox", 24, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(fromSingBox.ID, true, ""); err != nil {
		t.Fatal(err)
	}
	stored, err := os.ReadFile(paths.SubSourcePath(fromSingBox.ID))
	if err != nil {
		t.Fatal(err)
	}
	if string(stored) != strings.TrimSpace(singBoxFixture) {
		t.Fatalf("sing-box source must be stored verbatim, got: %s", stored)
	}
	saved, err := manager.Get(fromSingBox.ID)
	if err != nil || saved.Format != engine.FormatSingBox {
		t.Fatalf("sing-box format not recorded on meta: %+v (%v)", saved, err)
	}
	validateWithCore(t, stored)
}

func TestURIImportRejectsPartialSuccessAndNeverEchoesCredentials(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	valid := "trojan://fixture-only@example.invalid:443?sni=tls.example.invalid#edge"
	for _, bad := range []string{
		"trojan://example.invalid:443",
		"ss://fixture-secret@example.invalid:443",
		"trojan://fixture-secret@example.invalid:443?type=grpc",
		"trojan://fixture-secret@example.invalid:443?unsupported=fixture-secret",
		"trojan://fixture-secret@example.invalid:443/ignored",
	} {
		if _, _, _, err := DetectAndConvert([]byte(valid + "\n" + bad)); err == nil {
			t.Fatal("partially supported list was accepted")
		} else if strings.Contains(err.Error(), "fixture-secret") {
			t.Fatalf("credential exposed: %v", err)
		}
	}
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		converted, format, _, err := DetectAndConvert([]byte(encoding.EncodeToString([]byte(valid))))
		if err != nil {
			t.Fatal(err)
		}
		if format != engine.FormatClash {
			t.Fatalf("share links must land on the clash core, got %q", format)
		}
		validateWithCore(t, converted)
	}
}
