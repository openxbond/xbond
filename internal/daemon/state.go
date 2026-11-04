package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
)

type RuntimePreferences struct {
	SystemProxy  bool                `json:"systemProxy"`
	Tun          bool                `json:"tun"`
	TakeoverMode engine.TakeoverMode `json:"takeoverMode,omitempty"`
	RoutingMode  engine.RoutingMode  `json:"routingMode"`
	MixedPort    int                 `json:"mixedPort"`
	AllowLan     bool                `json:"allowLan"`
	ClashPort    int                 `json:"clashPort"`
	ClashSecret  string              `json:"clashSecret"`
	// PortOverride is an explicit local fixed port; zero follows the active
	// subscription's own port. PortSource records how MixedPort was last
	// resolved so status can show where the running port came from.
	PortOverride int        `json:"portOverride,omitempty"`
	PortSource   PortSource `json:"portSource,omitempty"`
}

// PortSource is where the effective mixed port of the last apply came from.
type PortSource string

const (
	PortSourceDefault      PortSource = "default"
	PortSourceSubscription PortSource = "subscription"
	PortSourceOverride     PortSource = "override"
)

// legacyClashPort is the pre-randomization fixed default. New installs and
// migrations move off it so the endpoint stays a daemon-owned detail.
const legacyClashPort = 9090

// applyEnvOverrides folds deployment-environment overrides into the
// preferences: headless hosts (containers, servers) cannot click through a
// UI, so the operator states intent up front. Env always wins over the
// stored file, and an invalid value refuses to start — operator intent that
// cannot be parsed is an error, not a silent default (daemon-runtime spec:
// 不静默降级).
func applyEnvOverrides(prefs *RuntimePreferences) error {
	if raw := os.Getenv("XBOND_SYSTEM_PROXY"); raw != "" {
		v, err := strconv.ParseBool(raw)
		if err != nil {
			return fmt.Errorf("XBOND_SYSTEM_PROXY %q is invalid (want true or false)", raw)
		}
		prefs.SystemProxy = v
	}
	if raw := os.Getenv("XBOND_TUN"); raw != "" {
		v, err := strconv.ParseBool(raw)
		if err != nil {
			return fmt.Errorf("XBOND_TUN %q is invalid (want true or false)", raw)
		}
		prefs.Tun = v
	}
	if mode := os.Getenv("XBOND_TAKEOVER_MODE"); mode != "" {
		takeover := engine.TakeoverMode(mode)
		switch takeover {
		case engine.ModeSysproxy:
			prefs.TakeoverMode = takeover
			prefs.SystemProxy = true
			prefs.Tun = false
		case engine.ModeTun:
			prefs.TakeoverMode = takeover
			prefs.SystemProxy = false
			prefs.Tun = true
		case engine.ModePort:
			prefs.TakeoverMode = takeover
			prefs.SystemProxy = false
			prefs.Tun = false
		default:
			return fmt.Errorf("XBOND_TAKEOVER_MODE %q is invalid (want sysproxy, tun or port)", mode)
		}
	}
	if raw := os.Getenv("XBOND_ALLOW_LAN"); raw != "" {
		allowLan, err := strconv.ParseBool(raw)
		if err != nil {
			return fmt.Errorf("XBOND_ALLOW_LAN %q is invalid (want true or false)", raw)
		}
		prefs.AllowLan = allowLan
	}
	if raw := os.Getenv("XBOND_MIXED_PORT"); raw != "" {
		port, err := strconv.Atoi(raw)
		if err != nil || port < 1 || port > 65535 {
			return fmt.Errorf("XBOND_MIXED_PORT %q is invalid (want 1-65535)", raw)
		}
		prefs.MixedPort = port
		prefs.PortOverride = port
		prefs.PortSource = PortSourceOverride
	}
	return nil
}

