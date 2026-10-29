package sub

import "time"

type SubscriptionType string

const (
	SubTypeXBond     SubscriptionType = "xbond"
	SubTypeUniversal SubscriptionType = "universal"
)

type SubscriptionHealth string

const (
	HealthOK                 SubscriptionHealth = "ok"
	HealthCredentialInvalid  SubscriptionHealth = "credential_invalid"
	HealthQuotaExhausted     SubscriptionHealth = "quota_exhausted"
	HealthNoActivePlan       SubscriptionHealth = "no_active_plan"
	HealthAccountBanned      SubscriptionHealth = "account_banned"
	HealthProxyTokenConflict SubscriptionHealth = "proxy_token_conflict"
	HealthRateLimited        SubscriptionHealth = "rate_limited"
	HealthTransientError     SubscriptionHealth = "transient_error"
)

type QuotaInfo struct {
	UploadBytes   int64 `json:"uploadBytes"`
	DownloadBytes int64 `json:"downloadBytes"`
	TotalBytes    int64 `json:"totalBytes"`
	ExpireUnix    int64 `json:"expireUnix"`
}

type UpdateDiff struct {
	AddedNodes      []string          `json:"addedNodes"`
	RemovedNodes    []string          `json:"removedNodes"`
	AddedGroups     []string          `json:"addedGroups"`
	RemovedGroups   []string          `json:"removedGroups"`
	ResetSelections map[string]string `json:"resetSelections"`
	ReloadRequired  bool              `json:"reloadRequired"`
}

type SubscriptionMeta struct {
	ID                  string             `json:"id"`
	Name                string             `json:"name"`
	NameCustomized      bool               `json:"nameCustomized,omitempty"`
	Type                SubscriptionType   `json:"type"`
	SourceURL           string             `json:"sourceUrl,omitempty"`
	Token               string             `json:"token,omitempty"`
	Origin              string             `json:"origin,omitempty"`
	FallbackOrigins     []string           `json:"fallbackOrigins,omitempty"`
	Protocol            string             `json:"protocol,omitempty"`
	Lang                string             `json:"lang,omitempty"`
	AutoUpdate          bool               `json:"autoUpdate"`
	UpdateIntervalHours int                `json:"updateIntervalHours"`
	ETag                string             `json:"etag,omitempty"`
	ContentHash         string             `json:"contentHash,omitempty"`
	Quota               QuotaInfo          `json:"quota"`
	WebPageURL          string             `json:"webPageUrl,omitempty"`
	Health              SubscriptionHealth `json:"health"`
	LastErrorMessage    string             `json:"lastErrorMessage,omitempty"`
	LastCheckedAt       time.Time          `json:"lastCheckedAt"`
	LastUpdatedAt       time.Time          `json:"lastUpdatedAt"`
	SavedSelections     map[string]string  `json:"savedSelections,omitempty"`
	LastDiff            *UpdateDiff        `json:"lastDiff,omitempty"`
}

type SubscriptionsStore struct {
	ActiveID      string             `json:"activeId"`
	Subscriptions []SubscriptionMeta `json:"subscriptions"`
}

type UpdateResult struct {
	Meta           *SubscriptionMeta `json:"meta"`
	Diff           *UpdateDiff       `json:"diff"`
	ContentChanged bool              `json:"contentChanged"`
	StatusNotMod   bool              `json:"statusNotModified"`
}
