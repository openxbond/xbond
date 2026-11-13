// Package telemetry provides the anonymous install beacon shared by every
// host: a random install ID persisted in the data dir, plus OS, OS version
// and app version facts. Consumers attach it only to XBond-owned requests
// (subscription gateway, update manifests); third-party traffic carries
// none of it.
package telemetry

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/version"
)

// installIDFile lives directly in the data dir so every surface of one
// install (daemon, Tauri shell, mobile tunnel process) reads the same value.
const installIDFile = "install-id"

var (
	mu                sync.Mutex
	cachedID          string
	osVersionOverride string
)

// InstallID returns the persistent random install identifier, creating it on
// first use. The ID is drawn from crypto/rand — never derived from hardware
// or account — so reinstalling resets it and an install stays a countable
// unit without identifying a person. It returns an empty string when the
// data dir cannot provide a file; callers skip the beacon then.
func InstallID() string {
	mu.Lock()
	defer mu.Unlock()
	if cachedID != "" {
		return cachedID
	}
	cachedID = loadOrCreate()
	return cachedID
}

// SetOSVersion supplies the OS release version for hosts where Go cannot
// probe it (Android's sandbox); the mobile bridge calls it once at service
// construction. An empty value keeps the platform probe, so a bridge that
// has nothing to add (iOS, where the darwin probe works) stays silent.
func SetOSVersion(version string) {
	mu.Lock()
	defer mu.Unlock()
	osVersionOverride = version
}

// Header renders the X-XBond-Install beacon value as a semicolon-separated
// key=value list. OS version is omitted when no probe and no bridge value
// are available. Empty when there is no install ID — without it the rest
// of the facts cannot be attributed to an install.
func Header() string {
	id := InstallID()
	if id == "" {
		return ""
	}
	parts := []string{
		"id=" + id,
		"app=" + version.Version,
		"os=" + runtime.GOOS,
	}
	if v := reportedOSVersion(); v != "" {
		parts = append(parts, "osv="+v)
	}
	parts = append(parts, "arch="+runtime.GOARCH)
	return strings.Join(parts, "; ")
}

// reportedOSVersion prefers the bridge value over the platform probe; the
// probe runs under the same lock because it is cheap and Header is rare.
func reportedOSVersion() string {
	mu.Lock()
	defer mu.Unlock()
	if osVersionOverride != "" {
		return osVersionOverride
	}
	return osVersion()
}

func loadOrCreate() string {
	if err := os.MkdirAll(paths.DataDir(), 0o700); err != nil {
		return ""
	}
	path := filepath.Join(paths.DataDir(), installIDFile)

	if data, err := os.ReadFile(path); err == nil {
		if id := normalizeID(data); id != "" {
			return id
		}
	}

	id := newID()
	// O_EXCL so the losing process of a concurrent create (the iOS packet
	// tunnel and the app share one app-group container) reuses the winner's
	// file instead of replacing it.
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err == nil {
		_, writeErr := file.WriteString(id)
		closeErr := file.Close()
		if writeErr == nil && closeErr == nil {
			return id
		}
	}

	// O_EXCL lost to a valid winner — keep its value.
	if data, err := os.ReadFile(path); err == nil {
		if existing := normalizeID(data); existing != "" {
			return existing
		}
	}

	// Either we created the file and failed to write it, or the winner's
	// content is unusable; replace with ours through the atomic writer.
	if err := atomicfile.Write(path, []byte(id), 0o600); err != nil {
		return ""
	}
	return id
}

func newID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return ""
	}
	return hex.EncodeToString(buf)
}

// normalizeID accepts only 32 lowercase hex bytes — a truncated or hand-
// edited file regenerates instead of leaking garbage into the beacon.
func normalizeID(data []byte) string {
	id := strings.TrimSpace(string(data))
	if len(id) != 32 {
		return ""
	}
	for _, c := range id {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return ""
		}
	}
	return id
}
