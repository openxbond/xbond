//go:build darwin

package sysproxy

import (
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
	if err == nil {
		_ = SaveSnapshot(current)
	}

	service := getDefaultNetworkService()
	parts := strings.Split(server, ":")
	host := parts[0]
	port := "7890"
	if len(parts) > 1 {
		port = parts[1]
	}

	_ = exec.Command("networksetup", "-setwebproxy", service, host, port).Run()
	_ = exec.Command("networksetup", "-setsecurewebproxy", service, host, port).Run()
	_ = exec.Command("networksetup", "-setsocksfirewallproxy", service, host, port).Run()
	return nil
}

func Disable() error {
	service := getDefaultNetworkService()
	_ = exec.Command("networksetup", "-setwebproxystate", service, "off").Run()
	_ = exec.Command("networksetup", "-setsecurewebproxystate", service, "off").Run()
	_ = exec.Command("networksetup", "-setsocksfirewallproxystate", service, "off").Run()
	ClearSnapshot()
	return nil
}
