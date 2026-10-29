package sub

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
)

type Manager struct {
	mu    sync.RWMutex
	store SubscriptionsStore
}

func NewManager() (*Manager, error) {
	if err := paths.EnsureDirs(); err != nil {
		return nil, err
	}

	m := &Manager{}
	_ = m.loadStore()
	return m, nil
}

func (m *Manager) loadStore() error {
	data, err := os.ReadFile(paths.SubListPath())
	if err != nil {
		m.store = SubscriptionsStore{
			Subscriptions: make([]SubscriptionMeta, 0),
		}
		return nil
	}

	var store SubscriptionsStore
	if err := json.Unmarshal(data, &store); err != nil {
		m.store = SubscriptionsStore{
			Subscriptions: make([]SubscriptionMeta, 0),
		}
		return nil
	}
	for i := range store.Subscriptions {
		if !store.Subscriptions[i].NameCustomized && strings.Contains(store.Subscriptions[i].Name, ";") {
			parts := strings.Split(store.Subscriptions[i].Name, ";")
			name := strings.Trim(parts[0], `"' `)
			name = strings.TrimSuffix(name, ".json")
			name = strings.TrimSuffix(name, ".yaml")
			store.Subscriptions[i].Name = name
		}
	}
	m.store = store
	return nil
}

func (m *Manager) saveStoreLocked() error {
	data, err := json.MarshalIndent(m.store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(paths.SubListPath(), data, 0o600)
}

func (m *Manager) ActiveID() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.store.ActiveID
}

func (m *Manager) List() []SubscriptionMeta {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := make([]SubscriptionMeta, len(m.store.Subscriptions))
	copy(list, m.store.Subscriptions)
	return list
}

func (m *Manager) Get(idOrName string) (*SubscriptionMeta, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, s := range m.store.Subscriptions {
		if s.ID == idOrName || s.Name == idOrName {
			cp := s
			return &cp, nil
		}
	}
	return nil, fmt.Errorf("subscription %q not found", idOrName)
}

func (m *Manager) Use(idOrName string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var targetID string
	for _, s := range m.store.Subscriptions {
		if s.ID == idOrName || s.Name == idOrName {
			targetID = s.ID
			break
		}
	}
	if targetID == "" {
		return fmt.Errorf("subscription %q not found", idOrName)
	}

	m.store.ActiveID = targetID
	return m.saveStoreLocked()
}

func (m *Manager) Remove(idOrName string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	idx := -1
	for i, s := range m.store.Subscriptions {
		if s.ID == idOrName || s.Name == idOrName {
			idx = i
			break
		}
	}
	if idx == -1 {
		return fmt.Errorf("subscription %q not found", idOrName)
	}

	subID := m.store.Subscriptions[idx].ID
	m.store.Subscriptions = append(m.store.Subscriptions[:idx], m.store.Subscriptions[idx+1:]...)
	if m.store.ActiveID == subID {
		if len(m.store.Subscriptions) > 0 {
			m.store.ActiveID = m.store.Subscriptions[0].ID
		} else {
			m.store.ActiveID = ""
		}
	}

	_ = os.RemoveAll(paths.SubDir(subID))
	return m.saveStoreLocked()
}

