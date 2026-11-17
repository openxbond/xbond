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

// Override returns the subscription's structured local override, or nil when
// none is saved. A corrupt file is an error, not a silent reset.
func (m *Manager) Override(id string) (*engine.SubscriptionOverride, error) {
	if _, err := m.Get(id); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(paths.SubOverridePath(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read local override: %w", err)
	}
	var override engine.SubscriptionOverride
	if err := json.Unmarshal(data, &override); err != nil {
		return nil, fmt.Errorf("decode local override: %w", err)
	}
	normalized, err := override.Normalize()
	if err != nil {
		return nil, fmt.Errorf("stored local override is invalid: %w", err)
	}
	return normalized, nil
}

// SetOverride saves the structured local override for one subscription. A
// zero override removes the stored file; anything else is normalized first so
// what lands on disk is already what derivation will use. Saving validates
// the merged document against the stored source, so an override that already
// conflicts (references a missing target, breaks the core gate) is rejected
// at save time; upstream removals surface later as update conflicts.
func (m *Manager) SetOverride(id string, override *engine.SubscriptionOverride) error {
	if _, err := m.Get(id); err != nil {
		return err
	}
	normalized, err := override.Normalize()
	if err != nil {
		return err
	}
	path := paths.SubOverridePath(id)
	if normalized.IsZero() {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove local override: %w", err)
		}
		return nil
	}
	if source, err := os.ReadFile(paths.SubSourcePath(id)); err == nil {
		merged, err := engine.ApplyOverride(source, normalized)
		if err != nil {
			return fmt.Errorf("override conflicts with the stored configuration: %w", err)
		}
		if err := engine.Validate(merged); err != nil {
			return fmt.Errorf("overridden configuration failed validation: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read source configuration: %w", err)
	}
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.Write(path, data, 0o600)
}
