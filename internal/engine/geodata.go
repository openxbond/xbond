package engine

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"gopkg.in/yaml.v3"

	C "github.com/metacubex/mihomo/constant"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
)

const (
	defaultMmdbCDN    = "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.metadb"
	defaultGeoIpCDN   = "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat"
	defaultGeoSiteCDN = "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat"
	defaultASNCDN     = "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/GeoLite2-ASN.mmdb"
)

var (
	mmdbDownloadMu sync.Mutex
	mmdbMirrors    = []string{
		"https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.metadb",
		"https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.metadb",
		"https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.metadb",
		"https://ghproxy.net/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/geoip.metadb",
	}
)

// EnsureGeoData checks whether the GeoIP database exists on disk. If missing,
// it attempts to download it from fast CDN mirrors before mihomo tries raw GitHub.
func EnsureGeoData(ctx context.Context) error {
	mmdbPath := C.Path.MMDB()
	if mmdbPath == "" {
		mmdbPath = filepath.Join(paths.DataDir(), "geoip.metadb")
	}
	info, err := os.Stat(mmdbPath)
	if err == nil && info.Size() > 1024 {
		return nil
	}

	mmdbDownloadMu.Lock()
	defer mmdbDownloadMu.Unlock()

	// Double check after lock
	info, err = os.Stat(mmdbPath)
	if err == nil && info.Size() > 1024 {
		return nil
	}

	client := &http.Client{
		Timeout: 20 * time.Second,
	}

	var lastErr error
	for _, mirror := range mmdbMirrors {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, mirror, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("User-Agent", "XBond/1.0")

		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			lastErr = fmt.Errorf("mirror %s returned HTTP %d", mirror, resp.StatusCode)
			continue
		}

		data, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}

		if len(data) < 1024 {
			lastErr = fmt.Errorf("downloaded mmdb from %s too small (%d bytes)", mirror, len(data))
			continue
		}

		if err := atomicfile.Write(mmdbPath, data, 0o644); err != nil {
			lastErr = fmt.Errorf("write mmdb: %w", err)
			continue
		}

		return nil
	}

	return fmt.Errorf("failed to download GeoIP database from all mirrors: %w", lastErr)
}

// suppressFallbackGeoIP produces a temporary clone of the Clash YAML with
// fallback-filter.geoip set to false, allowing syntax and structure validation
// to proceed without deadlocking on a missing MMDB file when offline.
func suppressFallbackGeoIP(configBytes []byte) []byte {
	var raw map[string]any
	if err := yaml.Unmarshal(configBytes, &raw); err != nil {
		return configBytes
	}
	dns, _ := raw["dns"].(map[string]any)
	if dns == nil {
		return configBytes
	}
	fallbackFilter, _ := dns["fallback-filter"].(map[string]any)
	if fallbackFilter == nil {
		return configBytes
	}
	fallbackFilter["geoip"] = false
	dns["fallback-filter"] = fallbackFilter
	raw["dns"] = dns
	modified, err := yaml.Marshal(raw)
	if err != nil {
		return configBytes
	}
	return modified
}

// applyGeoXMirrors ensures derived Clash configurations use fast CDN mirrors
// for all geodata and ASN databases.
func applyGeoXMirrors(raw map[string]any) {
	geox, _ := raw["geox-url"].(map[string]any)
	if geox == nil {
		geox = make(map[string]any)
	}
	if geox["mmdb"] == nil || geox["mmdb"] == "" {
		geox["mmdb"] = defaultMmdbCDN
	}
	if geox["geoip"] == nil || geox["geoip"] == "" {
		geox["geoip"] = defaultGeoIpCDN
	}
	if geox["geosite"] == nil || geox["geosite"] == "" {
		geox["geosite"] = defaultGeoSiteCDN
	}
	if geox["asn"] == nil || geox["asn"] == "" {
		geox["asn"] = defaultASNCDN
	}
	raw["geox-url"] = geox
}
