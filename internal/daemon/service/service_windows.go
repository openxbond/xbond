//go:build windows

package service

import (
	"fmt"
	"os/exec"

	"golang.org/x/sys/windows/registry"
)

// Per-user autostart lives in the HKCU Run key: every scheduled-task creation
// path (schtasks, Register-ScheduledTask, any folder) requires elevation on
// Windows 11 24H2 and later, while a Run value is always writable by the
// user and launches the daemon at logon. The value launches
// `xbond-daemon --background`, the same line a logon task would run.
const (
	runKeyPath    = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValueName  = "XBondDaemon"
	daemonExeName = "xbond-daemon.exe"
)

func installDaemon(exePath string) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("failed to open Run key: %w", err)
	}
	defer k.Close()
	if err := k.SetStringValue(runValueName, WindowsRunValue(exePath)); err != nil {
		return fmt.Errorf("failed to write Run value: %w", err)
	}
	// Registering autostart does not start anything mid-session; bring the
	// daemon up right away so install matches the other platforms.
	return startDaemon()
}

func uninstallDaemon() error {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("failed to open Run key: %w", err)
	}
	defer k.Close()
	if err := k.DeleteValue(runValueName); err != nil {
		// Tolerate an already-missing value so uninstall converges on "gone".
		if _, _, gerr := k.GetStringValue(runValueName); gerr != nil {
			return nil
		}
		return fmt.Errorf("failed to delete Run value: %w", err)
	}
	return nil
}

func startDaemon() error {
	// The Run key only fires at logon; mid-session there is no supervisor to
	// ask, so launching the registered command directly is the equivalent.
	// The process is a detached daemon that outlives this CLI, and the
	// LocalAPI shutdown endpoint (xbond service stop) is the graceful exit.
	selfPath, err := SelfPath()
	if err != nil {
		return err
	}
	cmd := exec.Command(selfPath, "daemon", "--background")
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to launch xbond daemon: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

// stopDaemon has nothing to unregister: the graceful stop is the LocalAPI
// shutdown endpoint, called by xbond service stop before this would run.
func stopDaemon() error {
	return nil
}

func daemonInstalled() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	_, _, err = k.GetStringValue(runValueName)
	return err == nil
}
