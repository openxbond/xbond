package sysproxy

import (
	"os"
	"testing"
	"time"

	"github.com/openxbond/xbond/internal/platform/paths"
)

func TestSnapshotLifecycle(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "xbond-sysproxy-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)
	t.Setenv("XBOND_DATA_DIR", tempDir)

	snap := Snapshot{
		Enabled:   true,
		Server:    "127.0.0.1:7890",
		Bypass:    "localhost;127.*",
		Timestamp: time.Now().Unix(),
	}

	if err := SaveSnapshot(snap); err != nil {
		t.Fatalf("SaveSnapshot failed: %v", err)
	}

	loaded, err := LoadSnapshot()
	if err != nil {
		t.Fatalf("LoadSnapshot failed: %v", err)
	}
	if !loaded.Enabled || loaded.Server != "127.0.0.1:7890" {
		t.Errorf("loaded snapshot mismatch: %+v", loaded)
	}

	ClearSnapshot()
	if _, err := LoadSnapshot(); err == nil {
		t.Errorf("expected error after ClearSnapshot, got nil")
	}
}

func TestCorruptRecoverySnapshotIsPreservedAndReported(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	if err := os.WriteFile(paths.SysproxySnapshotPath(), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := AutoRecoverOnStartup(); err == nil {
		t.Fatal("corrupt recovery state was ignored")
	}
	if _, err := os.Stat(paths.SysproxySnapshotPath()); err != nil {
		t.Fatal("unrestored recovery state was deleted")
	}
}

func TestParseNetworksetupWebProxy(t *testing.T) {
	enabled, host, port := parseNetworksetupWebProxy(
		"Enabled: Yes\nServer: 127.0.0.1\nPort: 7890\nAuthenticated Proxy Enabled: 0\n")
	if !enabled || host != "127.0.0.1" || port != "7890" {
		t.Fatalf("enabled sample parsed wrong: %v %q %q", enabled, host, port)
	}
	enabled, host, port = parseNetworksetupWebProxy("Enabled: No\nServer: (null)\nPort: 0\n")
	if enabled {
		t.Fatal("disabled sample parsed as enabled")
	}
}

func TestParseNetworksetupBypassDomains(t *testing.T) {
	domains := parseNetworksetupBypassDomains("\n*.local\n169.254/16\n<direct>\ncompany.example\n")
	if len(domains) != 3 || domains[0] != "*.local" || domains[1] != "169.254/16" || domains[2] != "company.example" {
		t.Fatalf("bypass parse wrong: %v", domains)
	}
}

func TestParseGSettingsScalarAndArray(t *testing.T) {
	if got := parseGSettingsScalar("'127.0.0.1'\n"); got != "127.0.0.1" {
		t.Fatalf("scalar parse wrong: %q", got)
	}
	hosts := parseGSettingsStringArray("['localhost', '127.0.0.0/8', 'company.example']\n")
	if len(hosts) != 3 || hosts[0] != "localhost" || hosts[2] != "company.example" {
		t.Fatalf("array parse wrong: %v", hosts)
	}
	if hosts := parseGSettingsStringArray("@as []\n"); hosts != nil {
		t.Fatalf("empty array parse wrong: %v", hosts)
	}
}

func TestSplitJoinHostPort(t *testing.T) {
	host, port := splitHostPort("127.0.0.1:17890")
	if host != "127.0.0.1" || port != "17890" {
		t.Fatalf("split wrong: %q %q", host, port)
	}
	host, port = splitHostPort("proxy.lan")
	if host != "proxy.lan" || port != "7890" {
		t.Fatalf("default port wrong: %q %q", host, port)
	}
	if got := joinHostPort("proxy.lan", "8080"); got != "proxy.lan:8080" {
		t.Fatalf("join wrong: %q", got)
	}
	if got := joinHostPort("", "8080"); got != "" {
		t.Fatalf("empty host must stay empty: %q", got)
	}
}
