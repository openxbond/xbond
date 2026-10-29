//go:build linux

package sysproxy

import (
	"fmt"
	"os/exec"
	"strings"
	"time"
)

func Get() (Snapshot, error) {
	cmd := exec.Command("gsettings", "get", "org.gnome.system.proxy", "mode")
	out, err := cmd.Output()
	if err != nil {
		return Snapshot{}, err
	}
	mode := strings.Trim(strings.TrimSpace(string(out)), "'")
	return Snapshot{
		Enabled:   mode == "manual",
		Timestamp: time.Now().Unix(),
	}, nil
}

func Set(server string, bypass string) error {
	current, err := Get()
	if err != nil {
		return err
	}
	if err := SaveSnapshot(current); err != nil {
		return err
	}

	parts := strings.Split(server, ":")
	host := parts[0]
	port := "7890"
	if len(parts) > 1 {
		port = parts[1]
	}

	for _, args := range [][]string{
		{"set", "org.gnome.system.proxy.http", "host", host},
		{"set", "org.gnome.system.proxy.http", "port", port},
		{"set", "org.gnome.system.proxy.https", "host", host},
		{"set", "org.gnome.system.proxy.https", "port", port},
		{"set", "org.gnome.system.proxy", "mode", "manual"},
	} {
		if err := exec.Command("gsettings", args...).Run(); err != nil {
			return fmt.Errorf("apply system proxy setting: %w", err)
		}
	}
	return nil
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
