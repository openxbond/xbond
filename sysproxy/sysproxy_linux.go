//go:build linux

package sysproxy

import (
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
	if err == nil {
		_ = SaveSnapshot(current)
	}

	parts := strings.Split(server, ":")
	host := parts[0]
	port := "7890"
	if len(parts) > 1 {
		port = parts[1]
	}

	_ = exec.Command("gsettings", "set", "org.gnome.system.proxy", "mode", "manual").Run()
	_ = exec.Command("gsettings", "set", "org.gnome.system.proxy.http", "host", host).Run()
	_ = exec.Command("gsettings", "set", "org.gnome.system.proxy.http", "port", port).Run()
	_ = exec.Command("gsettings", "set", "org.gnome.system.proxy.https", "host", host).Run()
	_ = exec.Command("gsettings", "set", "org.gnome.system.proxy.https", "port", port).Run()
	return nil
}

func Disable() error {
	_ = exec.Command("gsettings", "set", "org.gnome.system.proxy", "mode", "none").Run()
	ClearSnapshot()
	return nil
}
