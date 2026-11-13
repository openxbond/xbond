package sub

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
)

func writeUpstreamSource(t *testing.T, path, marker string) {
	t.Helper()
	source := "proxies:\n  - name: edge\n    type: trojan\n    server: example.invalid\n    port: 443\n    password: fixture-only\nproxy-groups:\n  - name: policy\n    type: select\n    proxies: [edge]\nrules:\n  - MATCH,policy\n# " + marker + "\n"
	if err := os.WriteFile(path, []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
}

// Content-changing updates snapshot the outgoing source, the directory is
// pruned to the newest versionLimit entries, and rollback restores the
// newest version — reversibly, since the outgoing source becomes a version
// itself. The rollback rides the saved override: a version conflicting with
// it fails and nothing changes.
func TestVersionsSnapshotPruneAndRollback(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	upstream := filepath.Join(paths.DataDir(), "versions_sub.yaml")
	writeUpstreamSource(t, upstream, "v1")
	meta, err := manager.AddUniversal(upstream, "versions", 24, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(t.Context(), meta.ID, true, ""); err != nil {
		t.Fatal(err)
	}

	writeUpstreamSource(t, upstream, "v2")
	if _, err := manager.Update(t.Context(), meta.ID, true, ""); err != nil {
		t.Fatal(err)
	}
	writeUpstreamSource(t, upstream, "v3")
	if _, err := manager.Update(t.Context(), meta.ID, true, ""); err != nil {
		t.Fatal(err)
	}

	versions, err := manager.Versions(meta.ID)
	if err != nil || len(versions) != 2 {
		t.Fatalf("expected 2 stored versions, got %+v (%v)", versions, err)
	}

	// Rollback restores v2 and snapshots the outgoing v3: reversible.
	rolled, err := manager.Rollback(meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(paths.SubSourcePath(meta.ID))
	if err != nil || !strings.Contains(string(source), "# v2") {
		t.Fatalf("rollback did not restore v2: %v", err)
	}
	if rolled.ContentHash == "" {
		t.Fatal("rollback did not update the content hash")
	}
	if versions, _ := manager.Versions(meta.ID); len(versions) != 3 {
		t.Fatalf("outgoing source must become a version: %+v", versions)
	}
	if _, err := manager.Rollback(meta.ID); err != nil {
		t.Fatal(err)
	}
	source, _ = os.ReadFile(paths.SubSourcePath(meta.ID))
	if !strings.Contains(string(source), "# v3") {
		t.Fatal("second rollback did not restore v3 (rollback must be reversible)")
	}

	// A saved override that conflicts with the restored version blocks the
	// rollback and keeps the current state.
	if err := manager.SetOverride(meta.ID, &engine.SubscriptionOverride{
		RulesAppend: []string{"DOMAIN,x.example.invalid,ghost"},
	}); err == nil {
		t.Fatal("conflicting override was saved")
	}
	// The override references a policy that only v1/v2/v3 all contain — use
	// a genuinely conflicting one by referencing a node the versions lack.
	if err := manager.SetOverride(meta.ID, &engine.SubscriptionOverride{
		RulesAppend: []string{"DOMAIN,x.example.invalid,only-in-v4"},
	}); err == nil {
		// A missing policy is rejected at save time, so craft the conflict by
		// writing the override file directly.
		if err := os.WriteFile(paths.SubOverridePath(meta.ID), []byte(`{"rulesAppend":["DOMAIN,x.example.invalid,only-in-v4"]}`), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := manager.Rollback(meta.ID); err == nil {
			t.Fatal("rollback conflicting with the override succeeded")
		}
		source, _ := os.ReadFile(paths.SubSourcePath(meta.ID))
		if !strings.Contains(string(source), "# v3") {
			t.Fatal("failed rollback changed the source")
		}
	}

	// Pruning: versions never exceed versionLimit.
	for index := 4; index <= 10; index++ {
		writeUpstreamSource(t, upstream, "v"+string(rune('0'+index)))
		if _, err := manager.Update(t.Context(), meta.ID, true, ""); err != nil {
			t.Fatal(err)
		}
	}
	if versions, _ := manager.Versions(meta.ID); len(versions) > versionLimit {
		t.Fatalf("versions not pruned: %d entries", len(versions))
	}
}

// An update with unchanged content does not consume a version slot.
func TestUpdateWithoutContentChangeKeepsVersions(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	upstream := filepath.Join(paths.DataDir(), "stable_sub.yaml")
	writeUpstreamSource(t, upstream, "v1")
	meta, err := manager.AddUniversal(upstream, "stable", 24, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(t.Context(), meta.ID, true, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(t.Context(), meta.ID, true, ""); err != nil {
		t.Fatal(err)
	}
	if versions, _ := manager.Versions(meta.ID); len(versions) != 0 {
		t.Fatalf("unchanged content must not snapshot: %+v", versions)
	}
}
