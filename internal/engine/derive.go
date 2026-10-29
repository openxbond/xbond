package engine

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/sagernet/sing-box"
	_ "github.com/sagernet/sing-box/experimental/clashapi"
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/option"
	singJson "github.com/sagernet/sing/common/json"
)

func NewBoxContext() context.Context {
	return include.Context(context.Background())
}

func Validate(sourceJSON []byte) error {
	ctx := NewBoxContext()
	options, err := singJson.UnmarshalExtendedContext[option.Options](ctx, sourceJSON)
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

func DeriveRuntimeConfig(
	sourceJSON []byte,
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

	var raw map[string]any
	if err := json.Unmarshal(sourceJSON, &raw); err != nil {
		return nil, fmt.Errorf("failed to unmarshal source config: %w", err)
	}

	inbounds, _ := raw["inbounds"].([]any)
	filteredInbounds := make([]any, 0, len(inbounds)+2)

	var hasMixed bool
	var hasTun bool

	listenAddr := "127.0.0.1"
	if allowLan {
		listenAddr = "0.0.0.0"
	}

	for _, item := range inbounds {
		inboundMap, ok := item.(map[string]any)
		if !ok {
			continue
		}
		inboundType, _ := inboundMap["type"].(string)

		if inboundType == "tun" {
			if takeoverMode == ModeTun {
				inboundMap["interface_name"] = "sing-tun"
				inboundMap["auto_route"] = true
				inboundMap["strict_route"] = true
				filteredInbounds = append(filteredInbounds, inboundMap)
				hasTun = true
			}
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

	if takeoverMode == ModeTun && !hasTun {
		tunInbound := map[string]any{
			"type":           "tun",
			"tag":            "tun-in",
			"interface_name": "sing-tun",
			"auto_route":     true,
			"strict_route":   true,
			"stack":          "mixed",
		}
		filteredInbounds = append([]any{tunInbound}, filteredInbounds...)
	}

	raw["inbounds"] = filteredInbounds

	exp, _ := raw["experimental"].(map[string]any)
	if exp == nil {
		exp = make(map[string]any)
	}

	clashApiMap := map[string]any{
		"external_controller": fmt.Sprintf("127.0.0.1:%d", clashPort),
		"secret":              clashSecret,
		"default_mode":        string(routingMode),
	}
	exp["clash_api"] = clashApiMap

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

func DeriveMobileRuntimeConfig(
	sourceJSON []byte,
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
		"type":            "tun",
		"tag":             "tun-in",
		"file_descriptor": tunFd,
		"stack":           "mixed",
		"auto_route":      false,
		"strict_route":    false,
	}
	filteredInbounds = append([]any{tunInbound}, filteredInbounds...)
	raw["inbounds"] = filteredInbounds

	exp, _ := raw["experimental"].(map[string]any)
	if exp == nil {
		exp = make(map[string]any)
	}

	clashApiMap := map[string]any{
		"external_controller": fmt.Sprintf("127.0.0.1:%d", clashPort),
		"secret":              clashSecret,
		"default_mode":        string(routingMode),
	}
	exp["clash_api"] = clashApiMap

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
		return nil, fmt.Errorf("failed to marshal derived mobile config: %w", err)
	}

	return derivedJSON, nil
}
