//go:build !windows && !darwin && !linux

package sysproxy

import "time"

func Get() (Snapshot, error) {
	return Snapshot{Enabled: false, Timestamp: time.Now().Unix()}, nil
}

func Set(server string, bypass string) error {
	return nil
}

func Disable() error {
	ClearSnapshot()
	return nil
}
