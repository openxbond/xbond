package upgrade

import (
	"fmt"
	"os"
	"path/filepath"
)

// Lock serializes replacements across the standalone CLI and desktop shell.
// The OS releases the lock if the updater dies.
func Lock(dir string) (func(), error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(dir, "upgrade.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := lock(f); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("acquire upgrade lock: %w", err)
	}
	return func() { _ = f.Close() }, nil
}
