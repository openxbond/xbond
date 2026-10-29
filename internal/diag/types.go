package diag

import (
	"time"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/sub"
	"github.com/openxbond/xbond/internal/version"
)

type ThreeTierStatus struct {
	CoreReachable      bool                `json:"coreReachable"`
	TrafficIntercepted bool                `json:"trafficIntercepted"`
	InterceptNote      string              `json:"interceptNote,omitempty"`
	EgressVerified     bool                `json:"egressVerified"`
	EgressLatencyMs    int                 `json:"egressLatencyMs"`
	TakeoverMode       engine.TakeoverMode `json:"takeoverMode"`
	RoutingMode        engine.RoutingMode  `json:"routingMode"`
	FocusStrategy      string              `json:"focusStrategy,omitempty"`
	StrategyChain      []string            `json:"strategyChain,omitempty"`
}

type DNSCheckResult struct {
	LocalDNSSuccess bool   `json:"localDnsSuccess"`
	LocalIPs        string `json:"localIPs,omitempty"`
	ProxyDNSSuccess bool   `json:"proxyDnsSuccess"`
	ProxyIPs        string `json:"proxyIPs,omitempty"`
	Error           string `json:"error,omitempty"`
}

type EgressCheckResult struct {
	DirectSuccess   bool   `json:"directSuccess"`
	DirectLatencyMs int    `json:"directLatencyMs"`
	ProxySuccess    bool   `json:"proxySuccess"`
	ProxyLatencyMs  int    `json:"proxyLatencyMs"`
	Error           string `json:"error,omitempty"`
}

type GatewayCheckResult struct {
	PrimaryOrigin    string   `json:"primaryOrigin"`
	PrimaryHealthy   bool     `json:"primaryHealthy"`
	FallbackOrigins  []string `json:"fallbackOrigins,omitempty"`
	FallbackStatuses []bool   `json:"fallbackStatuses,omitempty"`
}

type DoctorReport struct {
	Timestamp    time.Time             `json:"timestamp"`
	ThreeTier    ThreeTierStatus       `json:"threeTier"`
	DNS          DNSCheckResult        `json:"dns"`
	Egress       EgressCheckResult     `json:"egress"`
	Gateway      GatewayCheckResult    `json:"gateway"`
	Subscription *sub.SubscriptionMeta `json:"subscription,omitempty"`
}

type BugReport struct {
	GeneratedAt           time.Time             `json:"generatedAt"`
	VersionInfo           version.Info          `json:"versionInfo"`
	Doctor                DoctorReport          `json:"doctor"`
	ActiveSubscription    *sub.SubscriptionMeta `json:"activeSubscription,omitempty"`
	RuntimeConfigRedacted string                `json:"runtimeConfigRedacted"`
	RecentLogsRedacted    []engine.LogEntry     `json:"recentLogsRedacted"`
}
