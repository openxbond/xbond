package sub

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/openxbond/xbond/internal/platform/paths"
)

func TestUpdateMetadataFailurePreservesLastDownloadedSource(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	source := filepath.Join(paths.DataDir(), "source.json")
	initial := []byte(`{"outbounds":[{"type":"direct","tag":"initial"}]}`)
	if err := os.WriteFile(source, initial, 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	meta, err := manager.AddUniversal(source, "example", 24, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(meta.ID, true, false, 0); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(paths.SubSourcePath(meta.ID))
	if err != nil {
		t.Fatal(err)
	}
	previous, _ := manager.Get(meta.ID)
	if err := os.Remove(paths.SubListPath()); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(paths.SubListPath(), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte(`{"outbounds":[{"type":"direct","tag":"replacement"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(meta.ID, true, false, 0); err == nil {
		t.Fatal("metadata persistence failure was hidden")
	}
	restored, err := os.ReadFile(paths.SubSourcePath(meta.ID))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, restored) {
		t.Fatal("source was replaced despite failed metadata persistence")
	}
	current, _ := manager.Get(meta.ID)
	if current.ContentHash != previous.ContentHash || current.LastUpdatedAt != previous.LastUpdatedAt {
		t.Fatal("failed update published replacement metadata")
	}
}

func TestRemovePersistenceFailureKeepsSubscriptionAndSource(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	meta, err := manager.AddUniversal("example.json", "example", 24, true)
	if err != nil {
		t.Fatal(err)
	}
	source := []byte("last known source")
	if err := os.WriteFile(paths.SubSourcePath(meta.ID), source, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(paths.SubListPath()); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(paths.SubListPath(), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := manager.Remove(meta.ID); err == nil {
		t.Fatal("removal persistence failure was hidden")
	}
	if manager.ActiveID() != meta.ID {
		t.Fatal("failed removal changed the active subscription")
	}
	if _, err := manager.Get(meta.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := os.ReadFile(paths.SubSourcePath(meta.ID))
	if err != nil || !bytes.Equal(stored, source) {
		t.Fatal("failed removal deleted the source")
	}
}
