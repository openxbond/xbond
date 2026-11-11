//go:build !windows

package upgrade

import (
	"errors"
	"os"
	"syscall"
)

func lock(file *os.File) error {
	err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if errors.Is(err, syscall.EWOULDBLOCK) {
		return errors.New("another XBond upgrade is in progress")
	}
	return err
}
