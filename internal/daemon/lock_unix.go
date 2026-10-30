//go:build !windows

package daemon

import (
	"fmt"
	"os"
	"syscall"
)

func lockFile(path string) (*instanceLock, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("failed to open lock file: %w", err)
	}
	// Non-blocking: a second daemon must fail fast with a clear message, not
	// queue behind the first.
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, fmt.Errorf("another xbond daemon instance owns this state directory (%s)", path)
	}
	return &instanceLock{release: func() {
		syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}}, nil
}
