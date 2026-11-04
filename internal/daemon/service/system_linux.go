//go:build linux

package service

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

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
	script := fmt.Sprintf(`set -e
mkdir -p %[1]s
cat > %[2]s <<'XBOND_UNIT_EOF'
%[3]sXBOND_UNIT_EOF
printf '%%s' '%[4]d' > %[1]s/delegated-user
chmod 644 %[2]s %[1]s/delegated-user
systemctl daemon-reload
systemctl enable %[5]s
systemctl restart %[5]s
`,
		shellQuote(linuxSystemDataDir),
		shellQuote(linuxSystemUnitPath),
		SystemdSystemUnitContent(exePath),
		os.Getuid(),
		linuxSystemUnitName,
	)
	return elevateScript(script)
}

func uninstallSystemScope() error {
	script := fmt.Sprintf(`systemctl disable --now %[1]s 2>/dev/null || true
rm -f %[2]s
systemctl daemon-reload
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
		cmd = exec.Command("pkexec", "sh", "-c", script)
	} else {
		cmd = exec.Command("sh", "-c", script)
	}
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
