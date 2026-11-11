package sub

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
)

// EditSource replaces the source through the full gate chain, pins the
// subscription, snapshots the outgoing source (reversible), and the pin
// survives a same-content edit. Gate failures keep everything untouched.
func TestEditSourceGatesPinAndVersioning(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	upstream := filepath.Join(paths.DataDir(), "edit_sub.yaml")
	writeUpstreamSource(t, upstream, "v1")
	meta, err := manager.AddUniversal(upstream, "edit", 24, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(meta.ID, true, ""); err != nil {
		t.Fatal(err)
	}

	// A gate-failing edit is rejected and changes nothing.
	before, _ := os.ReadFile(paths.SubSourcePath(meta.ID))
	if _, err := manager.EditSource(meta.ID, []byte("proxies:\n  - {name: x, type: unsupported, server: e.invalid, port: 1}\n")); err == nil {
		t.Fatal("invalid edit accepted")
	}
	after, _ := os.ReadFile(paths.SubSourcePath(meta.ID))
	if string(before) != string(after) {
		t.Fatal("rejected edit changed the source")
	}
	if pinned, _ := manager.Get(meta.ID); pinned.SourcePinned {
		t.Fatal("rejected edit pinned the subscription")
	}

	// A valid edit lands, pins, and snapshots the outgoing source.
	edited := "proxies:\n  - name: edited\n    type: trojan\n    server: example.invalid\n    port: 443\n    password: fixture-only\nproxy-groups:\n  - name: policy\n    type: select\n    proxies: [edited]\nrules:\n  - MATCH,policy\n"
	saved, err := manager.EditSource(meta.ID, []byte(edited))
	if err != nil {
		t.Fatal(err)
	}
	if !saved.SourcePinned || saved.Format != engine.FormatClash {
		t.Fatalf("edit did not pin or record format: %+v", saved)
	}
	source, _ := os.ReadFile(paths.SubSourcePath(meta.ID))
	if !strings.Contains(string(source), "name: edited") {
		t.Fatal("edited content not stored")
	}
	if versions, _ := manager.Versions(meta.ID); len(versions) != 1 {
		t.Fatalf("outgoing source must become a version: %+v", versions)
	}

	// The override rides the edit: a conflicting saved override blocks it.
	if _, err := manager.EditSource(meta.ID, []byte(edited)); err != nil {
		t.Fatal(err) // same content is fine; pin intent preserved
	}
	if err := os.WriteFile(paths.SubOverridePath(meta.ID), []byte(`{"rulesAppend":["DOMAIN,x.example.invalid,missing-group"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.EditSource(meta.ID, []byte(edited)); err == nil {
		t.Fatal("edit conflicting with the override succeeded")
	}
	if err := os.Remove(paths.SubOverridePath(meta.ID)); err != nil {
		t.Fatal(err)
	}

	// Unpin restores automatic updates.
	unpinned, err := manager.SetSourcePinned(meta.ID, false)
	if err != nil || unpinned.SourcePinned {
		t.Fatalf("unpin failed: %+v (%v)", unpinned, err)
	}
}

// SetSourcePinned is idempotent and rejects missing subscriptions.
func TestSetSourcePinnedIdempotent(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	id := importOverrideFixture(t, manager, "pin_sub", overrideTestSource)
	for _, want := range []bool{true, true, false, false} {
		meta, err := manager.SetSourcePinned(id, want)
		if err != nil || meta.SourcePinned != want {
			t.Fatalf("pin toggle to %v failed: %+v (%v)", want, meta, err)
		}
	}
	if _, err := manager.SetSourcePinned("missing", true); err == nil {
		t.Fatal("pinned a missing subscription")
	}
}
