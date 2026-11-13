package paths

import (
	"os"
	"path/filepath"
	"runtime"
)

func DataDir() string {
	if custom := os.Getenv("XBOND_DATA_DIR"); custom != "" {
		return custom
	}

	switch runtime.GOOS {
	case "windows":
		// Roaming AppData, deliberately NOT the NSIS per-user install dir
		// (%LOCALAPPDATA%\XBond): NTFS is case-insensitive, so the installer
		// would drop program files into the data directory, and its
		// uninstaller would wipe subscriptions, the account binding and
		// preferences with it.
		if appdata := os.Getenv("APPDATA"); appdata != "" {
			return filepath.Join(appdata, "xbond")
		}
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "AppData", "Roaming", "xbond")
	case "darwin":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Library", "Application Support", "xbond")
	default:
		if xdgData := os.Getenv("XDG_DATA_HOME"); xdgData != "" {
			return filepath.Join(xdgData, "xbond")
		}
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".local", "share", "xbond")
	}
}

func EnsureDirs() error {
	dirs := []string{
		DataDir(),
		SubscriptionsDir(),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	return nil
}

func SubscriptionsDir() string {
	return filepath.Join(DataDir(), "subscriptions")
}

func SubDir(id string) string {
	return filepath.Join(SubscriptionsDir(), id)
}

func SubSourcePath(id string) string {
	return filepath.Join(SubDir(id), "config.source")
}

func SubRuntimePath(id string) string {
	return filepath.Join(SubDir(id), "config.runtime.json")
}

// SubOverridePath stores the subscription's structured local override, the
// layer between the downloaded source and derivation.
func SubOverridePath(id string) string {
	return filepath.Join(SubDir(id), "override.json")
}

// SubVersionsPath stores previous source snapshots for rollback.
func SubVersionsPath(id string) string {
	return filepath.Join(SubDir(id), "versions")
}

func SubListPath() string {
	return filepath.Join(DataDir(), "subscriptions.json")
}

func GlobalMixinPath() string {
	return filepath.Join(DataDir(), "mixin.json")
}

func RuntimeStatePath() string {
	return filepath.Join(DataDir(), "runtime_state.json")
}

func SysproxySnapshotPath() string {
	return filepath.Join(DataDir(), "sysproxy.snapshot.json")
}

func AccountSessionPath() string {
	return filepath.Join(DataDir(), "account.json")
}

// AccountOverviewPath caches the last fetched account overview (identity,
// service status, announcements) so the UI shows it instantly at boot and
// offline. Logout deletes it.
func AccountOverviewPath() string {
	return filepath.Join(DataDir(), "account-overview.json")
}

func LocalAPITokenPath() string {
	return filepath.Join(DataDir(), "localapi.token")
}

func LocalAPIAddrPath() string {
	return filepath.Join(DataDir(), "localapi.addr")
}

// DelegationGrantPath holds the SID (Windows) or uid (macOS) of the user
// account allowed to delegate TUN takeover to the machine-scoped daemon. The
// elevated installer writes it; the privileged transport reads it to decide
// who may connect.
func DelegationGrantPath() string {
	return filepath.Join(DataDir(), "delegated-user")
}
