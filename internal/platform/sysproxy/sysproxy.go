package sysproxy

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/openxbond/xbond/internal/platform/paths"
)

type Snapshot struct {
	Enabled   bool   `json:"enabled"`
	Server    string `json:"server"`
	Bypass    string `json:"bypass,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

func SaveSnapshot(snap Snapshot) error {
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(paths.SysproxySnapshotPath(), data, 0o600)
}

func LoadSnapshot() (*Snapshot, error) {
	data, err := os.ReadFile(paths.SysproxySnapshotPath())
	if err != nil {
		return nil, err
	}
	var snap Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return nil, err
	}
	return &snap, nil
}

func ClearSnapshot() {
	_ = os.Remove(paths.SysproxySnapshotPath())
}

func AutoRecoverOnStartup() error {
	snap, err := LoadSnapshot()
	if err != nil || snap == nil {
		return nil
	}

	if snap.Enabled {
		_ = Set(snap.Server, snap.Bypass)
	} else {
		_ = Disable()
	}
	ClearSnapshot()
	return fmt.Errorf("recovered stale system proxy from previous crash: enabled=%v, server=%s", snap.Enabled, snap.Server)
}
