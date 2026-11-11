package sub

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
)

// versionLimit caps how many previous source versions each subscription
// keeps for rollback.
const versionLimit = 5

// SourceVersion describes one stored previous source snapshot.
type SourceVersion struct {
	Name    string    `json:"name"`
	Size    int       `json:"size"`
	SavedAt time.Time `json:"savedAt"`
}

// snapshotVersion stores the previous source as a rollback version and
// prunes the directory to the newest versionLimit entries.
func (m *Manager) snapshotVersion(id string, source []byte) error {
	dir := paths.SubVersionsPath(id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	name := fmt.Sprintf("%d.yaml", time.Now().UnixNano())
	if err := atomicfile.Write(filepath.Join(dir, name), source, 0o600); err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".yaml") {
			names = append(names, entry.Name())
		}
	}
	slices.Sort(names) // unix-nano names sort lexically
	for len(names) > versionLimit {
		if err := os.Remove(filepath.Join(dir, names[0])); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		names = names[1:]
	}
	return nil
}

// Versions lists the stored previous source versions, newest first.
func (m *Manager) Versions(id string) ([]SourceVersion, error) {
	if _, err := m.Get(id); err != nil {
		return nil, err
	}
	dir := paths.SubVersionsPath(id)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read source versions: %w", err)
	}
	versions := make([]SourceVersion, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".yaml") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		versions = append(versions, SourceVersion{
			Name:    entry.Name(),
			Size:    int(info.Size()),
			SavedAt: info.ModTime(),
		})
	}
	slices.SortFunc(versions, func(a, b SourceVersion) int {
		return strings.Compare(b.Name, a.Name)
	})
	return versions, nil
}

// Rollback restores the newest previous source version. The rollback is at
// the source layer: the override and daemon-owned derivation stay applied,
// and the outgoing source is snapshotted first so a rollback can be rolled
// back. The restored version passes the override splice and the core gate
// or nothing changes.
func (m *Manager) Rollback(id string) (*SubscriptionMeta, error) {
	meta, err := m.Get(id)
	if err != nil {
		return nil, err
	}
	versions, err := m.Versions(id)
	if err != nil {
		return nil, err
	}
	if len(versions) == 0 {
		return nil, fmt.Errorf("no previous version to roll back to; versions are captured on content-changing updates")
	}
	restored, err := os.ReadFile(filepath.Join(paths.SubVersionsPath(id), versions[0].Name))
	if err != nil {
		return nil, fmt.Errorf("read version %q: %w", versions[0].Name, err)
	}

	// The override rides the rollback: a version that conflicts with the
	// saved override fails before anything is written.
	override, err := m.Override(id)
	if err != nil {
		return nil, err
	}
	merged := restored
	if !override.IsZero() {
		merged, err = engine.ApplyOverride(restored, override)
		if err != nil {
			return nil, fmt.Errorf("rollback conflicts with the saved override: %w", err)
		}
		if err := engine.Validate(merged); err != nil {
			return nil, fmt.Errorf("rolled-back configuration failed validation: %w", err)
		}
	}

	current, readErr := os.ReadFile(paths.SubSourcePath(id))
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return nil, fmt.Errorf("read current source: %w", readErr)
	}

	diff := &UpdateDiff{ReloadRequired: true}
	if len(current) > 0 {
		diff, _ = ComputeUpdateDiff(current, restored)
	}

	// The outgoing source becomes a version itself: rollback is reversible.
	if len(current) > 0 {
		if err := m.snapshotVersion(id, current); err != nil {
			return nil, fmt.Errorf("snapshot current source: %w", err)
		}
	}
	if err := atomicfile.Write(paths.SubSourcePath(id), restored, 0o600); err != nil {
		return nil, fmt.Errorf("restore previous source: %w", err)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.store.Subscriptions {
		if m.store.Subscriptions[i].ID != meta.ID {
			continue
		}
		m.store.Subscriptions[i].ContentHash = hashBytes(restored)
		m.store.Subscriptions[i].LastUpdatedAt = time.Now()
		m.store.Subscriptions[i].Health = HealthOK
		m.store.Subscriptions[i].LastErrorMessage = ""
		m.store.Subscriptions[i].LastDiff = diff
		if err := m.saveStoreLocked(); err != nil {
			m.store.Subscriptions[i].ContentHash = meta.ContentHash
			m.store.Subscriptions[i].LastUpdatedAt = meta.LastUpdatedAt
			m.store.Subscriptions[i].Health = meta.Health
			m.store.Subscriptions[i].LastErrorMessage = meta.LastErrorMessage
			m.store.Subscriptions[i].LastDiff = meta.LastDiff
			return nil, fmt.Errorf("save subscription metadata: %w", err)
		}
		return &m.store.Subscriptions[i], nil
	}
	return nil, fmt.Errorf("subscription %q not found", meta.ID)
}