func DefaultPreferences() RuntimePreferences {
	return RuntimePreferences{
		SystemProxy:  true,
		Tun:          false,
		TakeoverMode: engine.ModeSysproxy,
		RoutingMode:  engine.RoutingRule,
		MixedPort:    defaultMixedPort,
		AllowLan:     false,
		ClashPort:    legacyClashPort,
		ClashSecret:  engine.GenerateSecret(),
	}
}

func LoadPreferences() (RuntimePreferences, error) {
	prefs := DefaultPreferences()
	data, err := os.ReadFile(paths.RuntimeStatePath())
	if errors.Is(err, os.ErrNotExist) {
		if err := applyEnvOverrides(&prefs); err != nil {
			return RuntimePreferences{}, err
		}
		if err := ensureDaemonOwnedClashEndpoint(&prefs); err != nil {
			return RuntimePreferences{}, err
		}
		return prefs, nil
	}
	if err != nil {
		return RuntimePreferences{}, fmt.Errorf("read runtime preferences: %w", err)
	}
	if err := json.Unmarshal(data, &prefs); err != nil {
		return RuntimePreferences{}, fmt.Errorf("decode runtime preferences: %w", err)
	}
	// State files written before port following had no portOverride key and
	// their MixedPort was the fixed port; carry it over as an explicit
	// override so an upgrade never moves a working proxy port. New code
	// always persists the key, so this fires at most once per install.
	var legacy map[string]json.RawMessage
	if err := json.Unmarshal(data, &legacy); err != nil {
		return RuntimePreferences{}, fmt.Errorf("decode runtime preferences: %w", err)
	}
	if _, ok := legacy["portOverride"]; !ok {
		prefs.PortOverride = prefs.MixedPort
		prefs.PortSource = PortSourceOverride
	}
	if _, ok := legacy["systemProxy"]; !ok {
		if prefs.TakeoverMode == engine.ModeTun {
			prefs.Tun = true
			prefs.SystemProxy = false
		} else if prefs.TakeoverMode == engine.ModePort {
			prefs.Tun = false
			prefs.SystemProxy = false
		} else {
			prefs.SystemProxy = true
			prefs.Tun = false
		}
	}
	if prefs.Tun {
		prefs.TakeoverMode = engine.ModeTun
	} else if prefs.SystemProxy {
		prefs.TakeoverMode = engine.ModeSysproxy
	} else {
		prefs.TakeoverMode = engine.ModePort
	}
	if err := applyEnvOverrides(&prefs); err != nil {
		return RuntimePreferences{}, err
	}
	if err := validatePreferences(prefs); err != nil {
		return RuntimePreferences{}, err
	}
	if err := ensureDaemonOwnedClashEndpoint(&prefs); err != nil {
		return RuntimePreferences{}, err
	}
	return prefs, nil
}

// ensureDaemonOwnedClashEndpoint keeps the clash API a daemon-owned
// implementation detail: a random available port plus a random secret, read
// by clients from LocalAPI status and never surfaced in any UI. The legacy
// fixed default and ports grabbed by other processes are re-picked at
// startup and persisted, so restarts stay on one stable value.
func ensureDaemonOwnedClashEndpoint(prefs *RuntimePreferences) error {
	if prefs.ClashSecret == "" {
		prefs.ClashSecret = engine.GenerateSecret()
	}
	if prefs.ClashPort >= 1 && prefs.ClashPort != legacyClashPort && portAvailable(prefs.ClashPort) {
		return nil
	}
	for {
		port, err := randomFreePort()
		if err != nil {
			return err
		}
		if port == prefs.MixedPort {
			continue
		}
		prefs.ClashPort = port
		break
	}
	return savePreferences(*prefs)
}

func portAvailable(port int) bool {
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = listener.Close()
	return true
}

func randomFreePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("pick free clash port: %w", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

func savePreferences(prefs RuntimePreferences) error {
	data, err := json.Marshal(prefs)
	if err != nil {
		return err
	}
	return atomicfile.Write(paths.RuntimeStatePath(), data, 0o600)
}
