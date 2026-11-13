package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/metacubex/mihomo/config"
	C "github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/hub/executor"
	"github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/adapter"
	_ "github.com/sagernet/sing-box/experimental/clashapi" // registers the clash API server
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/option"
	singJson "github.com/sagernet/sing/common/json"
	"github.com/sagernet/sing/service"
	"github.com/sagernet/sing/service/filemanager"
	"gopkg.in/yaml.v3"

	"github.com/openxbond/xbond/internal/platform/paths"
)

func NewBoxContext() context.Context {
	ctx := include.Context(context.Background())
	// Anchor sing-box's relative paths (cache.db and friends) at the xbond
	// data dir. Without this they resolve against the process working
	// directory, which is the exe dir on desktop and a read-only root on
	// Android ("initialize cache-file: read-only file system").
	dataDir := paths.DataDir()
	if err := os.MkdirAll(dataDir, 0o700); err == nil {
		ctx = filemanager.WithDefault(ctx, dataDir, filepath.Join(dataDir, "temp"), os.Getuid(), os.Getgid())
	}
	if runtime.GOOS == "android" || runtime.GOOS == "ios" || mobileTunFD.Load() > 0 {
		ctx = service.ContextWith[adapter.PlatformInterface](ctx, mobilePlatformInterface{})
	}
	return ctx
}

// Validate parses and resolves the configuration with its native core
// without starting any listener. Remote providers fetch lazily from the
// running core, so validation never touches the network (geodata for
// GEOIP/GEOSITE rules is the core's only on-demand download).
func Validate(configBytes []byte) error {
	format, err := DetectFormat(configBytes)
	if err != nil {
		return err
	}
	switch format {
	case FormatClash:
		return validateClash(configBytes)
	case FormatSingBox:
		return validateSingBox(configBytes)
	default:
		return fmt.Errorf("unsupported core format %q", format)
	}
}

func validateClash(configBytes []byte) error {
	if err := initCoreHome(); err != nil {
		return err
	}
	raw, err := config.UnmarshalRawConfig(configBytes)
	if err != nil {
		return fmt.Errorf("failed to parse mihomo configuration: %w", err)
	}
	if len(raw.Proxy) == 0 && len(raw.ProxyProvider) == 0 {
		return fmt.Errorf("configuration contains no proxies")
	}

	needsGeoIP := len(raw.DNS.Fallback) > 0 && raw.DNS.FallbackFilter.GeoIP
	if !needsGeoIP {
		for _, rule := range raw.Rule {
			if strings.HasPrefix(rule, "GEOIP,") || strings.HasPrefix(rule, "GEOIP ") {
				needsGeoIP = true
				break
			}
		}
	}

	if needsGeoIP {
		mmdbPath := C.Path.MMDB()
		if _, err := os.Stat(mmdbPath); os.IsNotExist(err) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_ = EnsureGeoData(ctx)
			cancel()
		}
	}

	testConfig := configBytes
	if needsGeoIP {
		if _, err := os.Stat(C.Path.MMDB()); os.IsNotExist(err) && raw.DNS.FallbackFilter.GeoIP {
			testConfig = suppressFallbackGeoIP(configBytes)
		}
	}

	if _, err := executor.ParseWithBytes(testConfig); err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}
	return nil
}

func validateSingBox(configJSON []byte) error {
	ctx := NewBoxContext()
	options, err := singJson.UnmarshalExtendedContext[option.Options](ctx, configJSON)
	if err != nil {
		return fmt.Errorf("failed to parse sing-box options: %w", err)
	}

	if len(options.Outbounds) == 0 {
		return fmt.Errorf("configuration contains no outbounds")
	}

	instance, err := box.New(box.Options{
		Context: ctx,
		Options: options,
	})
	if err != nil {
		return fmt.Errorf("failed to create sing-box instance: %w", err)
	}
	_ = instance.Close()
	return nil
}

