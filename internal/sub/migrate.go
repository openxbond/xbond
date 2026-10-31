package sub

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
)

// isLegacySingBoxSource reports whether stored bytes are a sing-box JSON
// document — the canonical format before the mihomo core swap.
func isLegacySingBoxSource(content []byte) bool {
	trimmed := bytes.TrimSpace(content)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return false
	}
	var probe map[string]any
	if json.Unmarshal(trimmed, &probe) != nil {
		return false
	}
	_, hasOutbounds := probe["outbounds"]
	return hasOutbounds
}

// MigrateLegacySources rewrites stored sing-box JSON sources into the
// canonical Clash YAML. It runs once per daemon start before anything can
// apply a runtime config. Strict conversion runs first; when the
// configuration cannot be preserved, the subscription falls back to
// node-only mode (recorded on the meta so later updates stay consistent)
// rather than being left unusable. Subscriptions that cannot be converted at
// all are flagged with a transient error asking for a refresh or re-import.
func (m *Manager) MigrateLegacySources() {
	m.mu.Lock()
	defer m.mu.Unlock()

	migrated := false
	for i := range m.store.Subscriptions {
		meta := &m.store.Subscriptions[i]
		sourcePath := paths.SubSourcePath(meta.ID)
		source, err := os.ReadFile(sourcePath)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			meta.Health = HealthTransientError
			meta.LastErrorMessage = fmt.Sprintf("read stored configuration: %v", err)
			migrated = true
			continue
		}
		if !isLegacySingBoxSource(source) {
			continue
		}
		// Every path below mutates the meta (converted source, node-only
		// fallback flag, or an error record), so the store always needs a save.
		migrated = true

		converted, _, err := DetectAndConvert(source, false)
		if err != nil {
			converted, _, err = DetectAndConvert(source, true)
			if err != nil {
				meta.Health = HealthTransientError
				meta.LastErrorMessage = fmt.Sprintf("migrate to mihomo core failed: %v; update or re-add the subscription", err)
				continue
			}
			meta.ClashNodesOnly = true
		}
		if err := engine.Validate(converted); err != nil {
			meta.Health = HealthTransientError
			meta.LastErrorMessage = fmt.Sprintf("migrated configuration failed validation: %v; update or re-add the subscription", err)
			continue
		}
		if err := atomicfile.Write(sourcePath, converted, 0o600); err != nil {
			meta.Health = HealthTransientError
			meta.LastErrorMessage = fmt.Sprintf("save migrated configuration: %v", err)
			continue
		}
		meta.ContentHash = hashBytes(converted)
	}

	if migrated {
		_ = m.saveStoreLocked()
	}
}
