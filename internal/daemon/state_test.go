package daemon

import (
	"os"
	"testing"

	"github.com/openxbond/xbond/internal/platform/paths"
)

func TestPreferencesFailOnCorruptionInsteadOfSilentlyResetting(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	preferences, err := LoadPreferences()
	if err != nil || preferences.MixedPort != 7890 {
		t.Fatal("missing preferences should use initial defaults")
	}
	if err := os.WriteFile(paths.RuntimeStatePath(), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadPreferences(); err == nil {
		t.Fatal("corrupt persisted preferences were silently replaced by defaults")
	}
}
