package service

import (
	"strings"
	"testing"
)

func TestSystemdUnitContentDeclaresLifecycle(t *testing.T) {
	unit := SystemdUnitContent("/opt/xbond/xbond")
	for _, want := range []string{
		"Description=XBond background daemon",
		"ExecStart=/opt/xbond/xbond daemon",
		"Restart=on-failure",
		"WantedBy=default.target",
	} {
		if !strings.Contains(unit, want) {
			t.Errorf("systemd unit missing %q:\n%s", want, unit)
		}
	}
}

func TestLaunchAgentPlistContentDeclaresLifecycleAndEscapesPath(t *testing.T) {
	plist := LaunchAgentPlistContent("/opt/xbond & co/xbond")
	for _, want := range []string{
		"<key>Label</key>",
		darwinLabel,
		"<key>RunAtLoad</key>",
		"/opt/xbond &amp; co/xbond",
		"<string>daemon</string>",
	} {
		if !strings.Contains(plist, want) {
			t.Errorf("LaunchAgent plist missing %q:\n%s", want, plist)
		}
	}
	if strings.Contains(plist, " & co") {
		t.Error("plist contains unescaped ampersand")
	}
}

func TestWindowsRunValueQuotesExecutable(t *testing.T) {
	got := WindowsRunValue(`C:\Program Files\xbond\xbond.exe`)
	if want := `"C:\Program Files\xbond\xbond.exe" daemon --background`; got != want {
		t.Errorf("Run value %q does not match %q", got, want)
	}
}

func TestSystemdSystemUnitContentRunsPrivilegedHost(t *testing.T) {
	unit := SystemdSystemUnitContent("/opt/xbond co/xbond")
	for _, want := range []string{
		`ExecStart="/opt/xbond co/xbond" daemon --service-run --listen ` + SystemListen + ` --data-dir ` + linuxSystemDataDir,
		"Restart=always",
		"WantedBy=multi-user.target",
	} {
		if !strings.Contains(unit, want) {
			t.Errorf("system unit missing %q:\n%s", want, unit)
		}
	}
}
