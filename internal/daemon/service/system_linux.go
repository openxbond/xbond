//go:build linux

package service

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func machinePaths() (MachineInstallation, error) {
	return MachineInstallation{Binary: linuxSystemExe, DataDir: linuxSystemDataDir, Updater: linuxSystemExe}, nil
}

func machineRegistrationMatches(installation MachineInstallation) (bool, error) {
	_, matches, err := checkRegistration(linuxSystemUnitPath, SystemdSystemUnitContent(installation.Binary))
	return matches, err
}

func elevateMachineUpgrade(executable, origin, version string) error {
	return elevateScript("exec " + shellQuote(executable) + " daemon system-upgrade " + shellQuote(origin) + " " + shellQuote(version))
}

// The machine-scoped daemon is a root systemd system unit: TUN takeover needs
// root and a session that survives logout, while the user-session daemon
// stays unprivileged so per-user state and system proxy keep working. The
// installer elevates one shell script through pkexec (polkit's standard
// graphical authorization prompt) and records the invoking uid so the
// daemon's unix-socket transport can admit exactly that account as delegator.

func systemInstalled() bool {
	_, err := os.Stat(linuxSystemUnitPath)
	return err == nil
}

func systemStatus() (string, error) {
	if !systemInstalled() {
		return "not installed", nil
	}
	// is-active exits non-zero for any state but active; its stdout names the
	// state, which is the honest answer to report.
	out, _ := exec.Command("systemctl", "is-active", linuxSystemUnitName).Output()
	if state := strings.TrimSpace(string(out)); state == "active" {
		return "running", nil
	} else if state != "" {
		return "installed, " + state, nil
	}
	return "installed, state unknown", nil
}

func installSystemScope(exePath string) error {
	registered, managed, err := checkRegistration(linuxSystemUnitPath, SystemdSystemUnitContent(linuxSystemExe))
	if err != nil {
		return err
	}
	if registered {
		if !managed {
			return errors.New("the existing machine service uses a different executable; remove its registration before installing this version")
		}
		return startSystemScope("")
	}
	binary, err := installUnixSystemBinary(exePath, linuxSystemExe, linuxSystemUnitPath, "root", "stat -c '%u:%a'", "sha256sum")
	if err != nil {
		return err
	}
	script := fmt.Sprintf(`%[6]s
if [ -L %[1]s ]; then exit 1; fi
install -d -o root -g root -m 0700 %[1]s
candidate=$(mktemp %[1]s/.delegation.XXXXXXXX)
printf '%%s' '%[4]d' > "$candidate"
mv -f "$candidate" %[1]s/delegated-user
cat > %[2]s <<'XBOND_UNIT_EOF'
%[3]sXBOND_UNIT_EOF
systemctl daemon-reload
if ! systemctl enable --now %[5]s; then
  systemctl disable --now %[5]s || true
  rm -f %[2]s
  systemctl daemon-reload
  exit 1
fi
`,
		shellQuote(linuxSystemDataDir),
		shellQuote(linuxSystemUnitPath),
		SystemdSystemUnitContent(linuxSystemExe),
		os.Getuid(),
		linuxSystemUnitName,
		binary,
	)
	return elevateScript(script)
}

func uninstallSystemScope() error {
	script := fmt.Sprintf(`set -e
if [ -e %[2]s ] || [ -L %[2]s ]; then
  systemctl disable --now %[1]s
  rm -f %[2]s
  systemctl daemon-reload
fi
`, linuxSystemUnitName, shellQuote(linuxSystemUnitPath))
	return elevateScript(script)
}

func startSystemScope(string) error {
	return elevateScript(fmt.Sprintf("systemctl start %s\n", linuxSystemUnitName))
}

func stopSystemScope(string) error {
	return elevateScript(fmt.Sprintf("systemctl stop %s\n", linuxSystemUnitName))
}

// elevateScript runs one root shell script. Already root runs it directly;
// otherwise pkexec raises the desktop's authorization dialog. A dismissed
// prompt reports "declined" so the caller and UI can tell refusal from
// failure, and a missing pkexec / polkit agent names the manual fallback.
func elevateScript(script string) error {
	if os.Geteuid() == 0 {
		return runShell("sh", script)
	}
	if _, err := exec.LookPath("pkexec"); err != nil {
		return errors.New("pkexec (polkit) is not installed; run the same command as root: sudo xbond daemon <action> --scope system")
	}
	return runShell("pkexec", script)
}

func runShell(elevator, script string) error {
	var cmd *exec.Cmd
	if elevator == "pkexec" {
		cmd = exec.Command("pkexec", "/bin/sh", "-c", script)
	} else {
		cmd = exec.Command("/bin/sh", "-c", script)
	}
	cmd.Env = append(os.Environ(), "PATH=/usr/sbin:/usr/bin:/sbin:/bin")
	out, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	var exit *exec.ExitError
	if elevator == "pkexec" && errors.As(err, &exit) {
		switch exit.ExitCode() {
		case 126:
			return errors.New("authorization was declined; nothing changed")
		case 127:
			return fmt.Errorf("no polkit authentication agent is available; run as root: sudo xbond daemon <action> --scope system (%s)", strings.TrimSpace(string(out)))
		}
	}
	return fmt.Errorf("%s: %w: %s", elevator, err, strings.TrimSpace(string(out)))
}
