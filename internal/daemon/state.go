package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
)

type RuntimePreferences struct {
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

func LoadPreferences() (RuntimePreferences, error) {
	prefs := DefaultPreferences()
	data, err := os.ReadFile(paths.RuntimeStatePath())
	if errors.Is(err, os.ErrNotExist) {
		return prefs, nil
	}
	if err != nil {
		return RuntimePreferences{}, fmt.Errorf("read runtime preferences: %w", err)
	}
	if err := json.Unmarshal(data, &prefs); err != nil {
		return RuntimePreferences{}, fmt.Errorf("decode runtime preferences: %w", err)
	}
	if err := validatePreferences(prefs); err != nil {
		return RuntimePreferences{}, err
	}
	return prefs, nil
}
