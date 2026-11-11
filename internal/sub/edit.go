package sub

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
)

// checkOverrideGate runs the core gate on the converted source and, when the
// subscription carries a local override, on the merged document. Every
// failure is recorded on the meta and returned with the given context label
// so update and source-edit failures stay distinguishable.
func (m *Manager) checkOverrideGate(id string, converted []byte, context string) error {
	if err := engine.Validate(converted); err != nil {
		m.recordError(id, HealthTransientError, fmt.Sprintf("%s validation gate failed: %v", context, err))
		return fmt.Errorf("configuration validation gate failed: %w (source left untouched)", err)
	}
	override, err := m.Override(id)
	if err != nil {
		m.recordError(id, HealthTransientError, fmt.Sprintf("read local override: %v", err))
		return fmt.Errorf("read local override: %w", err)
	}
	if override.IsZero() {
		return nil
	}
	merged, err := engine.ApplyOverride(converted, override)
	if err != nil {
		m.recordError(id, HealthTransientError, fmt.Sprintf("override conflict: %v", err))
		return fmt.Errorf("local override conflicts with the upstream configuration: %w", err)
	}
	if err := engine.Validate(merged); err != nil {
		m.recordError(id, HealthTransientError, fmt.Sprintf("override validation failed: %v", err))
		return fmt.Errorf("overridden configuration failed validation: %w (source left untouched)", err)
	}
	return nil
}

// EditSource replaces the subscription's source with user-provided content
// (client-rethink §四.2: 原始内容编辑产生本地副本). The edited copy is
// validated through the same gates as an update — detection, the core gate
// and the saved override — and pins the subscription: automatic updates no
// longer overwrite it. An explicit manual update removes the pin. The
// outgoing source becomes a rollback version, so the edit stays reversible.
func (m *Manager) EditSource(id string, content []byte) (*SubscriptionMeta, error) {
	meta, err := m.Get(id)
	if err != nil {
		return nil, err
	}
	converted, format, _, err := DetectAndConvert(content)
	if err != nil {
		m.recordError(meta.ID, HealthTransientError, fmt.Sprintf("source edit rejected: %v", err))
		return nil, fmt.Errorf("edited source is not usable: %w", err)
	}
	if err := m.checkOverrideGate(meta.ID, converted, "source edit"); err != nil {
		return nil, err
	}

	current, readErr := os.ReadFile(paths.SubSourcePath(meta.ID))
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return nil, fmt.Errorf("read current source: %w", readErr)
	}
	changed := len(current) == 0 || !bytes.Equal(current, converted)
	if changed && len(current) > 0 {
		if err := m.snapshotVersion(meta.ID, current); err != nil {
			return nil, fmt.Errorf("snapshot current source: %w", err)
		}
	}
	if !changed {
		// Same content, but the pin intent still applies.
		return m.SetSourcePinned(meta.ID, true)
	}
	if err := atomicfile.Write(paths.SubSourcePath(meta.ID), converted, 0o600); err != nil {
		return nil, fmt.Errorf("write edited source: %w", err)
	}

	diff := &UpdateDiff{ReloadRequired: true}
	if len(current) > 0 {
		diff, _ = ComputeUpdateDiff(current, converted)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.store.Subscriptions {
		if m.store.Subscriptions[i].ID != meta.ID {
			continue
		}
		previous := m.store.Subscriptions[i]
		m.store.Subscriptions[i].Format = format
		m.store.Subscriptions[i].ContentHash = hashBytes(converted)
		m.store.Subscriptions[i].LastUpdatedAt = time.Now()
		m.store.Subscriptions[i].SourcePinned = true
		m.store.Subscriptions[i].Health = HealthOK
		m.store.Subscriptions[i].LastErrorMessage = ""
		m.store.Subscriptions[i].LastDiff = diff
		if err := m.saveStoreLocked(); err != nil {
			m.store.Subscriptions[i] = previous
			restoreErr := atomicfile.Write(paths.SubSourcePath(meta.ID), current, 0o600)
			return nil, errors.Join(fmt.Errorf("save subscription metadata: %w", err), restoreErr)
		}
		edited := m.store.Subscriptions[i]
		return &edited, nil
	}
	return nil, fmt.Errorf("subscription %q not found", meta.ID)
}

// SetSourcePinned toggles the pin that protects an edited source from
// automatic updates. Manual updates always remove it.
func (m *Manager) SetSourcePinned(id string, pinned bool) (*SubscriptionMeta, error) {
	meta, err := m.Get(id)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.store.Subscriptions {
		if m.store.Subscriptions[i].ID != meta.ID {
			continue
		}
		if m.store.Subscriptions[i].SourcePinned == pinned {
			current := m.store.Subscriptions[i]
			return &current, nil
		}
		m.store.Subscriptions[i].SourcePinned = pinned
		if err := m.saveStoreLocked(); err != nil {
			m.store.Subscriptions[i].SourcePinned = !pinned
			return nil, fmt.Errorf("save subscription metadata: %w", err)
		}
		updated := m.store.Subscriptions[i]
		return &updated, nil
	}
	return nil, fmt.Errorf("subscription %q not found", meta.ID)
}
