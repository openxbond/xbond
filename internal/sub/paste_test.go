package sub

import (
	"os"
	"strings"
	"testing"
)

func TestAddUniversalContentSnapshotsAndReusesID(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())

	manager, err := NewManager()
	if err != nil {
		t.Fatalf("new manager: %v", err)
	}
	content := "proxies:\n  - {name: edge, type: trojan, server: example.invalid, port: 443, password: fixture-only}\n"

	meta, err := manager.AddUniversalContent(content, "", 24, true)
	if err != nil {
		t.Fatalf("add pasted content: %v", err)
	}
	if meta.Type != SubTypeUniversal {
		t.Errorf("type: got %q", meta.Type)
	}
	if !strings.HasPrefix(meta.ID, "uni_") {
		t.Errorf("id: got %q", meta.ID)
	}
	saved, err := os.ReadFile(meta.SourceURL)
	if err != nil {
		t.Fatalf("snapshot file missing: %v", err)
	}
	if string(saved) != content {
		t.Errorf("snapshot content mismatch: %d vs %d bytes", len(saved), len(content))
	}
	if manager.ActiveID() != meta.ID {
		t.Errorf("activate: active %q, want %q", manager.ActiveID(), meta.ID)
	}

	again, err := manager.AddUniversalContent(content, "", 24, false)
	if err != nil {
		t.Fatalf("re-add: %v", err)
	}
	if again.ID != meta.ID {
		t.Errorf("same content must reuse the id: got %q, want %q", again.ID, meta.ID)
	}
	if again.Name != meta.Name {
		t.Errorf("generated name changed: got %q, want %q", again.Name, meta.Name)
	}
}

func TestAddUniversalContentRejectsBlank(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())

	manager, err := NewManager()
	if err != nil {
		t.Fatalf("new manager: %v", err)
	}
	if _, err := manager.AddUniversalContent("   \n", "", 24, false); err == nil {
		t.Fatal("blank content must be rejected")
	}
}
