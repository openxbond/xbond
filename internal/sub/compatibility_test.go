package sub

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
	"gopkg.in/yaml.v3"
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

func validateWithCore(t *testing.T, converted []byte) {
	t.Helper()
	if err := engine.Validate(converted); err != nil {
		t.Fatalf("converted config is not usable by pinned core: %v", err)
	}
}

// With the mihomo core, Clash YAML is the native format: every section the
// core can run — rules, DNS, TUN, fallback/load-balance groups, providers —
// passes through untouched.
func TestClashYAMLPassesThroughNatively(t *testing.T) {
	input := clashNodeFixture + `proxy-groups:
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
	converted, quota, err := DetectAndConvert([]byte(input), false)
	if err != nil {
		t.Fatal(err)
	}
	if string(converted) != strings.TrimSpace(input) {
		t.Fatalf("Clash YAML must pass through verbatim:\n%s", converted)
	}
	if quota != nil {
		t.Fatalf("no quota comment present, got %+v", quota)
	}
	validateWithCore(t, converted)

	withQuota := "# subscription-userinfo: upload=1; download=2; total=10; expire=1800000000\n" + input
	_, quota, err = DetectAndConvert([]byte(withQuota), false)
	if err != nil {
		t.Fatal(err)
	}
	if quota == nil || quota.TotalBytes != 10 {
		t.Fatalf("expected quota parsed from comment, got %+v", quota)
	}
}

// DetectAndConvert no longer deep-validates passthrough content — the core's
// validation gate (engine.Validate, wired into Update) is the authority. It
// still rejects documents with nothing usable at all.
func TestClashPassthroughDelegatesValidationToCore(t *testing.T) {
	empty := "rules:\n  - MATCH,DIRECT\n"
	if _, _, err := DetectAndConvert([]byte(empty), false); err == nil {
		t.Fatal("configuration without proxies or providers must be rejected")
	}
	providers := clashNodeFixture + "proxy-providers:\n  remote:\n    type: http\n    url: https://example.invalid/sub\n"
	converted, _, err := DetectAndConvert([]byte(providers), false)
	if err != nil {
		t.Fatalf("provider-style configuration must pass through: %v", err)
	}
	validateWithCore(t, converted)

	for _, broken := range []string{
		clashNodeFixture + "  - {name: edge, type: http, server: example.invalid, port: 80}\n",
		strings.Replace(clashNodeFixture, "type: trojan", "type: unsupported", 1),
		clashNodeFixture + "proxy-groups: [{name: policy, type: select, proxies: [missing]}]\n",
	} {
		converted, _, err := DetectAndConvert([]byte(broken), false)
		if err != nil {
			t.Fatalf("detection must not gate passthrough content: %v", err)
		}
		if err := engine.Validate(converted); err == nil {
			t.Fatal("invalid Clash configuration passed the core validation gate")
		}
	}
}

// sing-box JSON converts strictly: unknown outbound types, DNS sections,
// rule sets and unmappable rules are rejected instead of silently degraded;
// explicit node-only mode keeps just the proxy nodes.
// realityKey is a structurally valid X25519 public key (32 bytes) so the
// core's REALITY validation accepts the fixture; the handshake never runs.
var realityKey = base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x01}, 32))

func TestSingBoxToClashConversion(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	source := fmt.Sprintf(`{
  "log": {"level": "info"},
  "outbounds": [
    {"type": "direct", "tag": "direct"},
    {"type": "block", "tag": "block"},
    {"type": "trojan", "tag": "edge", "server": "example.invalid", "server_port": 443,
     "password": "fixture-only", "tls": {"enabled": true, "server_name": "tls.example.invalid"},
     "transport": {"type": "ws", "path": "/socket", "headers": {"Host": "ws.example.invalid"}}},
    {"type": "vless", "tag": "reality-node", "server": "example.invalid", "server_port": 443,
     "uuid": "7b0125c9-42d8-4ea1-b2a7-fbf082d29646", "flow": "xtls-rprx-vision",
     "tls": {"enabled": true, "server_name": "reality.example.invalid",
             "utls": {"enabled": true, "fingerprint": "chrome"},
             "reality": {"enabled": true, "public_key": %q, "short_id": "0123abcd"}}},
    {"type": "shadowsocks", "tag": "ss-node", "server": "example.invalid", "server_port": 8388,
     "method": "aes-128-gcm", "password": "fixture-only"},
    {"type": "selector", "tag": "Proxy", "outbounds": ["Auto", "edge", "direct"]},
    {"type": "urltest", "tag": "Auto", "outbounds": ["edge", "ss-node"], "interval": "3m", "tolerance": 50}
  ],
  "route": {
    "rules": [
      {"domain_suffix": [".example.invalid"], "outbound": "direct"},
      {"ip_cidr": ["10.0.0.0/8"], "outbound": "direct"},
      {"port": 443, "outbound": "Proxy"}
    ],
    "final": "Proxy"
  }
}`, realityKey)
	converted, _, err := DetectAndConvert([]byte(source), false)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Proxies []map[string]any `yaml:"proxies"`
		Groups  []map[string]any `yaml:"proxy-groups"`
		Rules   []string         `yaml:"rules"`
	}
	if err := yaml.Unmarshal(converted, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Proxies) != 3 || len(doc.Groups) != 2 || len(doc.Rules) != 4 {
		t.Fatalf("unexpected conversion shape: %d proxies, %d groups, %d rules", len(doc.Proxies), len(doc.Groups), len(doc.Rules))
	}
	reality := doc.Proxies[1]
	if reality["reality-opts"] == nil || reality["client-fingerprint"] != "chrome" || reality["flow"] != "xtls-rprx-vision" {
		t.Fatalf("REALITY fields not mapped: %v", reality)
	}
	edge := doc.Proxies[0]
	if edge["network"] != "ws" || edge["sni"] != "tls.example.invalid" {
		t.Fatalf("trojan transport/TLS not mapped: %v", edge)
	}
	if doc.Rules[len(doc.Rules)-1] != "MATCH,Proxy" {
		t.Fatalf("route.final not mapped to MATCH: %v", doc.Rules)
	}
	validateWithCore(t, converted)

	for name, broken := range map[string]string{
		"dns section":      `{"outbounds":[{"type":"trojan","tag":"a","server":"s","server_port":443,"password":"p"}],"dns":{"servers":["8.8.8.8"]}}`,
		"rule set":         `{"outbounds":[{"type":"trojan","tag":"a","server":"s","server_port":443,"password":"p"}],"route":{"rule_set":[{"type":"remote","tag":"x"}],"rules":[{"rule_set":["x"],"outbound":"direct"}]}}`,
		"grpc transport":   `{"outbounds":[{"type":"trojan","tag":"a","server":"s","server_port":443,"password":"p","transport":{"type":"grpc","service_name":"x"}}]}`,
		"unknown type":     `{"outbounds":[{"type":"hysteria2","tag":"a","server":"s","server_port":443}]}`,
		"unknown field":    `{"outbounds":[{"type":"trojan","tag":"a","server":"s","server_port":443,"password":"p"}],"ntp":{"enabled":true}}`,
		"logical rule":     `{"outbounds":[{"type":"trojan","tag":"a","server":"s","server_port":443,"password":"p"}],"route":{"rules":[{"logic":"and","rules":[],"outbound":"direct"}]}}`,
		"unknown rule key": `{"outbounds":[{"type":"trojan","tag":"a","server":"s","server_port":443,"password":"p"}],"route":{"rules":[{"protocol":"dns","outbound":"direct"}]}}`,
	} {
		if _, _, err := DetectAndConvert([]byte(broken), false); err == nil {
			t.Fatalf("%s was silently degraded", name)
		} else if strings.Contains(err.Error(), "fixture") {
			t.Fatalf("%s leaked content: %v", name, err)
		}
	}

	// nodesOnly keeps only the nodes and builds the default group pair.
	nodesOnly, _, err := DetectAndConvert([]byte(source), true)
	if err != nil {
		t.Fatal(err)
	}
	var nodesDoc struct {
		Proxies []map[string]any `yaml:"proxies"`
		Groups  []map[string]any `yaml:"proxy-groups"`
		Rules   []string         `yaml:"rules"`
	}
	if err := yaml.Unmarshal(nodesOnly, &nodesDoc); err != nil {
		t.Fatal(err)
	}
	if len(nodesDoc.Proxies) != 3 || len(nodesDoc.Groups) != 2 || len(nodesDoc.Rules) != 1 || nodesDoc.Rules[0] != "MATCH,Proxy" {
		t.Fatalf("unexpected node-only shape: %d proxies, %d groups, %d rules", len(nodesDoc.Proxies), len(nodesDoc.Groups), len(nodesDoc.Rules))
	}
	if nodesDoc.Groups[0]["name"] != "Proxy" || nodesDoc.Groups[1]["name"] != "Auto" {
		t.Fatalf("node-only mode must build default groups, got %v", nodesDoc.Groups)
	}
	validateWithCore(t, nodesOnly)
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
		if _, _, err := DetectAndConvert([]byte(valid+"\n"+bad), false); err == nil {
			t.Fatal("partially supported list was accepted")
		} else if strings.Contains(err.Error(), "fixture-secret") {
			t.Fatalf("credential exposed: %v", err)
		}
	}
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		converted, _, err := DetectAndConvert([]byte(encoding.EncodeToString([]byte(valid))), false)
		if err != nil {
			t.Fatal(err)
		}
		validateWithCore(t, converted)
	}
}

// The manager-level guarantees survive the core swap: a failed update keeps
// the last known-good source untouched, and an explicit node-only import
// policy persists across refreshes.
func TestClashImportPolicyPersistsAndFailedUpdatesKeepKnownGoodConfiguration(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(paths.DataDir(), "clash.yaml")
	if err := os.WriteFile(source, []byte(clashNodeFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	imported, err := manager.AddUniversal(source, "example", 24, true, false)
	if err != nil {
		t.Fatal(err)
	}
	initial, err := manager.Update(imported.ID, true, false, 0)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(paths.SubSourcePath(imported.ID))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("proxies:\n  - {name: edge, type: unsupported, server: example.invalid, port: 443}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(imported.ID, true, false, 0); err == nil {
		t.Fatal("invalid configuration update succeeded")
	}
	after, _ := os.ReadFile(paths.SubSourcePath(imported.ID))
	current, _ := manager.Get(imported.ID)
	if !bytes.Equal(before, after) || current.ContentHash != initial.Meta.ContentHash || !current.LastUpdatedAt.Equal(initial.Meta.LastUpdatedAt) || manager.ActiveID() != imported.ID {
		t.Fatal("failed conversion changed known good state")
	}

	nodes, err := manager.AddUniversal(source, "nodes", 24, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if nodes.ID == imported.ID || manager.ActiveID() != imported.ID {
		t.Fatal("node-only import overwrote or activated the strict source")
	}
	if _, err := manager.Update(nodes.ID, true, false, 0); err == nil {
		t.Fatal("node-only import accepted an invalid configuration")
	}

	validSingBox := `{"outbounds":[{"type":"trojan","tag":"edge","server":"example.invalid","server_port":443,"password":"fixture-only"}]}`
	singbox := filepath.Join(paths.DataDir(), "singbox.json")
	if err := os.WriteFile(singbox, []byte(validSingBox), 0o600); err != nil {
		t.Fatal(err)
	}
	fromSingBox, err := manager.AddUniversal(singbox, "singbox", 24, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(fromSingBox.ID, true, false, 0); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	saved, err := restarted.Get(fromSingBox.ID)
	if err != nil || !saved.ClashNodesOnly {
		t.Fatal("explicit import policy was not persisted")
	}
	if _, err := restarted.Update(fromSingBox.ID, true, false, 0); err != nil {
		t.Fatalf("refresh did not retain node-only mode: %v", err)
	}
	stored, err := os.ReadFile(paths.SubSourcePath(fromSingBox.ID))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Proxies []map[string]any `yaml:"proxies"`
		Groups  []map[string]any `yaml:"proxy-groups"`
	}
	if err := yaml.Unmarshal(stored, &doc); err != nil || len(doc.Proxies) == 0 || len(doc.Groups) != 2 {
		t.Fatalf("sing-box source was not stored as canonical Clash YAML: %s", stored)
	}
}
