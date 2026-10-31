package sub

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
	"gopkg.in/yaml.v3"
)

// MigrateLegacySources runs on daemon start after a core swap: stored
// sing-box JSON sources must become canonical Clash YAML before anything can
// derive a runtime config from them.
func TestMigrateLegacySources(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}

	const convertible = `{"outbounds":[{"type":"trojan","tag":"edge","server":"example.invalid","server_port":443,"password":"fixture-only"}]}`
	const withDNS = `{"outbounds":[{"type":"trojan","tag":"edge","server":"example.invalid","server_port":443,"password":"fixture-only"}],"dns":{"servers":["8.8.8.8"]}}`
	const unusable = `{"outbounds":[{"type":"hysteria2","tag":"edge","server":"example.invalid","server_port":443}]}`

	seed := func(name, content string) *SubscriptionMeta {
		t.Helper()
		meta, err := manager.AddUniversal(filepath.Join(paths.DataDir(), name+".yaml"), name, 24, false, false)
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

	strict := seed("strict_sub", convertible)
	fallback := seed("fallback_sub", withDNS)
	unusableSub := seed("unusable_sub", unusable)

	manager.MigrateLegacySources()

	assertMigrated := func(id string) {
		t.Helper()
		stored, err := os.ReadFile(paths.SubSourcePath(id))
		if err != nil {
			t.Fatal(err)
		}
		var doc struct {
			Proxies []map[string]any `yaml:"proxies"`
		}
		if err := yaml.Unmarshal(stored, &doc); err != nil || len(doc.Proxies) != 1 {
			t.Fatalf("%s was not migrated to Clash YAML: %s (%v)", id, stored, err)
		}
		if err := engine.Validate(stored); err != nil {
			t.Fatalf("%s migrated config is not usable: %v", id, err)
		}
	}
	assertMigrated(strict.ID)
	assertMigrated(fallback.ID)

	if meta, err := manager.Get(fallback.ID); err != nil || !meta.ClashNodesOnly {
		t.Fatalf("DNS-bearing source should fall back to node-only mode: %+v (%v)", meta, err)
	}
	if meta, err := manager.Get(strict.ID); err != nil || meta.ClashNodesOnly {
		t.Fatalf("convertible source should migrate strictly: %+v (%v)", meta, err)
	}

	unusableMeta, err := manager.Get(unusableSub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unusableMeta.Health != HealthTransientError || !strings.Contains(unusableMeta.LastErrorMessage, "migrate") {
		t.Fatalf("unconvertible source must be flagged for re-import: %+v", unusableMeta)
	}
	if stored, err := os.ReadFile(paths.SubSourcePath(unusableSub.ID)); err != nil || !isLegacySingBoxSource(stored) {
		t.Fatal("unconvertible source must be left untouched for re-import")
	}
}