// Rename changes the display name without replacing configuration or credentials.
func (m *Manager) Rename(id, name string) error {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 256 {
		return fmt.Errorf("subscription name must contain 1 to 256 characters")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	index := -1
	for i, item := range m.store.Subscriptions {
		if item.ID == id {
			index = i
		}
		if item.ID != id && item.Name == name {
			return fmt.Errorf("subscription name already exists")
		}
	}
	if index < 0 {
		return fmt.Errorf("subscription not found")
	}
	previous := m.store.Subscriptions[index].Name
	previousCustomized := m.store.Subscriptions[index].NameCustomized
	m.store.Subscriptions[index].Name = name
	m.store.Subscriptions[index].NameCustomized = true
	if err := m.saveStoreLocked(); err != nil {
		m.store.Subscriptions[index].Name = previous
		m.store.Subscriptions[index].NameCustomized = previousCustomized
		return err
	}
	return nil
}

func (m *Manager) SaveSelection(subID, group, node string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i := range m.store.Subscriptions {
		if m.store.Subscriptions[i].ID == subID {
			if m.store.Subscriptions[i].SavedSelections == nil {
				m.store.Subscriptions[i].SavedSelections = make(map[string]string)
			}
			m.store.Subscriptions[i].SavedSelections[group] = node
			return m.saveStoreLocked()
		}
	}
	return fmt.Errorf("subscription %q not found", subID)
}

func (m *Manager) AddXBond(
	token, origin string,
	fallbackOrigins []string,
	protocol, lang, name string,
	intervalHours int,
	activate bool,
) (*SubscriptionMeta, error) {
	if token == "" {
		return nil, fmt.Errorf("subscription token cannot be empty")
	}
	if !strings.HasPrefix(token, "sub-") {
		return nil, fmt.Errorf("xbond token must start with 'sub-'")
	}

	if origin == "" {
		origin = "https://www.xbond.net"
	}
	if protocol == "" {
		protocol = "vless-reality"
	}
	lang = normalizeRenderLang(lang)
	if intervalHours <= 0 {
		intervalHours = 24
	}

	subID := fmt.Sprintf("sub_%s", hashString(token)[:12])
	if name == "" {
		name = fmt.Sprintf("XBond-%s", subID[4:8])
	}

	meta := SubscriptionMeta{
		ID:                  subID,
		Name:                name,
		Type:                SubTypeXBond,
		Token:               token,
		Origin:              origin,
		FallbackOrigins:     fallbackOrigins,
		Protocol:            protocol,
		Lang:                lang,
		AutoUpdate:          true,
		UpdateIntervalHours: intervalHours,
		Health:              HealthOK,
		SavedSelections:     make(map[string]string),
	}

	return m.upsertAndInit(meta, activate)
}

func (m *Manager) AddUniversal(
	urlOrPath, name string,
	intervalHours int,
	activate bool,
) (*SubscriptionMeta, error) {
	if urlOrPath == "" {
		return nil, fmt.Errorf("url or path cannot be empty")
	}
	if intervalHours <= 0 {
		intervalHours = 24
	}

	subID := fmt.Sprintf("uni_%s", hashString(urlOrPath)[:12])
	if name == "" {
		name = fmt.Sprintf("Universal-%s", subID[4:8])
	}

	meta := SubscriptionMeta{
		ID:                  subID,
		Name:                name,
		Type:                SubTypeUniversal,
		SourceURL:           urlOrPath,
		AutoUpdate:          true,
		UpdateIntervalHours: intervalHours,
		Health:              HealthOK,
		SavedSelections:     make(map[string]string),
	}

	return m.upsertAndInit(meta, activate)
}

func (m *Manager) upsertAndInit(meta SubscriptionMeta, activate bool) (*SubscriptionMeta, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	_ = os.MkdirAll(paths.SubDir(meta.ID), 0o700)

	found := false
	for i, s := range m.store.Subscriptions {
		if s.ID == meta.ID {
			m.store.Subscriptions[i] = meta
			found = true
			break
		}
	}
	if !found {
		m.store.Subscriptions = append(m.store.Subscriptions, meta)
	}

	if activate || m.store.ActiveID == "" {
		m.store.ActiveID = meta.ID
	}

	if err := m.saveStoreLocked(); err != nil {
		return nil, err
	}

	return &meta, nil
}

func (m *Manager) Update(
	idOrName string,
	force bool,
	viaProxy bool,
	proxyPort int,
) (*UpdateResult, error) {
	subMeta, err := m.Get(idOrName)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	var rawContent []byte
	var quotaFromResp *QuotaInfo
	var etagFromResp string
	var intervalFromResp int
	var webPageURL string
	var filename string
	var statusNotModified bool

	etag := subMeta.ETag
	if force {
		etag = ""
	}

	if subMeta.Type == SubTypeXBond {
		fetchURL := BuildXBondURL(subMeta.Origin, subMeta.Token, subMeta.Protocol, subMeta.Lang)
		resp, err := FetchSubscription(ctx, fetchURL, FetchOptions{
			ETag:      etag,
			ViaProxy:  viaProxy,
			ProxyPort: proxyPort,
		})

		// Try fallback origins if primary fails with transient error
		if err != nil && len(subMeta.FallbackOrigins) > 0 {
			for _, fallback := range subMeta.FallbackOrigins {
				if ok, _ := ProbeGatewayHealth(ctx, fallback, viaProxy, proxyPort); ok {
					subMeta.Origin = fallback
					fetchURL = BuildXBondURL(fallback, subMeta.Token, subMeta.Protocol, subMeta.Lang)
					resp, err = FetchSubscription(ctx, fetchURL, FetchOptions{
						ETag:      etag,
						ViaProxy:  viaProxy,
						ProxyPort: proxyPort,
					})
					if err == nil {
						break
					}
				}
			}
		}

		if resp != nil {
			subMeta.Health = resp.Health
			subMeta.LastErrorMessage = resp.ErrorMessage
			etagFromResp = resp.ETag
			quotaFromResp = resp.Quota
			intervalFromResp = resp.UpdateInterval
			webPageURL = resp.WebPageURL
			filename = resp.Filename
			statusNotModified = resp.NotModified
			rawContent = resp.Body
		}

		if err != nil {
			m.recordError(subMeta.ID, subMeta.Health, subMeta.LastErrorMessage)
			return nil, err
		}

	} else {
		// Universal subscription (URL or local file)
		if strings.HasPrefix(subMeta.SourceURL, "http://") || strings.HasPrefix(subMeta.SourceURL, "https://") {
			resp, err := FetchSubscription(ctx, subMeta.SourceURL, FetchOptions{
				ETag:      etag,
				ViaProxy:  viaProxy,
				ProxyPort: proxyPort,
			})
			if resp != nil {
				subMeta.Health = resp.Health
				subMeta.LastErrorMessage = resp.ErrorMessage
				etagFromResp = resp.ETag
				quotaFromResp = resp.Quota
				intervalFromResp = resp.UpdateInterval
				webPageURL = resp.WebPageURL
				filename = resp.Filename
				statusNotModified = resp.NotModified
				rawContent = resp.Body
			}
			if err != nil {
				m.recordError(subMeta.ID, subMeta.Health, subMeta.LastErrorMessage)
				return nil, err
			}
		} else {
			// Local file
			fileData, err := os.ReadFile(subMeta.SourceURL)
			if err != nil {
				m.recordError(subMeta.ID, HealthTransientError, err.Error())
				return nil, fmt.Errorf("failed to read local file %q: %w", subMeta.SourceURL, err)
			}
			rawContent = fileData
		}
	}

	// 1. Handle 304 Not Modified
	if statusNotModified {
		m.recordCheck(subMeta.ID, etagFromResp, quotaFromResp, intervalFromResp, webPageURL)
		return &UpdateResult{
			Meta:         subMeta,
			StatusNotMod: true,
		}, nil
	}

	// 2. Format conversion & validation gate
	convertedJSON, quotaFromYAML, err := DetectAndConvert(rawContent)
	if err != nil {
		m.recordError(subMeta.ID, HealthTransientError, fmt.Sprintf("format detection failed: %v", err))
		return nil, err
	}
	if quotaFromResp == nil && quotaFromYAML != nil {
		quotaFromResp = quotaFromYAML
	}

	if err := engine.Validate(convertedJSON); err != nil {
		m.recordError(subMeta.ID, HealthTransientError, fmt.Sprintf("validation gate failed: %v", err))
		return nil, fmt.Errorf("configuration validation gate failed: %w (source left untouched)", err)
	}

	// 3. Compute SHA-256 hash & check if content changed
	newHash := hashBytes(convertedJSON)
	var oldSource []byte
	oldSource, _ = os.ReadFile(paths.SubSourcePath(subMeta.ID))
	oldHash := hashBytes(oldSource)

	contentChanged := (oldHash != newHash) || len(oldSource) == 0

	var diff *UpdateDiff
	if len(oldSource) > 0 {
		diff, _ = ComputeUpdateDiff(oldSource, convertedJSON)
	} else {
		diff = &UpdateDiff{ReloadRequired: true}
	}

	if !contentChanged {
		m.recordCheck(subMeta.ID, etagFromResp, quotaFromResp, intervalFromResp, webPageURL)
		return &UpdateResult{
			Meta:           subMeta,
			Diff:           diff,
			ContentChanged: false,
		}, nil
	}

	// 4. Atomically write source config
	if err := os.WriteFile(paths.SubSourcePath(subMeta.ID), convertedJSON, 0o600); err != nil {
		return nil, fmt.Errorf("failed to write source config: %w", err)
	}

	// 5. Update metadata
	m.mu.Lock()
	for i := range m.store.Subscriptions {
		if m.store.Subscriptions[i].ID == subMeta.ID {
			m.store.Subscriptions[i].Health = HealthOK
			m.store.Subscriptions[i].LastErrorMessage = ""
			m.store.Subscriptions[i].LastCheckedAt = time.Now()
			m.store.Subscriptions[i].LastUpdatedAt = time.Now()
			m.store.Subscriptions[i].ContentHash = newHash
			if etagFromResp != "" {
				m.store.Subscriptions[i].ETag = etagFromResp
			}
			if quotaFromResp != nil {
				m.store.Subscriptions[i].Quota = *quotaFromResp
			}
			if intervalFromResp > 0 {
				m.store.Subscriptions[i].UpdateIntervalHours = intervalFromResp
			}
			if webPageURL != "" {
				m.store.Subscriptions[i].WebPageURL = webPageURL
			}
			if filename != "" && !m.store.Subscriptions[i].NameCustomized && strings.HasPrefix(m.store.Subscriptions[i].Name, "XBond-") {
				m.store.Subscriptions[i].Name = filename
			}
			m.store.Subscriptions[i].LastDiff = diff
			subMeta = &m.store.Subscriptions[i]
			break
		}
	}
	_ = m.saveStoreLocked()
	m.mu.Unlock()

	return &UpdateResult{
		Meta:           subMeta,
		Diff:           diff,
		ContentChanged: true,
	}, nil
}

func (m *Manager) recordCheck(
	id string,
	etag string,
	quota *QuotaInfo,
	interval int,
	webPageURL string,
) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i := range m.store.Subscriptions {
		if m.store.Subscriptions[i].ID == id {
			m.store.Subscriptions[i].Health = HealthOK
			m.store.Subscriptions[i].LastErrorMessage = ""
			m.store.Subscriptions[i].LastCheckedAt = time.Now()
			if etag != "" {
				m.store.Subscriptions[i].ETag = etag
			}
			if quota != nil {
				m.store.Subscriptions[i].Quota = *quota
			}
			if interval > 0 {
				m.store.Subscriptions[i].UpdateIntervalHours = interval
			}
			if webPageURL != "" {
				m.store.Subscriptions[i].WebPageURL = webPageURL
			}
			break
		}
	}
	_ = m.saveStoreLocked()
}

