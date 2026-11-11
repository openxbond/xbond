package atomicfile

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// Write replaces a file only after the complete new content has been flushed.
func Write(name string, data []byte, mode fs.FileMode) (err error) {
	file, err := os.CreateTemp(filepath.Dir(name), ".xbond-write-*")
	if err != nil {
		return err
	}
	defer func() {
		_ = file.Close()
		if removeErr := os.Remove(file.Name()); removeErr != nil && !errors.Is(removeErr, fs.ErrNotExist) {
			err = errors.Join(err, removeErr)
		}
	}()
	if err := file.Chmod(mode); err != nil {
		return err
	}
	if _, err := file.Write(data); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), name)
}
