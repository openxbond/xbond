package sub

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
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

func TestClashImportNeverSilentlyDropsPolicyOrNodeFields(t *testing.T) {
	for _, extra := range []string{
		"rules: [MATCH,DIRECT]\n",
		"dns: {enable: true}\n",
		"proxy-providers: {remote: {type: http}}\n",
	} {
		if _, _, err := DetectAndConvert([]byte(clashNodeFixture+extra), false); err == nil {
			t.Fatalf("unsupported section was silently discarded: %s", extra)
		}
	}
	unsupported := strings.Replace(clashNodeFixture, "network: ws", "network: grpc", 1)
	if _, _, err := DetectAndConvert([]byte(unsupported), true); err == nil {
		t.Fatal("node-only import silently changed unsupported node transport")
	}
	for _, kind := range []string{"fallback", "load-balance", "unknown"} {
		input := clashNodeFixture + "proxy-groups:\n  - name: policy\n    type: " + kind + "\n    proxies: [edge]\n"
		if _, _, err := DetectAndConvert([]byte(input), false); err == nil {
			t.Fatalf("unsupported policy %s changed semantics", kind)
		}
	}
}

func TestExplicitClashNodesOnlyPreservesTransportAndGeneratesUsablePolicy(t *testing.T) {
	input := clashNodeFixture + "rules: [MATCH,DIRECT]\ndns: {enable: true}\nproxy-groups:\n  - name: ignored\n    type: load-balance\n    proxies: [edge]\n"
	converted, _, err := DetectAndConvert([]byte(input), true)
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Outbounds []struct {
			Type      string `json:"type"`
			Transport struct {
				Type    string            `json:"type"`
				Path    string            `json:"path"`
				Headers map[string]string `json:"headers"`
			} `json:"transport"`
		} `json:"outbounds"`
		Route struct {
			Final string `json:"final"`
		} `json:"route"`
	}
	if err := json.Unmarshal(converted, &config); err != nil {
		t.Fatal(err)
	}
	if config.Outbounds[0].Transport.Type != "ws" || config.Outbounds[0].Transport.Path != "/socket" || config.Outbounds[0].Transport.Headers["Host"] != "ws.example.invalid" || config.Route.Final == "" {
		t.Fatalf("transport or default policy not preserved: %s", converted)
	}
	if strings.Contains(string(converted), "ignored") {
		t.Fatal("node-only mode retained upstream policy")
	}
	if err := engine.Validate(converted); err != nil {
		t.Fatalf("converted config is not usable by pinned core: %v", err)
	}
}

func TestURIImportRejectsPartialSuccessAndNeverEchoesCredentials(t *testing.T) {
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
		if err := engine.Validate(converted); err != nil {
			t.Fatal(err)
		}
	}
}

func TestClashRejectsDuplicateNamesUnknownNodesAndGroupReferences(t *testing.T) {
	for _, input := range []string{
		clashNodeFixture + "  - {name: edge, type: http, server: example.invalid, port: 80}\n",
		strings.Replace(clashNodeFixture, "type: trojan", "type: unsupported", 1),
		clashNodeFixture + "proxy-groups: [{name: policy, type: select, proxies: [missing]}]\n",
		clashNodeFixture + "proxy-groups: [{name: policy, type: select, proxies: [policy]}]\n",
		clashNodeFixture + "proxy-groups: [{name: policy, type: select, proxies: [other]}, {name: other, type: select, proxies: [policy]}]\n",
	} {
		if _, _, err := DetectAndConvert([]byte(input), false); err == nil {
			t.Fatal("invalid or partial config accepted")
		}
	}
}

func TestSupportedClashNodesAndNestedPoliciesPassPinnedCoreValidation(t *testing.T) {
	for _, fields := range []string{
		"type: ss, cipher: aes-128-gcm, password: fixture-only, udp: false",
		"type: trojan, password: fixture-only, skip-cert-verify: true, alpn: [http/1.1]",
		"type: vless, uuid: 7b0125c9-42d8-4ea1-b2a7-fbf082d29646, tls: true, servername: tls.example.invalid",
		"type: vmess, uuid: 7b0125c9-42d8-4ea1-b2a7-fbf082d29646, cipher: auto, alterId: 0",
		"type: socks5, username: fixture-user, password: fixture-only, udp: false",
		"type: http, username: fixture-user, password: fixture-only, tls: true, sni: tls.example.invalid",
	} {
		input := "proxies:\n  - {name: edge, server: example.invalid, port: 443, " + fields + "}\nproxy-groups:\n  - {name: policy, type: select, proxies: [nested, DIRECT]}\n  - {name: nested, type: url-test, proxies: [edge], url: 'https://example.invalid/test', interval: 60, tolerance: 100}\n"
		converted, _, err := DetectAndConvert([]byte(input), false)
		if err != nil {
			t.Fatal(err)
		}
		if err := engine.Validate(converted); err != nil {
			t.Fatalf("supported node or nested strategy does not pass pinned core: %v", err)
		}
	}
}

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
	strict, err := manager.AddUniversal(source, "strict", 24, true, false)
	if err != nil {
		t.Fatal(err)
	}
	initial, err := manager.Update(strict.ID, true, false, 0)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(paths.SubSourcePath(strict.ID))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte(clashNodeFixture+"rules: [MATCH,DIRECT]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.AddUniversal(source, "strict", 24, false, false); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(strict.ID, true, false, 0); err == nil {
		t.Fatal("unsupported policy update succeeded")
	}
	after, _ := os.ReadFile(paths.SubSourcePath(strict.ID))
	current, _ := manager.Get(strict.ID)
	if !bytes.Equal(before, after) || current.ContentHash != initial.Meta.ContentHash || !current.LastUpdatedAt.Equal(initial.Meta.LastUpdatedAt) || manager.ActiveID() != strict.ID {
		t.Fatal("failed conversion changed known good state")
	}
	nodes, err := manager.AddUniversal(source, "nodes", 24, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if nodes.ID == strict.ID || manager.ActiveID() != strict.ID {
		t.Fatal("node-only import overwrote or activated the strict source")
	}
	if _, err := manager.Update(nodes.ID, true, false, 0); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	saved, err := restarted.Get(nodes.ID)
	if err != nil || !saved.ClashNodesOnly {
		t.Fatal("explicit import policy was not persisted")
	}
	if _, err := restarted.Update(nodes.ID, true, false, 0); err != nil {
		t.Fatalf("refresh did not retain node-only mode: %v", err)
	}
}
