//go:build darwin

package sysproxy

import (
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// serviceOrderLineRe matches the "(N) service name" lines of
// `networksetup -listnetworkserviceorder`; localized systems use full-width
// brackets. Service names may contain parentheses and spaces ("Built-in
// Serial Port (1)"), so the line-leading index is the only anchor.
var serviceOrderLineRe = regexp.MustCompile(`^[(（](\d+)[)）]\s*(.+)$`)

// pickDefaultNetworkService pairs each "(N) name" line with the hardware
// port line that follows it and returns the first enabled service whose
// port is Wi-Fi or Ethernet. The service name comes from the "(N) name"
// line — grabbing it from the port line would hand networksetup a
// "(Hardware Port: …" fragment, which exits status 8. Port names stay
// English across locales even when the surrounding labels are translated.
func pickDefaultNetworkService(order string) (string, error) {
	service := ""
	disabled := false
	pending := false
	for _, line := range strings.Split(order, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if match := serviceOrderLineRe.FindStringSubmatch(line); match != nil {
			service = strings.TrimSpace(match[2])
			disabled = strings.HasSuffix(service, "(*)")
			service = strings.TrimSuffix(service, " (*)")
			pending = true
			continue
		}
		if !pending {
			continue // legend and preamble lines
		}
		if !disabled && (strings.Contains(line, "Wi-Fi") || strings.Contains(line, "Ethernet")) {
			return service, nil
		}
		pending = false
	}
	return "", fmt.Errorf(
		"no enabled Wi-Fi or Ethernet network service in `networksetup -listnetworkserviceorder`",
	)
}

func defaultNetworkService() (string, error) {
	out, err := exec.Command("networksetup", "-listnetworkserviceorder").Output()
	if err != nil {
		return "", fmt.Errorf("list network services: %w", err)
	}
	return pickDefaultNetworkService(string(out))
}

func Get() (Snapshot, error) {
	service, err := defaultNetworkService()
	if err != nil {
		return Snapshot{}, err
	}
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

	service, err := defaultNetworkService()
	if err != nil {
		return err
	}
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
	service, err := defaultNetworkService()
	if err != nil {
		return err
	}
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
