package engine

import (
	"encoding/json"
	"fmt"
	"net"
	"strconv"

	"github.com/metacubex/mihomo/config"
)

// CoreMetadata is the run-shape information a derived runtime config carries:
// which core runs it, which takeover it performs, and the loopback listeners
// it opens. The manager extracts it into its own state, and the delegated-TUN
// path uses it to address the remote core's clash API without running a
// local manager.
type CoreMetadata struct {
	Core         CoreFormat
	TakeoverMode TakeoverMode
	RoutingMode  RoutingMode
	MixedPort    int
	AllowLan     bool
	ClashPort    int
	ClashSecret  string
}

// InspectConfig reports the metadata of a derived runtime config. It is the
// same extraction the manager performs on start, kept pure so callers can
// inspect a config without a manager instance.
func InspectConfig(runtimeConfig []byte) (CoreMetadata, error) {
	format, err := DetectFormat(runtimeConfig)
	if err != nil {
		return CoreMetadata{}, fmt.Errorf("detect core: %w", err)
	}
	switch format {
	case FormatClash:
		return inspectMihomoConfig(runtimeConfig, format)
	case FormatSingBox:
		return inspectSingBoxConfig(runtimeConfig, format)
	default:
		return CoreMetadata{}, fmt.Errorf("unsupported core format %q", format)
	}
}

func inspectMihomoConfig(runtimeYAML []byte, format CoreFormat) (CoreMetadata, error) {
	raw, err := config.UnmarshalRawConfig(runtimeYAML)
	if err != nil {
		return CoreMetadata{}, err
	}
	meta := CoreMetadata{
		Core:      format,
		MixedPort: raw.MixedPort,
		ClashPort: 9090,
	}
	if raw.Tun.Enable {
		meta.TakeoverMode = ModeTun
	} else {
		meta.TakeoverMode = ModePort
	}
	meta.AllowLan = raw.AllowLan && (raw.BindAddress == "*" || raw.BindAddress == "0.0.0.0" || raw.BindAddress == "::")
	switch raw.Mode.String() {
	case "rule":
		meta.RoutingMode = RoutingRule
	case "global":
		meta.RoutingMode = RoutingGlobal
	case "direct":
		meta.RoutingMode = RoutingDirect
	}
	if raw.ExternalController != "" {
		if _, portStr, err := net.SplitHostPort(raw.ExternalController); err == nil {
			if port, err := strconv.Atoi(portStr); err == nil && port > 0 {
				meta.ClashPort = port
			}
		}
		meta.ClashSecret = raw.Secret
	}
	return meta, nil
}

func inspectSingBoxConfig(runtimeJSON []byte, format CoreFormat) (CoreMetadata, error) {
	var raw struct {
		Inbounds []struct {
			Type       string `json:"type"`
			Listen     string `json:"listen"`
			ListenPort int    `json:"listen_port"`
		} `json:"inbounds"`
		Experimental struct {
			ClashAPI struct {
				ExternalController string `json:"external_controller"`
				Secret             string `json:"secret"`
				DefaultMode        string `json:"default_mode"`
			} `json:"clash_api"`
		} `json:"experimental"`
	}
	if err := json.Unmarshal(runtimeJSON, &raw); err != nil {
		return CoreMetadata{}, err
	}
	// Baseline zero: a config without a mixed inbound has no local listener
	// (the mobile derivation strips them). Desktop derivations always inject
	// a mixed inbound, so the loop re-sets it.
	meta := CoreMetadata{Core: format, TakeoverMode: ModePort, ClashPort: 9090}
	for _, in := range raw.Inbounds {
		if in.Type == "tun" {
			meta.TakeoverMode = ModeTun
		}
		if in.Type == "mixed" && in.ListenPort > 0 {
			meta.MixedPort = in.ListenPort
			meta.AllowLan = in.Listen == "0.0.0.0" || in.Listen == "::"
		}
	}
	if raw.Experimental.ClashAPI.ExternalController != "" {
		if _, portStr, err := net.SplitHostPort(raw.Experimental.ClashAPI.ExternalController); err == nil {
			if port, err := strconv.Atoi(portStr); err == nil && port > 0 {
				meta.ClashPort = port
			}
		}
		meta.ClashSecret = raw.Experimental.ClashAPI.Secret
		if raw.Experimental.ClashAPI.DefaultMode != "" {
			meta.RoutingMode = RoutingMode(raw.Experimental.ClashAPI.DefaultMode)
		}
	}
	return meta, nil
}