// SourcePort reports the mixed proxy port a subscription requests for
// itself, if any: the Clash YAML `mixed-port` key or a sing-box mixed
// inbound's listen_port. Zero means the source does not name a port and the
// daemon default applies.
func SourcePort(source []byte) (int, error) {
	format, err := DetectFormat(source)
	if err != nil {
		return 0, err
	}
	switch format {
	case FormatClash:
		var head struct {
			MixedPort int `yaml:"mixed-port"`
		}
		if err := yaml.Unmarshal(source, &head); err != nil {
			return 0, fmt.Errorf("failed to parse source config: %w", err)
		}
		if head.MixedPort < 0 || head.MixedPort > 65535 {
			return 0, fmt.Errorf("source mixed-port %d is out of range", head.MixedPort)
		}
		return head.MixedPort, nil
	case FormatSingBox:
		var raw struct {
			Inbounds []struct {
				Type       string `json:"type"`
				ListenPort int    `json:"listen_port"`
			} `json:"inbounds"`
		}
		if err := json.Unmarshal(source, &raw); err != nil {
			return 0, fmt.Errorf("failed to parse source config: %w", err)
		}
		for _, inbound := range raw.Inbounds {
			if inbound.Type == "mixed" && inbound.ListenPort > 0 {
				if inbound.ListenPort > 65535 {
					return 0, fmt.Errorf("source listen_port %d is out of range", inbound.ListenPort)
				}
				return inbound.ListenPort, nil
			}
		}
		return 0, nil
	default:
		return 0, fmt.Errorf("unsupported core format %q", format)
	}
}

// DeriveRuntimeConfig merges a subscription's configuration with the
// daemon-owned listeners, takeover and controller settings, using the core
// native to the source format. Everything under the daemon's ownership is
// overwritten; subscription content is preserved as-is.
func DeriveRuntimeConfig(
	source []byte,
	takeoverMode TakeoverMode,
	routingMode RoutingMode,
	mixedPort int,
	allowLan bool,
	clashPort int,
	clashSecret string,
) ([]byte, error) {
	if mixedPort <= 0 {
		mixedPort = 7890
	}
	if clashPort <= 0 {
		clashPort = 9090
	}
	if takeoverMode == "" {
		takeoverMode = ModeSysproxy
	}
	if routingMode == "" {
		routingMode = RoutingRule
	}

	format, err := DetectFormat(source)
	if err != nil {
		return nil, err
	}
	switch format {
	case FormatClash:
		return deriveClashRuntime(source, takeoverMode, routingMode, mixedPort, allowLan, clashPort, clashSecret)
	case FormatSingBox:
		return deriveSingBoxRuntime(source, takeoverMode, routingMode, mixedPort, allowLan, clashPort, clashSecret)
	default:
		return nil, fmt.Errorf("unsupported core format %q", format)
	}
}

// DeriveMobileRuntimeConfig is the VPN-flavoured derivation: the platform TUN
// file descriptor is the only takeover, no local proxy listener is opened,
// and the controller stays on loopback for the in-app UI.
func DeriveMobileRuntimeConfig(
	source []byte,
	tunFd int32,
	routingMode RoutingMode,
	clashPort int,
	clashSecret string,
) ([]byte, error) {
	if tunFd <= 0 {
		return nil, fmt.Errorf("invalid TUN file descriptor: %d", tunFd)
	}
	if clashPort <= 0 {
		clashPort = 9090
	}
	if routingMode == "" {
		routingMode = RoutingRule
	}

	format, err := DetectFormat(source)
	if err != nil {
		return nil, err
	}
	switch format {
	case FormatClash:
		return deriveClashMobile(source, tunFd, routingMode, clashPort, clashSecret)
	case FormatSingBox:
		return deriveSingBoxMobile(source, tunFd, routingMode, clashPort, clashSecret)
	default:
		return nil, fmt.Errorf("unsupported core format %q", format)
	}
}

// ---------------------------------------------------------------------------
// mihomo (Clash YAML)

func deriveClashRuntime(
	source []byte,
	takeoverMode TakeoverMode,
	routingMode RoutingMode,
	mixedPort int,
	allowLan bool,
	clashPort int,
	clashSecret string,
) ([]byte, error) {
	raw, err := decodeYAMLMap(source)
	if err != nil {
		return nil, fmt.Errorf("failed to parse source config: %w", err)
	}

	applyClashGeneral(raw, routingMode, mixedPort, allowLan, clashPort, clashSecret)
	applyClashTakeover(raw, takeoverMode)

	derived, err := yaml.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal derived config: %w", err)
	}
	return derived, nil
}

