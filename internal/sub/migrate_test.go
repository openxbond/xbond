package sub

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
)

// MigrateLegacySources backfills the core format on subscriptions stored
// before the dual-core swap. No content is converted — each format runs
// natively — so migration only records which core owns each subscription and
// flags sources neither core understands.
func TestMigrateLegacySourcesBackfillsFormat(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}

	const clashSource = "proxies:\n  - {name: edge, type: trojan, server: example.invalid, port: 443, password: fixture-only}\nrules:\n  - MATCH,edge\n"
	const singBoxSource = `{"outbounds":[{"type":"trojan","tag":"edge","server":"example.invalid","server_port":443,"password":"fixture-only"}],"dns":{"servers":["8.8.8.8"]}}`
	const unusable = `{"route":{"rules":[]}}`

	seed := func(name, content string) *SubscriptionMeta {
		t.Helper()
		meta, err := manager.AddUniversal(filepath.Join(paths.DataDir(), name+".yaml"), name, 24, false)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(paths.SubDir(meta.ID), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(paths.SubSourcePath(meta.ID), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		return meta
	}

	clashSub := seed("clash_sub", clashSource)
	singBoxSub := seed("singbox_sub", singBoxSource)
	unusableSub := seed("unusable_sub", unusable)

	manager.MigrateLegacySources()

	if meta, err := manager.Get(clashSub.ID); err != nil || meta.Format != engine.FormatClash {
		t.Fatalf("clash source format not backfilled: %+v (%v)", meta, err)
	}
	if meta, err := manager.Get(singBoxSub.ID); err != nil || meta.Format != engine.FormatSingBox {
		t.Fatalf("sing-box source format not backfilled: %+v (%v)", meta, err)
	}
	if meta, err := manager.Get(unusableSub.ID); err != nil {
		t.Fatal(err)
	} else if meta.Health != HealthTransientError || !strings.Contains(meta.LastErrorMessage, "unusable") {
		t.Fatalf("unusable source must be flagged: %+v", meta)
	}
	// The source bytes are never touched.
	stored, err := os.ReadFile(paths.SubSourcePath(singBoxSub.ID))
	if err != nil {
		t.Fatal(err)
	}
	if string(stored) != singBoxSource {
		t.Fatalf("migration must not convert source bytes, got: %s", stored)
	}
}
