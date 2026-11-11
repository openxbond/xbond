//go:build !windows && !darwin && !linux

package sysproxy

import (
	"fmt"
	"time"
)

func Get() (Snapshot, error) {
	return Snapshot{Enabled: false, Timestamp: time.Now().Unix()}, nil
}

func Set(server string, bypass string) error {
	return fmt.Errorf("system proxy is unsupported on this platform")
}

func Disable() error {
	ClearSnapshot()
	return nil
}

func Restore(snapshot Snapshot) error {
	if snapshot.Enabled {
		if snapshot.Server == "" {
			return fmt.Errorf("system proxy snapshot has no server")
		}
		return Set(snapshot.Server, snapshot.Bypass)
	}
	return Disable()
}
