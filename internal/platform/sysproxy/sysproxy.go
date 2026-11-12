package sysproxy

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"

	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
)

type Snapshot struct {
	Enabled   bool   `json:"enabled"`
	Server    string `json:"server"`
	Bypass    string `json:"bypass,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

func SaveSnapshot(snap Snapshot) error {
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.Write(paths.SysproxySnapshotPath(), data, 0o600)
}

func LoadSnapshot() (*Snapshot, error) {
	data, err := os.ReadFile(paths.SysproxySnapshotPath())
	if err != nil {
		return nil, err
	}
	var snap Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return nil, err
	}
	return &snap, nil
}

func ClearSnapshot() {
	_ = os.Remove(paths.SysproxySnapshotPath())
}

func AutoRecoverOnStartup() error {
	snap, err := LoadSnapshot()
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read system proxy recovery state: %w", err)
	}
	if err := Restore(*snap); err != nil {
		return fmt.Errorf("restore stale system proxy: %w", err)
	}
	if err := os.Remove(paths.SysproxySnapshotPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove system proxy recovery state: %w", err)
	}
	return nil
}

// splitHostPort splits the "host:port" server string the takeover passes
// in; a missing port keeps the platforms' historical 7890 default.
func splitHostPort(server string) (host string, port string) {
	parts := strings.Split(server, ":")
	if len(parts) == 1 {
		return parts[0], "7890"
	}
	return parts[0], parts[1]
}

// joinHostPort is the inverse of splitHostPort for snapshot capture.
func joinHostPort(host, port string) string {
	if host == "" {
		return ""
	}
	if port == "" {
		return host
	}
	return host + ":" + port
}

// TargetsPort reports whether the snapshot's server points at the given
// port. Substring matching false-positives whenever the port digits nest
// (mixed port 7890 vs another app on 17890): split the host:port pair and
// compare numerically. Unparsable servers cannot match a listener, so they
// report false — the honest "unknown" for this check.
func (s Snapshot) TargetsPort(port int) bool {
	_, portText, err := net.SplitHostPort(s.Server)
	if err != nil {
		return false
	}
	captured, err := strconv.Atoi(portText)
	if err != nil {
		return false
	}
	return captured == port
}

// parseNetworksetupWebProxy reads `networksetup -getwebproxy` output:
//
//	Enabled: Yes
//	Server: 127.0.0.1
//	Port: 7890
func parseNetworksetupWebProxy(out string) (enabled bool, host string, port string) {
	for _, line := range strings.Split(out, "\n") {
		key, value, found := strings.Cut(strings.TrimSpace(line), ":")
		if !found {
			continue
		}
		value = strings.TrimSpace(value)
		switch strings.TrimSpace(key) {
		case "Enabled":
			enabled = strings.EqualFold(value, "Yes")
		case "Server":
			host = value
		case "Port":
			port = value
		}
	}
	return enabled, host, port
}

// parseNetworksetupBypassDomains reads `networksetup -getproxybypassdomains`
// output: one domain per line, with blank lines and a literal "<direct>"
// entry that is not a real domain.
func parseNetworksetupBypassDomains(out string) []string {
	var domains []string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line == "<direct>" {
			continue
		}
		domains = append(domains, line)
	}
	return domains
}

// parseGSettingsScalar strips the quoting gsettings prints around scalars:
// '127.0.0.1' → 127.0.0.1.
func parseGSettingsScalar(out string) string {
	return strings.Trim(strings.TrimSpace(out), "'")
}

// parseGSettingsStringArray reads a GVariant string array like
// ['localhost', '127.0.0.0/8'] into its elements. Typed empty values print
// with a type prefix ("@as []") that must be stripped too.
func parseGSettingsStringArray(out string) []string {
	inner := strings.TrimSpace(out)
	inner = strings.TrimPrefix(inner, "@as")
	inner = strings.TrimSpace(inner)
	inner = strings.TrimPrefix(inner, "[")
	inner = strings.TrimSuffix(inner, "]")
	inner = strings.TrimSpace(inner)
	if inner == "" {
		return nil
	}
	var values []string
	for _, part := range strings.Split(inner, ",") {
		value := strings.Trim(strings.TrimSpace(part), "'")
		if value != "" {
			values = append(values, value)
		}
	}
	return values
}
