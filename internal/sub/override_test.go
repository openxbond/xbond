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

// Override storage round-trips, rejects conflicts at save time against the
// stored source, and a zero override removes the file.
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
		RulesPrepend: []string{"DOMAIN,blocked.example.invalid,REJECT"},
		RulesAppend:  []string{"DOMAIN,x.example.invalid,edge"},
	}
	if err := manager.SetOverride(id, good); err != nil {
		t.Fatalf("valid override rejected at save time: %v", err)
	}
	loaded, err := manager.Override(id)
	if err != nil || loaded == nil || len(loaded.RulesPrepend) != 1 || len(loaded.RulesAppend) != 1 {
		t.Fatalf("override round-trip failed: %+v (%v)", loaded, err)
	}

	conflicting := &engine.SubscriptionOverride{RulesAppend: []string{"DOMAIN,x.example.invalid,ghost"}}
	if err := manager.SetOverride(id, conflicting); err == nil {
		t.Fatal("override referencing a missing policy was saved")
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

// When an upstream update removes a policy the override references, the
// update fails loudly and the last known-good source, hash and meta stay
// untouched (client-rethink §四.3: no silent retargeting).
func TestUpdateFailsWhenOverrideConflictsWithNewUpstream(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	id := importOverrideFixture(t, manager, "conflict_sub", overrideTestSource)

	if err := manager.SetOverride(id, &engine.SubscriptionOverride{
		RulesAppend: []string{"DOMAIN,kept.example.invalid,edge"},
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
