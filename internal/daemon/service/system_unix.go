//go:build darwin || linux

package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/openxbond/xbond/internal/upgrade"
)

func isMachineAdministrator() (bool, error) { return os.Geteuid() == 0, nil }

func validateMachineEntry(path string, directory bool, permissions os.FileMode) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	mode := info.Mode()
	regular := mode.IsRegular()
	if directory {
		regular = mode.IsDir()
	}
	if !ok || stat.Uid != 0 || !regular || mode.Perm() != permissions {
		return fmt.Errorf("unexpected ownership or permissions for machine path: %s", path)
	}
	return nil
}

func validateMachineDirectory(path string) error {
	return validateMachineEntry(path, true, 0o755)
}

func validateMachineStateDirectory(path string) error {
	return validateMachineEntry(path, true, 0o700)
}

func validateMachineFile(path string) error {
	if path == filepath.Join(filepath.Dir(path), machineOwnerFile) {
		return validateMachineEntry(path, false, 0o644)
	}
	return validateMachineEntry(path, false, 0o755)
}

func protectMachineCandidate(path string) error {
	return validateMachineEntry(path, false, 0o755)
}

func resolveMachineUpdater(installation MachineInstallation) (string, error) {
	return installation.Binary, nil
}

func prepareMachineUpdater(MachineInstallation, string) (func() error, error) {
	return func() error { return nil }, nil
}

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

// The elevated script copies into a root-owned directory before registration.
// Recheck the checksum there, since the originating executable can live in
// a directory the caller can write while the authorization dialog is open.
func installUnixSystemBinary(source, target, registration, group, stat, hash string) (string, error) {
	source, err := filepath.EvalSymlinks(source)
	if err != nil {
		return "", err
	}
	checksum, err := upgrade.Checksum(source)
	if err != nil {
		return "", err
	}
	owner, err := machineOwner(source)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(`set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
umask 022
dir=%s
target=%s
source=%s
expected=%s
if [ -L "$dir" ] || [ -L "$target" ]; then
  echo "The machine binary location contains a symlink" >&2
  exit 1
fi
if [ ! -e "$dir" ]; then
  install -d -o root -g %s -m 0755 "$dir"
fi
if [ ! -d "$dir" ] || [ "$(%s "$dir")" != "0:755" ]; then
  echo "The machine binary directory must be owned and writable only by root" >&2
  exit 1
fi
lock="$dir/.install-lock"
if ! mkdir "$lock"; then
  echo "The machine service is already being installed" >&2
  exit 1
fi
candidate=
trap 'if [ -n "$candidate" ]; then rm -f "$candidate"; fi; rmdir "$lock"' EXIT
if [ -e %s ] || [ -L %s ]; then
  echo "The machine service was registered concurrently" >&2
  exit 1
fi
if [ -e "$target" ] && [ ! -f "$target" ]; then
  echo "The machine binary target is not a regular file" >&2
  exit 1
fi
candidate=$(mktemp "$dir/.install.XXXXXXXX")
install -o root -g %s -m 0755 "$source" "$candidate"
digest=$(%s "$candidate")
if [ "${digest%%%% *}" != "$expected" ]; then
  echo "The source executable changed while installing the machine service" >&2
  exit 1
fi
mv -f "$candidate" "$target"
candidate=$(mktemp "$dir/.owner.XXXXXXXX")
printf '%%s' %s > "$candidate"
chmod 0644 "$candidate"
mv -f "$candidate" "$dir/%s"
`, shellQuote(filepath.Dir(target)), shellQuote(target), shellQuote(source), shellQuote(checksum),
		group, stat, shellQuote(registration), shellQuote(registration), group, hash, shellQuote(owner), machineOwnerFile), nil
}
