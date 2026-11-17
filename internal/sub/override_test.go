package sub

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
)

const overrideTestSource = `proxies:
  - name: edge
    type: trojan
    server: example.invalid
    port: 443
    password: fixture-only
proxy-groups:
  - name: policy
    type: select
    proxies: [edge]
rules:
  - MATCH,policy
`

func importOverrideFixture(t *testing.T, manager *Manager, name, source string) string {
	t.Helper()
	path := filepath.Join(paths.DataDir(), name+".yaml")
	if err := os.WriteFile(path, []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	meta, err := manager.AddUniversal(path, name, 24, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(t.Context(), meta.ID, true, ""); err != nil {
		t.Fatal(err)
	}
	return meta.ID
}

// Override storage round-trips the normalized groups and DNS upstreams,
// rejects an unknown target at save time against the stored source, and a
// zero override removes the file.
func TestOverrideStorageRoundtripAndSaveTimeConflict(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	id := importOverrideFixture(t, manager, "override_sub", overrideTestSource)

	if override, err := manager.Override(id); err != nil || override != nil {
		t.Fatalf("fresh subscription must have no override: %+v (%v)", override, err)
	}

	good := &engine.SubscriptionOverride{
		Groups: []engine.RuleGroup{
			{Name: "Block", Target: "REJECT", Enabled: true, Rules: []string{"blocked.example.invalid"}},
			{Name: "ToEdge", Target: "edge", Enabled: true, Rules: []string{"x.example.invalid"}},
			{Name: "Off", Target: "DIRECT", Enabled: false, Rules: []string{"ignored.example.invalid"}},
		},
		DNS: &engine.DNSOverride{Nameservers: []string{" 223.5.5.5 ", "1.1.1.1"}, Fallback: []string{"8.8.8.8"}},
	}
	if err := manager.SetOverride(id, good); err != nil {
		t.Fatalf("valid override rejected at save time: %v", err)
	}
	loaded, err := manager.Override(id)
	if err != nil || loaded == nil {
		t.Fatalf("override round-trip failed: %+v (%v)", loaded, err)
	}
	if len(loaded.Groups) != 3 {
		t.Fatalf("disabled group must survive a save (the switch stays editable): %+v", loaded.Groups)
	}
	if loaded.Groups[0].Name != "Block" || loaded.Groups[0].Target != "REJECT" {
		t.Fatalf("first group mismatch: %+v", loaded.Groups[0])
	}
	if loaded.Groups[2].Enabled || loaded.Groups[2].Name != "Off" {
		t.Fatalf("disabled group state lost: %+v", loaded.Groups[2])
	}
	if loaded.DNS == nil || len(loaded.DNS.Nameservers) != 2 || loaded.DNS.Nameservers[0] != "223.5.5.5" || len(loaded.DNS.Fallback) != 1 {
		t.Fatalf("DNS upstreams not normalized: %+v", loaded.DNS)
	}

	conflicting := &engine.SubscriptionOverride{
		Groups: []engine.RuleGroup{{Name: "Ghost", Target: "ghost", Enabled: true, Rules: []string{"x.example.invalid"}}},
	}
	if err := manager.SetOverride(id, conflicting); err == nil {
		t.Fatal("override referencing a missing target was saved")
	}
	if _, err := os.Stat(paths.SubOverridePath(id)); err != nil {
		t.Fatalf("rejected save removed the stored override: %v", err)
	}

	if err := manager.SetOverride(id, &engine.SubscriptionOverride{}); err != nil {
		t.Fatalf("clearing override failed: %v", err)
	}
	if override, err := manager.Override(id); err != nil || override != nil {
		t.Fatalf("cleared override must read as none: %+v (%v)", override, err)
	}
	if _, err := os.Stat(paths.SubOverridePath(id)); !os.IsNotExist(err) {
		t.Fatal("cleared override file still exists")
	}
	if err := manager.SetOverride("missing", good); err == nil {
		t.Fatal("override saved for a missing subscription")
	}
}

// When an upstream update removes the target a group references, the update
// fails loudly and the last known-good source, hash and meta stay untouched
// (client-rethink §四.3: no silent retargeting).
func TestUpdateFailsWhenOverrideConflictsWithNewUpstream(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	id := importOverrideFixture(t, manager, "conflict_sub", overrideTestSource)

	if err := manager.SetOverride(id, &engine.SubscriptionOverride{
		Groups: []engine.RuleGroup{{Name: "Keep", Target: "edge", Enabled: true, Rules: []string{"kept.example.invalid"}}},
	}); err != nil {
		t.Fatalf("override rejected against stored source: %v", err)
	}

	upstream := filepath.Join(paths.DataDir(), "conflict_sub.yaml")
	if err := os.WriteFile(upstream, []byte(`proxies:
  - name: other
    type: trojan
    server: example.invalid
    port: 443
    password: fixture-only
rules:
  - MATCH,DIRECT
`), 0o600); err != nil {
		t.Fatal(err)
	}

	before, err := os.ReadFile(paths.SubSourcePath(id))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(t.Context(), id, true, ""); err == nil {
		t.Fatal("update conflicting with the override succeeded")
	} else if !strings.Contains(err.Error(), "override") {
		t.Fatalf("update failure does not mention the override: %v", err)
	}
	after, err := os.ReadFile(paths.SubSourcePath(id))
	if err != nil || string(before) != string(after) {
		t.Fatalf("conflicted update rewrote the stored source: %v", err)
	}
	meta, err := manager.Get(id)
	if err != nil || meta.Health != HealthTransientError || !strings.Contains(meta.LastErrorMessage, "override") {
		t.Fatalf("conflict not surfaced on the meta: %+v (%v)", meta, err)
	}
}
