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
