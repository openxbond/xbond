package daemon

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// The instance lock guarantees one daemon per data directory: it is acquired
// before proxy recovery and discovery-file writes, so a second instance can
// never fight over ports, system proxy, or the credential files. The OS
// releases the lock when the process dies, so a crash leaves no stale lock.

const lockFileName = "daemon.lock"

// errLockHeld is returned when another process owns the lock. Callers match
// on errors.Is: only this condition means "a daemon is alive", everything
// else is an environment failure.
var errLockHeld = errors.New("another xbond daemon instance owns this state directory")

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

// InstanceLockHeld reports whether a live process holds the daemon's instance
// lock. A free lock means no daemon is running — the OS drops the lock on
// process death regardless of what the addr/token files still claim — so
// exit confirmation probes this instead of a LocalAPI call, which can fail
// while the process is hung and still alive.
func InstanceLockHeld(dir string) (bool, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return false, fmt.Errorf("failed to create state directory: %w", err)
	}
	lock, err := lockFile(filepath.Join(dir, lockFileName))
	if err != nil {
		if errors.Is(err, errLockHeld) {
			return true, nil
		}
		return false, err
	}
	lock.Release()
	return false, nil
}
