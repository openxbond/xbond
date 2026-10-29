//go:build darwin

package sysproxy

import (
	"fmt"
	"os/exec"
	"strings"
	"time"
)

func getDefaultNetworkService() string {
	cmd := exec.Command("networksetup", "-listnetworkserviceorder")
	out, err := cmd.Output()
	if err != nil {
		return "Wi-Fi"
	}
	lines := strings.Split(string(out), "\n")
	for _, l := range lines {
		if strings.Contains(l, "(Hardware Port: Wi-Fi") || strings.Contains(l, "(Hardware Port: Ethernet") {
			parts := strings.Split(l, ",")
			if len(parts) > 0 {
				servicePart := strings.TrimPrefix(parts[0], "(1) ")
				servicePart = strings.TrimPrefix(servicePart, "(2) ")
				return strings.TrimSpace(servicePart)
			}
		}
	}
	return "Wi-Fi"
}

func Get() (Snapshot, error) {
	service := getDefaultNetworkService()
	cmd := exec.Command("networksetup", "-getwebproxy", service)
	out, err := cmd.Output()
	if err != nil {
		return Snapshot{}, err
	}

	enabled := strings.Contains(string(out), "Enabled: Yes")
	return Snapshot{
		Enabled:   enabled,
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

	service := getDefaultNetworkService()
	parts := strings.Split(server, ":")
	host := parts[0]
	port := "7890"
	if len(parts) > 1 {
		port = parts[1]
	}

	for _, command := range []string{"-setwebproxy", "-setsecurewebproxy", "-setsocksfirewallproxy"} {
		if err := exec.Command("networksetup", command, service, host, port).Run(); err != nil {
			return fmt.Errorf("apply system proxy setting: %w", err)
		}
	}
	return nil
}

func Disable() error {
	service := getDefaultNetworkService()
	for _, command := range []string{"-setwebproxystate", "-setsecurewebproxystate", "-setsocksfirewallproxystate"} {
		if err := exec.Command("networksetup", command, service, "off").Run(); err != nil {
			return fmt.Errorf("release system proxy setting: %w", err)
		}
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
