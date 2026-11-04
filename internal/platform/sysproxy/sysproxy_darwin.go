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
	out, err := exec.Command("networksetup", "-getwebproxy", service).Output()
	if err != nil {
		return Snapshot{}, err
	}
	enabled, host, port := parseNetworksetupWebProxy(string(out))

	// The bypass domains are what a restore must put back, so capture them
	// whenever the proxy is on; without them a restore would clobber the
	// user's original exception list with ours.
	bypass := ""
	if enabled {
		bypassOut, err := exec.Command("networksetup", "-getproxybypassdomains", service).Output()
		if err != nil {
			return Snapshot{}, err
		}
		bypass = strings.Join(parseNetworksetupBypassDomains(string(bypassOut)), ";")
	}

	server := ""
	if enabled {
		// networksetup prints "(null)"/0 while disabled; only an enabled
		// proxy has a server worth capturing.
		server = joinHostPort(host, port)
	}
	return Snapshot{
		Enabled:   enabled,
		Server:    server,
		Bypass:    bypass,
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
	host, port := splitHostPort(server)

	for _, command := range []string{"-setwebproxy", "-setsecurewebproxy", "-setsocksfirewallproxy"} {
		if err := exec.Command("networksetup", command, service, host, port).Run(); err != nil {
			return fmt.Errorf("apply system proxy setting: %w", err)
		}
	}
	// Restore the exception list the snapshot captured (or clear it when
	// empty): leaving it untouched would keep the previous owner's bypass
	// domains pointing away from our proxy.
	domains := []string{}
	for _, domain := range strings.Split(bypass, ";") {
		if domain = strings.TrimSpace(domain); domain != "" {
			domains = append(domains, domain)
		}
	}
	if len(domains) == 0 {
		// networksetup's keyword for "no exceptions".
		domains = []string{"Empty"}
	}
	args := append([]string{"-setproxybypassdomains", service}, domains...)
	if err := exec.Command("networksetup", args...).Run(); err != nil {
		return fmt.Errorf("apply system proxy bypass domains: %w", err)
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
