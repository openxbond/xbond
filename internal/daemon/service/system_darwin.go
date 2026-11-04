//go:build darwin

package service

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

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
	script := fmt.Sprintf(`mkdir -p '%s'
cat > '%s' <<'XBOND_PLIST_EOF'
%sXBOND_PLIST_EOF
printf '%%s' '%d' > '%s/delegated-user'
chmod 644 '%s' '%s/delegated-user'
launchctl bootout system/%s 2>/dev/null || true
launchctl bootstrap system '%s'
`,
		shellQuote(darwinSystemDataDir),
		shellQuote(darwinSystemPlist),
		LaunchDaemonPlistContent(exePath),
		os.Getuid(),
		shellQuote(darwinSystemDataDir),
		shellQuote(darwinSystemPlist), shellQuote(darwinSystemDataDir),
		darwinSystemLabel,
		shellQuote(darwinSystemPlist),
	)
	return elevateScript("XBond wants to install its privileged tunnel service.", script)
}

func uninstallSystemScope() error {
	script := fmt.Sprintf(`launchctl bootout system/%s 2>/dev/null || true
rm -f '%s'
`, darwinSystemLabel, shellQuote(darwinSystemPlist))
	return elevateScript("XBond wants to remove its privileged tunnel service.", script)
}

func startSystemScope(string) error {
	script := fmt.Sprintf("launchctl kickstart system/%s\n", darwinSystemLabel)
	return elevateScript("XBond wants to start its privileged tunnel service.", script)
}

func stopSystemScope(string) error {
	script := fmt.Sprintf("launchctl kill SIGTERM system/%s 2>/dev/null || true\n", darwinSystemLabel)
	return elevateScript("XBond wants to stop its privileged tunnel service.", script)
}

// elevateScript runs one root shell script through osascript's standard
// authorization dialog. A declined prompt reports "declined" — the caller
// and the UI must be able to distinguish refusal from failure.
func elevateScript(prompt, script string) error {
	out, err := exec.Command("osascript", "-e",
		fmt.Sprintf("do shell script %s with administrator privileges with prompt %q", shellQuote(script), prompt),
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
