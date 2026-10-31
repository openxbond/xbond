package daemon

import (
	"os"
	"testing"

	"github.com/openxbond/xbond/internal/platform/paths"
)

func TestPreferencesFailOnCorruptionInsteadOfSilentlyResetting(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	preferences, err := LoadPreferences()
	if err != nil || preferences.MixedPort != defaultMixedPort {
		t.Fatal("missing preferences should use initial defaults")
	}
	if preferences.PortOverride != 0 {
		t.Fatal("fresh installs follow the subscription instead of fixing a port")
	}
	if err := os.WriteFile(paths.RuntimeStatePath(), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadPreferences(); err == nil {
		t.Fatal("corrupt persisted preferences were silently replaced by defaults")
	}
}

// State files written before port following had no portOverride key and
// their MixedPort was the fixed port; it carries over as an explicit
// override so an upgrade never moves a working proxy port.
func TestLegacyPreferencesCarryTheirFixedPortAsOverride(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	legacy := []byte(`{"takeoverMode":"sysproxy","routingMode":"rule","mixedPort":10808,"allowLan":false,"clashPort":19090,"clashSecret":"fixture-secret"}`)
	if err := os.WriteFile(paths.RuntimeStatePath(), legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	preferences, err := LoadPreferences()
	if err != nil {
		t.Fatal(err)
	}
	if preferences.MixedPort != 10808 || preferences.PortOverride != 10808 || preferences.PortSource != PortSourceOverride {
		t.Fatalf("legacy fixed port must survive as an explicit override: %+v", preferences)
	}
}