func deriveClashMobile(
	source []byte,
	tunFd int32,
	routingMode RoutingMode,
	clashPort int,
	clashSecret string,
) ([]byte, error) {
	raw, err := decodeYAMLMap(source)
	if err != nil {
		return nil, fmt.Errorf("failed to parse source config: %w", err)
	}

	delete(raw, "port")
	delete(raw, "socks-port")
	delete(raw, "redir-port")
	delete(raw, "tproxy-port")
	delete(raw, "listeners")
	raw["mixed-port"] = 0
	raw["allow-lan"] = false
	raw["mode"] = string(routingMode)
	raw["log-level"] = "info"
	raw["external-controller"] = fmt.Sprintf("127.0.0.1:%d", clashPort)
	raw["secret"] = clashSecret
	delete(raw, "external-controller-tls")
	delete(raw, "external-controller-unix")
	delete(raw, "external-controller-pipe")
	delete(raw, "external-ui")
	mergeProfile(raw)
	applyGeoXMirrors(raw)

	raw["tun"] = map[string]any{
		"enable":          true,
		"file-descriptor": tunFd,
		"stack":           "gvisor",
		"auto-route":      false,
		// fd mode routes through the platform VPN; auto-detect-interface must
		// stay off — mihomo creates a sing-tun NetworkUpdateMonitor whenever
		// auto-route or auto-detect-interface is on, and on Android the
		// netlink socket that monitor needs is SELinux-banned for
		// untrusted_app, which fails the whole TUN listener (the core then
		// silently runs mixed-only while the VPN interface reads nobody).
		"auto-detect-interface": false,
		"strict-route":          false,
		// The VPN builder points the system resolver at an address inside the
		// tunnel; without hijack those queries reach no server and every
		// lookup fails ("no address associated with hostname").
		"dns-hijack": []any{"any:53"},
	}
	ensureDNSForTun(raw)

	derived, err := yaml.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal derived mobile config: %w", err)
	}
	return derived, nil
}

func decodeYAMLMap(source []byte) (map[string]any, error) {
	var raw map[string]any
	if err := yaml.Unmarshal(source, &raw); err != nil {
		return nil, err
	}
	if raw == nil {
		raw = make(map[string]any)
	}
	return raw, nil
}

// applyClashGeneral overwrites the general section the daemon owns. Listener
// configuration from the subscription never survives: takeover is a
// user-controlled app setting, not subscription content.
func applyClashGeneral(
	raw map[string]any,
	routingMode RoutingMode,
	mixedPort int,
	allowLan bool,
	clashPort int,
	clashSecret string,
) {
	delete(raw, "port")
	delete(raw, "socks-port")
	delete(raw, "redir-port")
	delete(raw, "tproxy-port")
	delete(raw, "listeners")
	raw["mixed-port"] = mixedPort
	raw["allow-lan"] = allowLan
	if allowLan {
		raw["bind-address"] = "*"
	} else {
		raw["bind-address"] = "127.0.0.1"
	}
	raw["mode"] = string(routingMode)
	raw["log-level"] = "info"
	raw["external-controller"] = fmt.Sprintf("127.0.0.1:%d", clashPort)
	raw["secret"] = clashSecret
	delete(raw, "external-controller-tls")
	delete(raw, "external-controller-unix")
	delete(raw, "external-controller-pipe")
	delete(raw, "external-ui")
	mergeProfile(raw)
	applyGeoXMirrors(raw)
}

func mergeProfile(raw map[string]any) {
	profile, _ := raw["profile"].(map[string]any)
	if profile == nil {
		profile = make(map[string]any)
	}
	profile["store-selected"] = true
	profile["store-fake-ip"] = true
	raw["profile"] = profile
}

func applyClashTakeover(raw map[string]any, takeoverMode TakeoverMode) {
	tun, _ := raw["tun"].(map[string]any)
	if tun == nil {
		tun = make(map[string]any)
	}
	if takeoverMode != ModeTun {
		tun["enable"] = false
		raw["tun"] = tun
		return
	}
	tun["enable"] = true
	tun["stack"] = "mixed"
	tun["auto-route"] = true
	if runtime.GOOS == "linux" {
		tun["auto-redirect"] = true
	}
	tun["strict-route"] = true
	tun["auto-detect-interface"] = true
	tun["dns-hijack"] = []any{"any:53"}
	raw["tun"] = tun
	ensureDNSForTun(raw)
}

