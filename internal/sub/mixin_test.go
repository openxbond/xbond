package sub

import (
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/engine"
)

func TestGlobalMixinStorageRoundtrip(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}

	mixin, err := manager.GlobalMixin()
	if err != nil {
		t.Fatalf("fresh manager must return empty mixin: %v", err)
	}
	if !mixin.IsZero() {
		t.Fatalf("expected zero mixin, got: %+v", mixin)
	}

	good := &engine.GlobalMixin{
		BypassLAN:    true,
		RulesPrepend: []string{"IP-CIDR,127.0.0.0/8,DIRECT,no-resolve"},
		RulesAppend:  []string{"DOMAIN-SUFFIX,corp.internal,DIRECT"},
		DNS:          "nameserver:\n  - 1.1.1.1\n",
	}

	if err := manager.SetGlobalMixin(good); err != nil {
		t.Fatalf("SetGlobalMixin failed: %v", err)
	}

	saved, err := manager.GlobalMixin()
	if err != nil {
		t.Fatal(err)
	}
	if !saved.BypassLAN || len(saved.RulesPrepend) != 1 || len(saved.RulesAppend) != 1 {
		t.Fatalf("saved mixin mismatch: %+v", saved)
	}

	// Zero mixin removes the file
	if err := manager.SetGlobalMixin(&engine.GlobalMixin{}); err != nil {
		t.Fatal(err)
	}
	cleared, err := manager.GlobalMixin()
	if err != nil || !cleared.IsZero() {
		t.Fatalf("expected cleared mixin, got %+v (%v)", cleared, err)
	}
}

func TestGlobalMixinConflictWithActiveSub(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	id := importOverrideFixture(t, manager, "test_active", overrideTestSource)
	if err := manager.Use(id); err != nil {
		t.Fatal(err)
	}

	// Conflict: references missing policy "non-existent"
	bad := &engine.GlobalMixin{
		RulesPrepend: []string{"DOMAIN,bad.com,non-existent"},
	}
	err = manager.SetGlobalMixin(bad)
	if err == nil || !strings.Contains(err.Error(), "references missing policy") {
		t.Fatalf("expected conflict error, got: %v", err)
	}
}

func TestKindClassificationAndNoAutoUpdate(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}

	// 1. Inline content (pasted)
	inlineMeta, err := manager.AddUniversalContent("proxies: []", "Pasted Profile", 24, false)
	if err != nil {
		t.Fatal(err)
	}
	if inlineMeta.Kind != KindInline {
		t.Fatalf("expected KindInline, got %v", inlineMeta.Kind)
	}
	if inlineMeta.AutoUpdate {
		t.Fatal("inline profile must not have AutoUpdate enabled")
	}

	// 2. Remote URL
	remoteMeta, err := manager.AddUniversal("https://example.com/sub", "Remote Sub", 24, false)
	if err != nil {
		t.Fatal(err)
	}
	if remoteMeta.Kind != KindRemote {
		t.Fatalf("expected KindRemote, got %v", remoteMeta.Kind)
	}
	if !remoteMeta.AutoUpdate {
		t.Fatal("remote profile must have AutoUpdate enabled")
	}

	// 3. Local file
	localMeta, err := manager.AddUniversal("C:\\temp\\test.yaml", "Local File", 24, false)
	if err != nil {
		t.Fatal(err)
	}
	if localMeta.Kind != KindLocal {
		t.Fatalf("expected KindLocal, got %v", localMeta.Kind)
	}
	if localMeta.AutoUpdate {
		t.Fatal("local file profile must not have AutoUpdate enabled")
	}
}
