package service

import (
	"errors"
	"fmt"
	"os/exec"
)

func isMachineAdministrator() (bool, error) { return isElevated() }

func elevateMachineUpgrade(executable, origin, version string) error {
	args := []string{"daemon", "system-upgrade", origin, version}
	admin, err := isElevated()
	if err != nil {
		return err
	}
	if admin {
		out, err := exec.Command(executable, args...).CombinedOutput()
		if err != nil {
			return fmt.Errorf("machine upgrade: %w: %s", err, out)
		}
		return nil
	}

	code, err := runElevatedWindowsCommand(executable, args)
	if err != nil {
		if errors.Is(err, errElevationDeclined) {
			return errors.New("machine upgrade authorization was declined")
		}
		return fmt.Errorf("machine upgrade: %w", err)
	}
	if code != 0 {
		return fmt.Errorf("the elevated machine updater failed (exit %d)", code)
	}
	return nil
}
