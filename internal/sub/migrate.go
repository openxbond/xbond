package sub

import (
	"errors"
	"fmt"
	"os"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
)

// MigrateLegacySources backfills the core format on subscriptions stored
// before the dual-core swap. Both source formats run natively, so no content
// is converted: the daemon only learns which core owns each subscription.
// Sources that neither core understands are flagged for a refresh or
// re-import. It runs once per daemon start before anything can apply a
// runtime config.
func (m *Manager) MigrateLegacySources() {
	m.mu.Lock()
	defer m.mu.Unlock()

	migrated := false
	for i := range m.store.Subscriptions {
		meta := &m.store.Subscriptions[i]
		if meta.Format != "" {
			continue
		}
		source, err := os.ReadFile(paths.SubSourcePath(meta.ID))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			meta.Health = HealthTransientError
			meta.LastErrorMessage = fmt.Sprintf("read stored configuration: %v", err)
			migrated = true
			continue
		}
		format, err := engine.DetectFormat(source)
		if err != nil {
			meta.Health = HealthTransientError
			meta.LastErrorMessage = fmt.Sprintf("stored configuration is unusable: %v; update or re-add the subscription", err)
			migrated = true
			continue
		}
		meta.Format = format
		migrated = true
	}

	if migrated {
		_ = m.saveStoreLocked()
	}
}
