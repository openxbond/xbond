package daemon

import (
	"os"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/engine"

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

// Deployment-environment overrides win over the stored file and over fresh
// defaults; an invalid value refuses to start instead of silently defaulting.
func TestEnvOverridesDriveHeadlessPreferences(t *testing.T) {
	t.Run("fresh defaults with env", func(t *testing.T) {
		t.Setenv("XBOND_DATA_DIR", t.TempDir())
		t.Setenv("XBOND_TAKEOVER_MODE", "port")
		t.Setenv("XBOND_ALLOW_LAN", "true")
		t.Setenv("XBOND_MIXED_PORT", "7890")
		preferences, err := LoadPreferences()
		if err != nil {
			t.Fatal(err)
		}
		if preferences.TakeoverMode != engine.ModePort || !preferences.AllowLan || preferences.MixedPort != 7890 || preferences.PortOverride != 7890 {
			t.Fatalf("env overrides not applied: %+v", preferences)
		}
	})

	t.Run("env wins over stored file", func(t *testing.T) {
		t.Setenv("XBOND_DATA_DIR", t.TempDir())
		stored := []byte(`{"takeoverMode":"sysproxy","routingMode":"rule","mixedPort":10808,"allowLan":false,"clashPort":19090,"clashSecret":"fixture-secret","portOverride":10808,"portSource":"override"}`)
		if err := os.WriteFile(paths.RuntimeStatePath(), stored, 0o600); err != nil {
			t.Fatal(err)
		}
		t.Setenv("XBOND_TAKEOVER_MODE", "port")
		t.Setenv("XBOND_ALLOW_LAN", "true")
		t.Setenv("XBOND_MIXED_PORT", "7890")
		preferences, err := LoadPreferences()
		if err != nil {
			t.Fatal(err)
		}
		if preferences.TakeoverMode != engine.ModePort || !preferences.AllowLan || preferences.MixedPort != 7890 {
			t.Fatalf("env did not win over stored file: %+v", preferences)
		}
	})

	t.Run("invalid env refuses to start", func(t *testing.T) {
		t.Setenv("XBOND_DATA_DIR", t.TempDir())
		t.Setenv("XBOND_TAKEOVER_MODE", "teleport")
		if _, err := LoadPreferences(); err == nil || !strings.Contains(err.Error(), "XBOND_TAKEOVER_MODE") {
			t.Fatalf("invalid mode must name the variable: %v", err)
		}
	})
}

// 只读诊断不得有副作用：daemon 挂着占住 clash 端口时，会改写状态的加载器
// 会重新选端口并落盘，把活进程还在用的记录改掉（审计 #16）。
func TestLoadPreferencesReadOnlyDoesNotPersist(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	prefs := DefaultPreferences()
	prefs.ClashPort = 9090
	if err := savePreferences(prefs); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(paths.RuntimeStatePath())
	if err != nil {
		t.Fatal(err)
	}

	loaded, err := LoadPreferencesReadOnly()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ClashPort != 9090 {
		t.Fatalf("read-only load must report the stored port, got %d", loaded.ClashPort)
	}
	after, err := os.ReadFile(paths.RuntimeStatePath())
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("read-only load rewrote runtime_state.json")
	}

	// The mutating loader still re-picks and persists (the legacy fixed
	// port is exactly what it exists to migrate away from).
	mutated, err := LoadPreferences()
	if err != nil {
		t.Fatal(err)
	}
	if mutated.ClashPort == 9090 {
		t.Fatal("the mutating loader must re-pick the legacy clash port")
	}
}