// ensureDNSForTun makes the DNS module usable when TUN takes over traffic:
// without it, hijacked DNS queries have nowhere to go. A subscription that
// already ships a working DNS section keeps its upstreams.
func ensureDNSForTun(raw map[string]any) {
	dns, _ := raw["dns"].(map[string]any)
	if dns == nil {
		dns = make(map[string]any)
	}
	dns["enable"] = true
	if nameservers, _ := dns["nameserver"].([]any); len(nameservers) == 0 {
		// "system" resolves through /etc/resolv.conf, which Android does not
		// have — plain-IP resolvers only.
		dns["nameserver"] = []any{"223.5.5.5", "8.8.8.8"}
	}
	// Bootstrapping resolvers for encrypted upstreams (DoH/DoT with a
	// hostname): without these the first resolution of the upstream's own
	// domain has nothing to ask, and every outbound dial dies in
	// "dns resolve failed" — the deadlock the emulator walk-through hit.
	if defaults, _ := dns["default-nameserver"].([]any); len(defaults) == 0 {
		dns["default-nameserver"] = []any{"223.5.5.5", "8.8.8.8"}
	}
	if dns["enhanced-mode"] == nil {
		dns["enhanced-mode"] = "fake-ip"
	}
	if dns["enhanced-mode"] == "fake-ip" && dns["fake-ip-range"] == nil {
		dns["fake-ip-range"] = "198.18.0.1/16"
	}
	if filter, _ := dns["fake-ip-filter"].([]any); len(filter) == 0 {
		dns["fake-ip-filter"] = []any{"*.lan", "*.local"}
	}
	raw["dns"] = dns
}

// ---------------------------------------------------------------------------
// sing-box (JSON)

func deriveSingBoxRuntime(
	sourceJSON []byte,
	takeoverMode TakeoverMode,
	routingMode RoutingMode,
	mixedPort int,
	allowLan bool,
	clashPort int,
	clashSecret string,
) ([]byte, error) {
	var raw map[string]any
	if err := json.Unmarshal(sourceJSON, &raw); err != nil {
		return nil, fmt.Errorf("failed to unmarshal source config: %w", err)
	}

	inbounds, _ := raw["inbounds"].([]any)
	filteredInbounds := make([]any, 0, len(inbounds)+2)

	listenAddr := "127.0.0.1"
	if allowLan {
		listenAddr = "0.0.0.0"
	}

	var hasMixed bool
	for _, item := range inbounds {
		inboundMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		inboundType, _ := inboundMap["type"].(string)

		if inboundType == "tun" {
			// Takeover is app-controlled; a subscription TUN never runs.
			continue
		}
		if inboundType == "mixed" {
			inboundMap["listen"] = listenAddr
			inboundMap["listen_port"] = mixedPort
			filteredInbounds = append(filteredInbounds, inboundMap)
			hasMixed = true
			continue
		}
		filteredInbounds = append(filteredInbounds, inboundMap)
	}

	if !hasMixed {
		mixedInbound := map[string]any{
			"type":        "mixed",
			"tag":         "mixed-in",
			"listen":      listenAddr,
			"listen_port": mixedPort,
		}
		filteredInbounds = append([]any{mixedInbound}, filteredInbounds...)
	}

	if takeoverMode == ModeTun {
		tunInbound := map[string]any{
			"type":          "tun",
			"tag":           "tun-in",
			"address":       []any{"192.168.255.252/30", "fd00:c0a8:fffc::1/126"},
			"auto_route":    true,
			"auto_redirect": runtime.GOOS == "linux",
			"strict_route":  true,
			// Keep private ranges on the physical network: LAN, the VM NAT
			// range and CGNAT must not enter the tunnel, and the tun's own
			// 192.168.255.x sits outside the excluded 192.168.0.0/17 half.
			"route_exclude_address": []any{
				"192.168.0.0/17",
				"172.16.0.0/12",
				"10.0.0.0/8",
				"100.64.0.0/10",
				"fe80::/10",
				"2409:8000::/20",
			},
		}
		// macOS utun devices are kernel-assigned: a custom name must carry
		// the utun prefix and sing-tun rejects anything else ("bad tun
		// name"), so leave it unset there and let sing-box pick the device.
		// Linux and Windows keep a stable, recognizable name.
		if runtime.GOOS != "darwin" {
			tunInbound["interface_name"] = "sing-tun"
		}
		filteredInbounds = append([]any{tunInbound}, filteredInbounds...)
		ensureSingBoxDNSForTun(raw)
	}

	raw["inbounds"] = filteredInbounds

	exp, _ := raw["experimental"].(map[string]any)
	if exp == nil {
		exp = make(map[string]any)
	}
	exp["clash_api"] = map[string]any{
		"external_controller": fmt.Sprintf("127.0.0.1:%d", clashPort),
		"secret":              clashSecret,
		"default_mode":        string(routingMode),
	}
	cacheFile, _ := exp["cache_file"].(map[string]any)
	if cacheFile == nil {
		cacheFile = make(map[string]any)
	}
	cacheFile["enabled"] = true
	cacheFile["store_fakeip"] = true
	exp["cache_file"] = cacheFile
	raw["experimental"] = exp

	derivedJSON, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal derived config: %w", err)
	}
	return derivedJSON, nil
}

