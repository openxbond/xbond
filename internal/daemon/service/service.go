// Package service hands xbond-daemon's lifecycle to a per-user supervisor,
// following the same client/daemon split as Tailscale: the CLI never spawns a
// bare daemon process, it manages the registered autostart entry instead.
// Linux uses a systemd user unit and macOS a LaunchAgent; Windows registers
// an HKCU Run value because scheduled-task creation requires elevation on
// Windows 11 24H2 and later. All three are user-scoped on purpose: the daemon
// owns per-user state (LOCALAPPDATA / XDG data dir) and per-user system proxy
// (HKCU / session settings), which a LocalSystem or root service could not
// touch. Privileged TUN support is layered on top later, not by moving the
// daemon out of the user session.
package service

import (
	"fmt"
	"os"
	"os/exec"
)

// Scope selects where the registration lives. user registers inside the
// current user session (user data dir, user-scoped system proxy); system
// registers a machine-level service. A scope must never be silently swapped
// for another: unsupported ones return an explicit error.
type Scope string

const (
	ScopeUser   Scope = "user"
	ScopeSystem Scope = "system"
)

func Install(exePath string, scope Scope) error {
	switch scope {
	case ScopeUser:
		return installDaemon(exePath)
	case ScopeSystem:
		// Explicit, never downgraded to user: the machine service backend
		// (kardianos/service) is a separate slice per the daemon spec.
		return fmt.Errorf("scope %q is not available in this build yet (see docs/specs/daemon-runtime.md)", scope)
	default:
		return fmt.Errorf("unknown scope %q (want %q or %q)", scope, ScopeUser, ScopeSystem)
	}
}
func Uninstall() error { return uninstallDaemon() }
func Start() error     { return startDaemon() }
func Stop() error      { return stopDaemon() }
func Installed() bool  { return daemonInstalled() }

// SelfPath resolves the running xbond binary; the service registrations all
// point at "<self> daemon", so install always registers the binary the user
// actually invoked.
func SelfPath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("failed to resolve executable path: %w", err)
	}
	return exe, nil
}

// run executes a supervisor command and surfaces its combined output, so a
// failed systemctl/schtasks call names what the platform actually said.
func run(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s failed: %w: %s", name, args[0], err, out)
	}
	return nil
}
