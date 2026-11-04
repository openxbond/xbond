//go:build windows

package service

import (
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
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
	return startRegisteredUser(exePath)
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
	value, err := registeredUserCommand()
	if err != nil {
		return err
	}
	args, err := windows.DecomposeCommandLine(value)
	if err != nil {
		return fmt.Errorf("parse daemon Run value: %w", err)
	}
	if len(args) != 3 || args[1] != "daemon" || args[2] != "--background" {
		return errors.New("unexpected daemon Run value")
	}
	return startRegisteredUser(args[0])
}

func startRegisteredUser(exePath string) error {
	cmd := backgroundCommand(exePath)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to launch xbond daemon: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

// backgroundCommand launches the daemon without inheriting the CLI console.
// Without CREATE_NO_WINDOW the child shares the parent terminal, and
// --background's hideConsoleWindow() would hide the user's terminal instead
// of a daemon-owned console.
func backgroundCommand(exePath string) *exec.Cmd {
	cmd := exec.Command(exePath, "daemon", "--background")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.CREATE_NO_WINDOW,
	}
	return cmd
}

// stopDaemon has nothing to unregister: the graceful stop is the LocalAPI
// shutdown endpoint, called by xbond service stop before this would run.
func stopDaemon() error {
	return nil
}

func daemonInstalled() bool {
	_, err := registeredUserCommand()
	return err == nil
}

func registeredUserCommand() (string, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.QUERY_VALUE)
	if err != nil {
		return "", err
	}
	defer key.Close()
	value, _, err := key.GetStringValue(runValueName)
	return value, err
}

func userRegistration(exe string) (bool, bool, error) {
	value, err := registeredUserCommand()
	if errors.Is(err, registry.ErrNotExist) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	return true, strings.EqualFold(value, WindowsRunValue(exe)), nil
}

func systemRegistration(exe string) (bool, bool, error) {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Services\`+systemServiceName, registry.QUERY_VALUE)
	if errors.Is(err, registry.ErrNotExist) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	defer key.Close()
	value, _, err := key.GetStringValue("ImagePath")
	if err != nil {
		return false, false, err
	}
	args, err := windows.DecomposeCommandLine(value)
	if err != nil {
		return false, false, fmt.Errorf("invalid machine service registration: %w", err)
	}
	if len(args) == 0 {
		return false, false, errors.New("empty machine service registration")
	}
	return true, strings.EqualFold(args[0], exe), nil
}