func deriveSingBoxMobile(
	sourceJSON []byte,
	tunFd int32,
	routingMode RoutingMode,
	clashPort int,
	clashSecret string,
) ([]byte, error) {
	var raw map[string]any
	if err := json.Unmarshal(sourceJSON, &raw); err != nil {
		return nil, fmt.Errorf("failed to unmarshal source config: %w", err)
	}

	inbounds, _ := raw["inbounds"].([]any)
	filteredInbounds := make([]any, 0, len(inbounds)+1)

	for _, item := range inbounds {
		inboundMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		inboundType, _ := inboundMap["type"].(string)
		if inboundType == "tun" || inboundType == "mixed" {
			continue
		}
		filteredInbounds = append(filteredInbounds, inboundMap)
	}

	tunInbound := map[string]any{
		"type": "tun",
		"tag":  "tun-in",
		// Must mirror the platform VPN builder's addAddress: sing-box
		// validates the interface address at start even in fd mode.
		"address":      []any{"172.19.0.1/30"},
		"stack":        "gvisor",
		"auto_route":   false,
		"strict_route": false,
		// No file_descriptor here: v1.13 strict parsing rejects the field.
		// The fd is supplied at device-open time via adapter.PlatformInterface
		// (internal/engine/tun_fd.go).
	}
	filteredInbounds = append([]any{tunInbound}, filteredInbounds...)
	raw["inbounds"] = filteredInbounds
	ensureSingBoxDNSForTun(raw)

	exp, _ := raw["experimental"].(map[string]any)
	if exp == nil {
		exp = make(map[string]any)
	}
	exp["clash_api"] = map[string]any{
		"external_controller": fmt.Sprintf("127.0.0.1:%d", clashPort),
		"secret":              clashSecret,
		"default_mode":        string(routingMode),
	}
	// Cache file stays off on mobile: nothing depends on persisted
	// selections or fake-ip state, and its bbolt close fails on Android
	// with funlock EBADF during reload.
	exp["cache_file"] = map[string]any{"enabled": false}
	raw["experimental"] = exp

	derivedJSON, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal derived mobile config: %w", err)
	}
	return derivedJSON, nil
}

// ensureSingBoxDNSForTun makes DNS answerable when a TUN inbound takes over
// traffic: without a local DNS module, the hijacked port-53 queries the VPN
// builder points at the tunnel have no server and every lookup fails — the
// same failure mode the mihomo path solves with dns-hijack + injected
// nameservers. A subscription that already ships DNS servers keeps them and
// their own routing; the hijack rule is always ensured because the system
// resolver's packets enter through the tunnel regardless of the source's
// own DNS design.
func ensureSingBoxDNSForTun(raw map[string]any) {
	dns, _ := raw["dns"].(map[string]any)
	if dns == nil {
		dns = make(map[string]any)
	}
	if servers, _ := dns["servers"].([]any); len(servers) == 0 {
		const fallbackTag = "dns-fallback"
		dns["servers"] = []any{map[string]any{
			"type":   "udp",
			"tag":    fallbackTag,
			"server": "8.8.8.8",
		}}
		if dns["final"] == nil {
			dns["final"] = fallbackTag
		}
	}
	raw["dns"] = dns

	route, _ := raw["route"].(map[string]any)
	if route == nil {
		route = make(map[string]any)
	}
	rules, _ := route["rules"].([]any)
	hasSniff := false
	hasHijack := false
	for _, item := range rules {
		rule, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch rule["action"] {
		case "sniff":
			hasSniff = true
		case "hijack-dns":
			hasHijack = true
		}
		// Legacy pre-1.11 pattern: a dns inbound + a rule routing DNS to it.
		if outbound, _ := rule["outbound"].(string); outbound == "dns-out" {
			hasHijack = true
		}
	}
	// Prepend so the wire order is sniff first, hijack second: the hijack
	// condition reads the protocol sniffing produced.
	var prepend []any
	if !hasSniff {
		prepend = append(prepend, map[string]any{"action": "sniff"})
	}
	if !hasHijack {
		prepend = append(prepend, map[string]any{
			"protocol": "dns",
			"action":   "hijack-dns",
		})
	}
	if len(prepend) > 0 {
		rules = append(prepend, rules...)
	}
	route["rules"] = rules
	raw["route"] = route
}
