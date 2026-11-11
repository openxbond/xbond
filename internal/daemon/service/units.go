package service

import (
	"fmt"
	"strings"
)

// Supervisor artefact names, shared by the platform implementations and the
// content builders below.
const (
	linuxUnitName = "xbond-daemon.service"
	darwinLabel   = "net.xbond.daemon"
	// darwinSystemLabel is the machine-scoped daemon's launchd label; its
	// plist lives in /Library/LaunchDaemons under the same name.
	darwinSystemLabel   = "net.xbond.daemon-system"
	darwinSystemDataDir = "/Library/Application Support/xbond-system"
	darwinSystemPlist   = "/Library/LaunchDaemons/net.xbond.daemon-system.plist"
	darwinSystemExe     = "/Library/PrivilegedHelperTools/net.xbond.daemon/xbond"
)

// SystemdUnitContent renders the systemd user unit for the daemon. The unit
// starts at login (default.target) and restarts on failure; a clean exit via
// the LocalAPI shutdown endpoint keeps it stopped on purpose.
func SystemdUnitContent(exePath string) string {
	return fmt.Sprintf(`[Unit]
Description=XBond background daemon
After=network-online.target

[Service]
ExecStart=%s daemon
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`, exePath)
}

// Linux machine-scoped daemon: a root systemd system unit whose state lives
// outside any user profile.
const (
	linuxSystemUnitName = "xbond-daemon-system.service"
	linuxSystemUnitPath = "/etc/systemd/system/xbond-daemon-system.service"
	linuxSystemDataDir  = "/var/lib/xbond-system"
	linuxSystemExe      = "/usr/lib/xbond/xbond"
)

// SystemdSystemUnitContent renders the machine-scoped daemon's system unit.
// Restart=always: the privileged tunnel host comes back whatever its exit
// code, since nothing else restarts it; the delegating daemon's reconciler
// re-applies the delegated config afterwards.
func SystemdSystemUnitContent(exePath string) string {
	return fmt.Sprintf(`[Unit]
Description=XBond privileged tunnel service
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="%s" daemon --service-run --listen %s --data-dir %s
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
`, exePath, SystemListen, linuxSystemDataDir)
}

// LaunchAgentPlistContent renders the launchd agent property list. RunAtLoad
// starts the daemon at login; KeepAlive brings it back after a crash but a
// clean shutdown exit (0) stays down.
func LaunchAgentPlistContent(exePath string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>%s</string>
    <key>ProgramArguments</key>
    <array>
        <string>%s</string>
        <string>daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
`, darwinLabel, xmlEscape(exePath))
}

// LaunchDaemonPlistContent renders the machine-scoped daemon's property
// list (installed into /Library/LaunchDaemons by the elevated installer).
// Unconditional KeepAlive: the privileged tunnel host comes back whatever
// its exit code, because unlike the user agent nothing else restarts it.
func LaunchDaemonPlistContent(exePath string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>%s</string>
    <key>ProgramArguments</key>
    <array>
        <string>%s</string>
        <string>daemon</string>
        <string>--service-run</string>
        <string>--listen</string>
        <string>%s</string>
        <string>--data-dir</string>
        <string>%s</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
`, darwinSystemLabel, xmlEscape(exePath), SystemListen, xmlEscape(darwinSystemDataDir))
}

// WindowsRunValue renders the HKCU Run value that launches the daemon at
// logon. The executable is quoted so paths with spaces survive the registry
// value's command line parsing; --background hides the console window the
// logon launch would otherwise flash.
func WindowsRunValue(exePath string) string {
	return fmt.Sprintf(`"%s" daemon --background`, exePath)
}

func xmlEscape(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&apos;",
	)
	return r.Replace(s)
}
