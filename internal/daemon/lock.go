package daemon

import (
	"fmt"
	"os"
	"path/filepath"
)

// The instance lock guarantees one daemon per data directory: it is acquired
// before proxy recovery and discovery-file writes, so a second instance can
// never fight over ports, system proxy, or the credential files. The OS
// releases the lock when the process dies, so a crash leaves no stale lock.

const lockFileName = "daemon.lock"

type instanceLock struct {
	release func()
}

func (l *instanceLock) Release() {
	if l != nil && l.release != nil {
		l.release()
	}
}

func acquireInstanceLock(dir string) (*instanceLock, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("failed to create state directory: %w", err)
	}
	return lockFile(filepath.Join(dir, lockFileName))
}