func (m *Manager) recordError(id string, health SubscriptionHealth, msg string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i := range m.store.Subscriptions {
		if m.store.Subscriptions[i].ID == id {
			m.store.Subscriptions[i].Health = health
			m.store.Subscriptions[i].LastErrorMessage = msg
			m.store.Subscriptions[i].LastCheckedAt = time.Now()
			break
		}
	}
	_ = m.saveStoreLocked()
}

func ComputeUpdateDiff(oldSource, newSource []byte) (*UpdateDiff, error) {
	oldNodes, oldGroups, err := extractOutbounds(oldSource)
	if err != nil {
		return nil, err
	}
	newNodes, newGroups, err := extractOutbounds(newSource)
	if err != nil {
		return nil, err
	}

	addedNodes := difference(newNodes, oldNodes)
	removedNodes := difference(oldNodes, newNodes)
	addedGroups := difference(newGroups, oldGroups)
	removedGroups := difference(oldGroups, newGroups)

	reloadReq := len(addedNodes) > 0 || len(removedNodes) > 0 || len(addedGroups) > 0 || len(removedGroups) > 0

	return &UpdateDiff{
		AddedNodes:      addedNodes,
		RemovedNodes:    removedNodes,
		AddedGroups:     addedGroups,
		RemovedGroups:   removedGroups,
		ResetSelections: make(map[string]string),
		ReloadRequired:  reloadReq,
	}, nil
}

