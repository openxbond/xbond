package sub

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
)

// GlobalMixin returns the system-wide global mixin, or an empty mixin when none is saved.
// A corrupt file is an error, not a silent reset.
func (m *Manager) GlobalMixin() (*engine.GlobalMixin, error) {
	data, err := os.ReadFile(paths.GlobalMixinPath())
	if errors.Is(err, os.ErrNotExist) {
		return &engine.GlobalMixin{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read global mixin: %w", err)
	}
	var mixin engine.GlobalMixin
	if err := json.Unmarshal(data, &mixin); err != nil {
		return nil, fmt.Errorf("decode global mixin: %w", err)
	}
	return &mixin, nil
}

// SetGlobalMixin saves the global mixin. If an active profile exists with
// source on disk, it validates the merged configuration against the core gate.
func (m *Manager) SetGlobalMixin(mixin *engine.GlobalMixin) error {
	path := paths.GlobalMixinPath()
	if mixin.IsZero() {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove global mixin: %w", err)
		}
		return nil
	}

	// Validate against the active subscription if one is present and loaded
	activeID := m.ActiveID()
	if activeID != "" {
		if source, err := os.ReadFile(paths.SubSourcePath(activeID)); err == nil {
			override, _ := m.Override(activeID)
			merged, err := engine.ApplyLayers(source, override, mixin)
			if err != nil {
				return fmt.Errorf("global mixin conflicts with active configuration: %w", err)
			}
			if err := engine.Validate(merged); err != nil {
				return fmt.Errorf("active configuration with global mixin failed validation: %w", err)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("read active source configuration: %w", err)
		}
	}

	data, err := json.MarshalIndent(mixin, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.Write(path, data, 0o600)
}
