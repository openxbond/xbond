package sub

import (
	"github.com/openxbond/xbond/paths"
	"os"
	"testing"
)

func TestRenamePreservesIdentityAndPersists(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	m, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	meta, err := m.AddUniversal("https://example.invalid/config", "original", 24, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Rename(meta.ID, " Work; Personal "); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	saved, err := reloaded.Get(meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Name != "Work; Personal" || saved.SourceURL != meta.SourceURL || reloaded.ActiveID() != meta.ID {
		t.Fatal("rename changed subscription identity or failed to persist")
	}
	if err := m.Rename(meta.ID, " "); err == nil {
		t.Fatal("empty name accepted")
	}
	if err := m.Rename("missing", "other"); err == nil {
		t.Fatal("unknown subscription accepted")
	}
}

func TestRenameRollsBackFailedWrite(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	m, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	meta, err := m.AddUniversal("https://example.invalid/config", "original", 24, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(paths.SubListPath()); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(paths.SubListPath(), 0700); err != nil {
		t.Fatal(err)
	}
	if err := m.Rename(meta.ID, "changed"); err == nil {
		t.Fatal("failed write reported success")
	}
	saved, _ := m.Get(meta.ID)
	if saved.Name != "original" {
		t.Fatal("failed write changed live metadata")
	}
}
