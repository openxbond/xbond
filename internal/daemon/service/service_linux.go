//go:build linux

package service

import (
	"fmt"
	"os"
	"path/filepath"
)

func userUnitPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to resolve home directory: %w", err)
	}
	return filepath.Join(home, ".config", "systemd", "user", linuxUnitName), nil
}

func installDaemon(exePath string) error {
	unitPath, err := userUnitPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(unitPath), 0o755); err != nil {
		return fmt.Errorf("failed to create systemd user directory: %w", err)
	}
	if err := os.WriteFile(unitPath, []byte(SystemdUnitContent(exePath)), 0o644); err != nil {
		return fmt.Errorf("failed to write unit file: %w", err)
	}
	// enable --now registers autostart and starts the daemon in one step.
	if err := run("systemctl", "--user", "daemon-reload"); err != nil {
		return err
	}
	return run("systemctl", "--user", "enable", "--now", linuxUnitName)
}

func uninstallDaemon() error {
	unitPath, err := userUnitPath()
	if err != nil {
		return err
	}
	// Tolerate a missing unit: uninstall must converge on "not installed".
	_ = run("systemctl", "--user", "disable", "--now", linuxUnitName)
	if err := os.Remove(unitPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove unit file: %w", err)
	}
	return run("systemctl", "--user", "daemon-reload")
}

func startDaemon() error {
	return run("systemctl", "--user", "start", linuxUnitName)
}

func stopDaemon() error {
	return run("systemctl", "--user", "stop", linuxUnitName)
}

func daemonInstalled() bool {
	unitPath, err := userUnitPath()
	if err != nil {
		return false
	}
	_, err = os.Stat(unitPath)
	return err == nil
}
