package engine

import (
	"fmt"

	"github.com/metacubex/mihomo/config"
	"github.com/metacubex/mihomo/hub/executor"
	"gopkg.in/yaml.v3"
)

// Validate parses and resolves the configuration without starting any
// listener. Remote proxy/rule providers are fetched lazily by the running
// core, so validation never touches the network.
func Validate(configBytes []byte) error {
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
	if _, err := executor.ParseWithBytes(configBytes); err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}
	return nil
}

// DeriveRuntimeConfig merges a subscription's Clash YAML with the daemon-owned
// listeners, takeover and controller settings. Everything under the daemon's
// ownership is overwritten; subscription content (proxies, groups, rules,
// DNS choices) is preserved as-is except where TUN mode requires DNS.
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

	raw, err := decodeYAMLMap(source)
	if err != nil {
		return nil, fmt.Errorf("failed to parse source config: %w", err)
	}

	applyGeneral(raw, routingMode, mixedPort, allowLan, clashPort, clashSecret)
	applyTakeover(raw, takeoverMode)

	derived, err := yaml.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal derived config: %w", err)
	}
	return derived, nil
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

	raw["tun"] = map[string]any{
		"enable":          true,
		"file-descriptor": tunFd,
		"stack":           "mixed",
		"auto-route":      false,
		"strict-route":    false,
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

// applyGeneral overwrites the general section the daemon owns. Listener
// configuration from the subscription never survives: takeover is a
// user-controlled app setting, not subscription content.
func applyGeneral(
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

func applyTakeover(raw map[string]any, takeoverMode TakeoverMode) {
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
		dns["nameserver"] = []any{"system", "8.8.8.8"}
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
