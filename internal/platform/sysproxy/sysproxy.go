package sysproxy

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/openxbond/xbond/internal/platform/atomicfile"
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
	return atomicfile.Write(paths.SysproxySnapshotPath(), data, 0o600)
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
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read system proxy recovery state: %w", err)
	}
	if err := Restore(*snap); err != nil {
		return fmt.Errorf("restore stale system proxy: %w", err)
	}
	if err := os.Remove(paths.SysproxySnapshotPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove system proxy recovery state: %w", err)
	}
	return nil
}
