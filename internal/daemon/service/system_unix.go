//go:build darwin || linux

package service

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

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
//
// Before hosting, an orphaned registration reclaims itself: when the binary
// that installed the machine service has been removed (app deleted — macOS
// drag-to-trash, AppImage, manual removal — on platforms whose uninstall has
// no hook surface), the registration must not resurrect at the next boot.
// While running, the ownership is re-checked hourly and the registration is
// reclaimed after two consecutive misses, so an upgrade's brief
// file-swap window never tears the tunnel down.
func RunSystemService(listen, webDir string, run func(stop <-chan struct{}) error) error {
	installation, err := machinePaths()
	if err != nil {
		return err
	}
	if vanish, err := machineOwnerVanished(filepath.Dir(installation.Binary)); err != nil {
		// 归属探测失败不拖垮隧道:如实记下,回收交给卸载面。
		fmt.Fprintf(os.Stderr, "xbond machine service: ownership probe failed: %v\n", err)
	} else if vanish {
		return reclaimOrphanedRegistration()
	}
	go watchMachineOwner(filepath.Dir(installation.Binary))
	stop := make(chan struct{})
	return run(stop)
}

// watchMachineOwner re-checks the installation ownership while the machine
// daemon serves; two consecutive misses mean the owning binary is really gone
// (not an in-flight upgrade) and the registration reclaims itself.
func watchMachineOwner(binaryDir string) {
	const (
		watchInterval = time.Hour
		watchStrikes  = 2
	)
	misses := 0
	for range time.Tick(watchInterval) {
		vanish, err := machineOwnerVanished(binaryDir)
		if err != nil {
			misses = 0
			continue
		}
		if !vanish {
			misses = 0
			continue
		}
		misses++
		if misses >= watchStrikes {
			_ = reclaimOrphanedRegistration()
			return
		}
	}
}

// reclaimOrphanedRegistration removes the machine registration from inside
// the daemon itself: the script-based uninstall cannot be reused because its
// stop step (systemctl disable --now / launchctl bootout) signals this very
// process and systemd's cgroup kill takes the calling tree with it before the
// file removal completes. Removing the files first and exiting is verified
// safe: once the unit definition is gone and daemon-reload has run, a
// Restart=always service that exits is not restarted (the definition no
// longer exists), and the ownership record — the file the reclaim fired on —
// is removed with the rest.
func reclaimOrphanedRegistration() error {
	fmt.Fprintln(os.Stderr, "xbond machine service: the installing application is gone; reclaiming the machine registration")
	installation, err := machinePaths()
	if err != nil {
		return err
	}
	dir := filepath.Dir(installation.Binary)
	removals := []string{
		installation.Binary,
		filepath.Join(dir, machineOwnerFile),
		filepath.Join(dir, machineOwnerPathFile),
	}
	if runtime.GOOS == "darwin" {
		removals = append(removals, darwinSystemPlist)
	} else {
		removals = append(removals, linuxSystemUnitPath,
			filepath.Join("/etc/systemd/system/multi-user.target.wants", linuxSystemUnitName))
	}
	for _, path := range removals {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	// 空目录顺手移除;用户放置过文件的目录则保留。
	if err := os.Remove(dir); err != nil && !errors.Is(err, os.ErrNotExist) {
		fmt.Fprintf(os.Stderr, "xbond machine service: remove %s: %v\n", dir, err)
	}
	if runtime.GOOS == "linux" {
		if err := exec.Command("systemctl", "daemon-reload").Run(); err != nil {
			fmt.Fprintf(os.Stderr, "xbond machine service: daemon-reload failed: %v\n", err)
		}
	}
	os.Exit(0)
	return nil
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
candidate=$(mktemp "$dir/.owner.XXXXXXXX")
printf '%%s' "$source" > "$candidate"
chmod 0644 "$candidate"
mv -f "$candidate" "$dir/%s"
`, shellQuote(filepath.Dir(target)), shellQuote(target), shellQuote(source), shellQuote(checksum),
		group, stat, shellQuote(registration), shellQuote(registration), group, hash, shellQuote(owner), machineOwnerFile, machineOwnerPathFile), nil
}
