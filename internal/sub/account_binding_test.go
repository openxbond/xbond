package sub

import (
	"testing"

	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
)

func TestAccountBindingRetainsIdentityAndLocalChangesAcrossTokenRotation(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	m, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	first, err := m.BindAccount("sub-first", "https://cloud.example.invalid", "https://line.example.invalid", nil, "", "en", "Personal")
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Rename(first.ID, "My configuration"); err != nil {
		t.Fatal(err)
	}
	if err := m.SaveSelection(first.ID, "Proxy", "Node A"); err != nil {
		t.Fatal(err)
	}
	if err := atomicfile.Write(paths.SubOverridePath(first.ID), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	next, err := m.BindAccount("sub-second", "https://cloud.example.invalid", "https://next-line.example.invalid", nil, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if next.ID != first.ID || len(m.List()) != 1 || next.Name != "My configuration" || next.SavedSelections["Proxy"] != "Node A" || next.Token != "sub-second" {
		t.Fatalf("rotation lost the account source's identity or preferences: id=%s name=%s count=%d", next.ID, next.Name, len(m.List()))
	}
	if m.ActiveID() != "" {
		t.Fatal("account sync must not select a configuration")
	}
}

// The render language follows the interface language that explicit binds
// carry: interface locales normalize to render languages, rotation without a
// language keeps the persisted one, and an explicit new language overwrites.
func TestAccountBindingRenderLanguageFollowsExplicitInput(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	m, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	first, err := m.BindAccount("sub-first", "https://cloud.example.invalid", "https://line.example.invalid", nil, "", "zh-cn", "")
	if err != nil {
		t.Fatal(err)
	}
	if first.Lang != "zh" {
		t.Fatalf("interface locale did not normalize to the render language: %q", first.Lang)
	}
	kept, err := m.BindAccount("sub-second", "https://cloud.example.invalid", "https://line.example.invalid", nil, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if kept.ID != first.ID || kept.Lang != "zh" {
		t.Fatalf("rotation changed the render language: id=%s lang=%q", kept.ID, kept.Lang)
	}
	switched, err := m.BindAccount("sub-third", "https://cloud.example.invalid", "https://line.example.invalid", nil, "", "en_US", "")
	if err != nil {
		t.Fatal(err)
	}
	if switched.ID != first.ID || switched.Lang != "en" {
		t.Fatalf("explicit language did not override the persisted one: lang=%q", switched.Lang)
	}
}

func TestChangeSourceURLKeepsIdentityAndRejectsNonHTTP(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	m, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	meta, err := m.AddUniversal("https://old.example.invalid/sub", "Personal", 24, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.ChangeSourceURL(meta.ID, "https://new.example.invalid/sub"); err != nil {
		t.Fatal(err)
	}
	if err := m.ChangeSourceURL(meta.ID, "file:///etc/passwd"); err == nil {
		t.Fatal("non-HTTP source was accepted")
	}
	updated, err := m.Get(meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if m.ActiveID() != meta.ID || updated.SourceURL != "https://new.example.invalid/sub" || updated.Name != "Personal" {
		t.Fatal("source edit lost configuration identity")
	}
}