func extractOutbounds(source []byte) (nodes []string, groups []string, err error) {
	var raw struct {
		Outbounds []struct {
			Type string `json:"type"`
			Tag  string `json:"tag"`
		} `json:"outbounds"`
	}
	if err := json.Unmarshal(source, &raw); err != nil {
		return nil, nil, err
	}

	for _, ob := range raw.Outbounds {
		if ob.Type == "selector" || ob.Type == "urltest" {
			groups = append(groups, ob.Tag)
		} else if ob.Type != "direct" && ob.Type != "block" && ob.Type != "dns" {
			nodes = append(nodes, ob.Tag)
		}
	}
	sort.Strings(nodes)
	sort.Strings(groups)
	return nodes, groups, nil
}

func difference(a, b []string) []string {
	bMap := make(map[string]struct{}, len(b))
	for _, x := range b {
		bMap[x] = struct{}{}
	}
	var diff []string
	for _, x := range a {
		if _, found := bMap[x]; !found {
			diff = append(diff, x)
		}
	}
	return diff
}

func NextScheduledTick(now time.Time, interval time.Duration) time.Duration {
	if interval < 10*time.Minute {
		interval = 10 * time.Minute
	}
	if interval > 168*time.Hour {
		interval = 168 * time.Hour
	}

	// Anchor: 04:00:00 local time
	anchorToday := time.Date(now.Year(), now.Month(), now.Day(), 4, 0, 0, 0, now.Location())
	target := anchorToday

	for target.Before(now) || target.Equal(now) {
		target = target.Add(interval)
	}

	return target.Sub(now)
}

func NextDailyTick(now time.Time, targetHour, targetMin int) time.Duration {
	target := time.Date(now.Year(), now.Month(), now.Day(), targetHour, targetMin, 0, 0, now.Location())
	if target.Before(now) || target.Equal(now) {
		target = target.Add(24 * time.Hour)
	}
	return target.Sub(now)
}

func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func hashBytes(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
