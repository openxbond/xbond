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
		if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
			return filepath.Join(localAppData, "xbond")
		}
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "AppData", "Local", "xbond")
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

func SubMetaPath(id string) string {
	return filepath.Join(SubDir(id), "meta.json")
}

func SubRuntimePath(id string) string {
	return filepath.Join(SubDir(id), "config.runtime.json")
}

func SubListPath() string {
	return filepath.Join(DataDir(), "subscriptions.json")
}

func RuntimeStatePath() string {
	return filepath.Join(DataDir(), "runtime_state.json")
}

func SysproxySnapshotPath() string {
	return filepath.Join(DataDir(), "sysproxy.snapshot.json")
}

func LocalAPITokenPath() string {
	return filepath.Join(DataDir(), "localapi.token")
}

func LocalAPIAddrPath() string {
	return filepath.Join(DataDir(), "localapi.addr")
}

func DaemonLogPath() string {
	return filepath.Join(DataDir(), "daemon.log")
}
