//go:build darwin || linux

package service

import (
	"fmt"
	"strings"
)

// Shared by the macOS LaunchDaemon and Linux systemd system-unit slices: the
// supervisor delivers SIGTERM on stop and has no stop callback, and the
// mutating actions elevate themselves, so the hidden `daemon system-action`
// verb (a Windows UAC continuation) simply dispatches.

// RunSystemService hosts the daemon under launchd/systemd. The supervisor
// restarts the process and its SIGTERM drives the same graceful shutdown path
// serveDaemon already handles from signals.
func RunSystemService(listen, webDir string, run func(stop <-chan struct{}) error) error {
	stop := make(chan struct{})
	return run(stop)
}

// SystemAction names the mutating system-scope operation.
type SystemAction string

const (
	SystemActionInstall   SystemAction = "system-install"
	SystemActionUninstall SystemAction = "system-uninstall"
	SystemActionStart     SystemAction = "system-start"
	SystemActionStop      SystemAction = "system-stop"
)

func RunSystemAction(exePath string, action SystemAction) error {
	switch action {
	case SystemActionInstall:
		return installSystemScope(exePath)
	case SystemActionUninstall:
		return uninstallSystemScope()
	case SystemActionStart:
		return startSystemScope(exePath)
	case SystemActionStop:
		return stopSystemScope(exePath)
	default:
		return fmt.Errorf("unknown system action %q", action)
	}
}

// SystemStatus reports the system-scope service state for status output.
func SystemStatus() (string, error) { return systemStatus() }

// ServiceSystemInstalled reports whether the machine daemon is registered.
func ServiceSystemInstalled() bool { return systemInstalled() }

// shellQuote makes a value safe inside a single-quoted sh word.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
