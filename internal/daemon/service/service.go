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

func Install(exePath string) error { return installDaemon(exePath) }
func Uninstall() error             { return uninstallDaemon() }
func Start() error                 { return startDaemon() }
func Stop() error                  { return stopDaemon() }
func Installed() bool              { return daemonInstalled() }

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
