//go:build linux

package sysproxy

import (
	"fmt"
	"os/exec"
	"strings"
	"time"
)

func Get() (Snapshot, error) {
	modeOut, err := exec.Command("gsettings", "get", "org.gnome.system.proxy", "mode").Output()
	if err != nil {
		return Snapshot{}, err
	}
	snap := Snapshot{
		Enabled:   parseGSettingsScalar(string(modeOut)) == "manual",
		Timestamp: time.Now().Unix(),
	}
	if !snap.Enabled {
		return snap, nil
	}
	// Capture what a restore must put back: the server and the user's own
	// exception list. Without them an existing manual proxy blocks the
	// takeover gate and a restore clobbers the bypass domains.
	hostOut, err := exec.Command("gsettings", "get", "org.gnome.system.proxy.http", "host").Output()
	if err != nil {
		return Snapshot{}, err
	}
	portOut, err := exec.Command("gsettings", "get", "org.gnome.system.proxy.http", "port").Output()
	if err != nil {
		return Snapshot{}, err
	}
	ignoreOut, err := exec.Command("gsettings", "get", "org.gnome.system.proxy", "ignore-hosts").Output()
	if err != nil {
		return Snapshot{}, err
	}
	snap.Server = joinHostPort(parseGSettingsScalar(string(hostOut)), parseGSettingsScalar(string(portOut)))
	snap.Bypass = strings.Join(parseGSettingsStringArray(string(ignoreOut)), ";")
	return snap, nil
}

func Set(server string, bypass string) error {
	current, err := Get()
	if err != nil {
		return err
	}
	if err := SaveSnapshot(current); err != nil {
		return err
	}

	host, port := splitHostPort(server)

	for _, args := range [][]string{
		{"set", "org.gnome.system.proxy.http", "host", host},
		{"set", "org.gnome.system.proxy.http", "port", port},
		{"set", "org.gnome.system.proxy.https", "host", host},
		{"set", "org.gnome.system.proxy.https", "port", port},
	} {
		if err := exec.Command("gsettings", args...).Run(); err != nil {
			return fmt.Errorf("apply system proxy setting: %w", err)
		}
	}
	// Restore the exception list the snapshot captured (or clear it when
	// empty): leaving it untouched would keep the previous owner's bypass
	// domains pointing away from our proxy.
	quoted := []string{}
	for _, domain := range strings.Split(bypass, ";") {
		if domain = strings.TrimSpace(domain); domain != "" {
			quoted = append(quoted, "'"+domain+"'")
		}
	}
	ignoreHosts := "[" + strings.Join(quoted, ", ") + "]"
	if err := exec.Command("gsettings", "set", "org.gnome.system.proxy", "ignore-hosts", ignoreHosts).Run(); err != nil {
		return fmt.Errorf("apply system proxy bypass domains: %w", err)
	}
	return exec.Command("gsettings", "set", "org.gnome.system.proxy", "mode", "manual").Run()
}

func Disable() error {
	if err := exec.Command("gsettings", "set", "org.gnome.system.proxy", "mode", "none").Run(); err != nil {
		return err
	}
	ClearSnapshot()
	return nil
}

func Restore(snapshot Snapshot) error {
	if snapshot.Enabled {
		if snapshot.Server == "" {
			return fmt.Errorf("system proxy snapshot has no server")
		}
		return Set(snapshot.Server, snapshot.Bypass)
	}
	return Disable()
}
