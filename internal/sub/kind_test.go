package sub

import (
	"testing"
)

// kind classification drives auto-update eligibility: pasted content and
// local files never fetch, remote URLs do.
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
