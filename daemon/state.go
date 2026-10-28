package daemon

import (
	"encoding/json"
	"os"

	"github.com/openxbond/xbond/engine"
	"github.com/openxbond/xbond/paths"
)

type RuntimePreferences struct {
	ActiveSubID  string              `json:"activeSubId"`
	TakeoverMode engine.TakeoverMode `json:"takeoverMode"`
	RoutingMode  engine.RoutingMode  `json:"routingMode"`
	MixedPort    int                 `json:"mixedPort"`
	AllowLan     bool                `json:"allowLan"`
	ClashPort    int                 `json:"clashPort"`
	ClashSecret  string              `json:"clashSecret"`
}

func DefaultPreferences() RuntimePreferences {
	return RuntimePreferences{
		TakeoverMode: engine.ModeSysproxy,
		RoutingMode:  engine.RoutingRule,
		MixedPort:    7890,
		AllowLan:     false,
		ClashPort:    9090,
		ClashSecret:  engine.GenerateSecret(),
	}
}

func LoadPreferences() RuntimePreferences {
	prefs := DefaultPreferences()
	data, err := os.ReadFile(paths.RuntimeStatePath())
	if err != nil {
		return prefs
	}
	_ = json.Unmarshal(data, &prefs)
	if prefs.MixedPort <= 0 {
		prefs.MixedPort = 7890
	}
	if prefs.ClashPort <= 0 {
		prefs.ClashPort = 9090
	}
	if prefs.ClashSecret == "" {
		prefs.ClashSecret = engine.GenerateSecret()
	}
	return prefs
}

func SavePreferences(prefs RuntimePreferences) error {
	data, err := json.MarshalIndent(prefs, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(paths.RuntimeStatePath(), data, 0o600)
}
