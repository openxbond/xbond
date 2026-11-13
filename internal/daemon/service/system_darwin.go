//go:build darwin

package service

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func machinePaths() (MachineInstallation, error) {
	return MachineInstallation{Binary: darwinSystemExe, DataDir: darwinSystemDataDir, Updater: darwinSystemExe}, nil
}

func machineRegistrationMatches(installation MachineInstallation) (bool, error) {
	_, matches, err := checkRegistration(darwinSystemPlist, LaunchDaemonPlistContent(installation.Binary))
	return matches, err
}

func elevateMachineUpgrade(executable, origin, version string) error {
	return elevateScript("XBond wants to update its privileged tunnel service.",
		"exec "+shellQuote(executable)+" daemon system-upgrade "+shellQuote(origin)+" "+shellQuote(version))
}

// The machine-scoped daemon is a root LaunchDaemon: TUN takeover needs an
// elevated session that survives logout, while the user-session daemon
// stays unprivileged so per-user state and system proxy keep working. The
// installer elevates the install script itself through osascript's
// administrator-privileges dialog — the standard macOS authorization prompt
// — and records the invoking uid so the daemon's unix-socket transport can
// admit exactly that account as delegator.

func systemInstalled() bool {
	_, err := os.Stat(darwinSystemPlist)
	return err == nil
}

func systemStatus() (string, error) {
	if !systemInstalled() {
		return "not installed", nil
	}
	// `launchctl print` exits 0 only for a job the system domain knows; a
	// plist without a loaded job reports honestly as installed-but-down.
	if err := run("launchctl", "print", "system/"+darwinSystemLabel); err != nil {
		if strings.Contains(err.Error(), "No such process") {
			return "installed, not running", nil
		}
		return "installed, state unknown", nil
	}
	return "running", nil
}

func installSystemScope(exePath string) error {
	registered, managed, err := checkRegistration(darwinSystemPlist, LaunchDaemonPlistContent(darwinSystemExe))
	if err != nil {
		return err
	}
	if registered {
		if !managed {
			return fmt.Errorf("the existing machine service uses a different executable; remove its registration before installing this version")
		}
		return startSystemScope("")
	}
	binary, err := installUnixSystemBinary(exePath, darwinSystemExe, darwinSystemPlist, "wheel", "stat -f '%u:%Lp'", "shasum -a 256")
	if err != nil {
		return err
	}
	script := fmt.Sprintf(`%[5]s
if [ -L %[1]s ]; then exit 1; fi
install -d -o root -g wheel -m 0700 %[1]s
candidate=$(mktemp %[1]s/.delegation.XXXXXXXX)
printf '%%s' '%[4]d' > "$candidate"
mv -f "$candidate" %[1]s/delegated-user
cat > %[2]s <<'XBOND_PLIST_EOF'
%[3]sXBOND_PLIST_EOF
if ! launchctl bootstrap system %[2]s; then
  rm -f %[2]s
  exit 1
fi
`,
		shellQuote(darwinSystemDataDir),
		shellQuote(darwinSystemPlist),
		LaunchDaemonPlistContent(darwinSystemExe),
		os.Getuid(),
		binary,
	)
	return elevateScript("XBond wants to install its privileged tunnel service.", script)
}

func uninstallSystemScope() error {
	// The caller is the CLI process, never the launchd job, so the bootout
	// runs first and the script survives to remove every file — including the
	// machine binary, which plain app deletion would otherwise leave behind.
	script := fmt.Sprintf(`set -e
if launchctl print system/%[1]s >/dev/null 2>&1; then
  launchctl bootout system/%[1]s
fi
rm -f %[2]s %[3]s %[4]s %[5]s
rmdir --ignore-fail-on-non-empty %[6]s 2>/dev/null || true
`, darwinSystemLabel, shellQuote(darwinSystemPlist), shellQuote(darwinSystemExe),
		shellQuote(filepath.Join(filepath.Dir(darwinSystemExe), machineOwnerFile)),
		shellQuote(filepath.Join(filepath.Dir(darwinSystemExe), machineOwnerPathFile)),
		shellQuote(filepath.Dir(darwinSystemExe)))
	return elevateScript("XBond wants to remove its privileged tunnel service.", script)
}

func startSystemScope(string) error {
	script := fmt.Sprintf(`if launchctl print system/%[1]s >/dev/null 2>&1; then
  launchctl kickstart system/%[1]s
else
  launchctl bootstrap system %[2]s
fi
`, darwinSystemLabel, shellQuote(darwinSystemPlist))
	return elevateScript("XBond wants to start its privileged tunnel service.", script)
}

func stopSystemScope(string) error {
	script := fmt.Sprintf(`if launchctl print system/%[1]s >/dev/null 2>&1; then
  launchctl bootout system/%[1]s
fi
`, darwinSystemLabel)
	return elevateScript("XBond wants to stop its privileged tunnel service.", script)
}

// elevateScript runs one root shell script through osascript's standard
// authorization dialog. A declined prompt reports "declined" — the caller
// and the UI must be able to distinguish refusal from failure.
func elevateScript(prompt, script string) error {
	if os.Geteuid() == 0 {
		command := exec.Command("/bin/sh", "-c", script)
		command.Env = append(os.Environ(), "PATH=/usr/bin:/bin:/usr/sbin:/sbin")
		out, err := command.CombinedOutput()
		if err != nil {
			return fmt.Errorf("run machine action: %w: %s", err, strings.TrimSpace(string(out)))
		}
		return nil
	}
	out, err := exec.Command("/usr/bin/osascript",
		"-e", "on run argv",
		"-e", "do shell script (item 1 of argv) with administrator privileges with prompt (item 2 of argv)",
		"-e", "end run",
		"--", script, prompt,
	).CombinedOutput()
	if err == nil {
		return nil
	}
	message := string(out)
	if strings.Contains(message, "-128") || strings.Contains(message, "User canceled") {
		return fmt.Errorf("authorization was declined; nothing changed")
	}
	return fmt.Errorf("osascript: %w: %s", err, message)
}
