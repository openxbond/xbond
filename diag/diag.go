package diag

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/openxbond/xbond/engine"
	"github.com/openxbond/xbond/paths"
	"github.com/openxbond/xbond/sub"
	"github.com/openxbond/xbond/sysproxy"
	"github.com/openxbond/xbond/version"
)

func EvaluateThreeTier(
	ctx context.Context,
	mgr *engine.Manager,
	mode engine.TakeoverMode,
	routing engine.RoutingMode,
	mixedPort int,
) ThreeTierStatus {
	st := ThreeTierStatus{
		TakeoverMode: mode,
		RoutingMode:  routing,
	}

	if mode == engine.ModePort {
		st.TrafficIntercepted = false
		st.InterceptNote = "port mode only, whole-system not intercepted"
	}

	if mgr == nil || !mgr.IsRunning() {
		return st
	}

	// 1. Tier 1: Core Reachable
	client := mgr.Client()
	if client != nil {
		if ver, err := client.GetVersion(ctx); err == nil && ver != "" {
			st.CoreReachable = true
		}
	}

	// 2. Tier 2: Traffic Intercepted
	switch mode {
	case engine.ModeSysproxy:
		snap, err := sysproxy.Get()
		if err == nil && snap.Enabled && strings.Contains(snap.Server, fmt.Sprintf("%d", mixedPort)) {
			st.TrafficIntercepted = true
		}
	case engine.ModeTun:
		// When in TUN mode and engine is running, sing-tun is active
		if st.CoreReachable {
			st.TrafficIntercepted = true
		}
	case engine.ModePort:
		st.TrafficIntercepted = false
		st.InterceptNote = "port mode only, whole-system not intercepted"
	}

	// 3. Tier 3: Egress Verified via local mixed port
	if mixedPort > 0 {
		proxyURL, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", mixedPort))
		testClient := &http.Client{
			Transport: &http.Transport{
				Proxy: http.ProxyURL(proxyURL),
			},
			Timeout: 4 * time.Second,
		}

		start := time.Now()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.gstatic.com/generate_204", nil)
		if err == nil {
			resp, err := testClient.Do(req)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusOK {
					st.EgressVerified = true
					st.EgressLatencyMs = int(time.Since(start).Milliseconds())
				}
			}
		}
	}

	// 4. Focus strategy chain
	if client != nil {
		if proxies, err := client.GetProxies(ctx); err == nil {
			st.FocusStrategy, st.StrategyChain = ResolveStrategyChain(proxies)
		}
	}

	return st
}

func ResolveStrategyChain(proxies map[string]engine.ProxyItem) (string, []string) {
	if len(proxies) == 0 {
		return "", nil
	}

	// Candidates for root group
	rootCandidates := []string{"🔥節點選擇", "Proxy", "GLOBAL", "🚀 节点选择", "PROXY"}
	var rootGroup string
	for _, cand := range rootCandidates {
		if item, ok := proxies[cand]; ok && (item.Type == "Selector" || item.Type == "URLTest") {
			rootGroup = cand
			break
		}
	}

	if rootGroup == "" {
		for name, item := range proxies {
			if item.Type == "Selector" {
				rootGroup = name
				break
			}
		}
	}

	if rootGroup == "" {
		return "", nil
	}

	chain := []string{rootGroup}
	visited := map[string]bool{rootGroup: true}
	curr := rootGroup

	for i := 0; i < 8; i++ {
		item, exists := proxies[curr]
		if !exists || item.Now == "" {
			break
		}
		next := item.Now
		chain = append(chain, next)
		if visited[next] {
			break
		}
		visited[next] = true

		nextItem, hasNext := proxies[next]
		if !hasNext || (nextItem.Type != "Selector" && nextItem.Type != "URLTest") {
			break
		}
		curr = next
	}

	return rootGroup, chain
}

func RunDoctor(
	ctx context.Context,
	mgr *engine.Manager,
	subMgr *sub.Manager,
	mode engine.TakeoverMode,
	routing engine.RoutingMode,
	mixedPort int,
) DoctorReport {
	threeTier := EvaluateThreeTier(ctx, mgr, mode, routing, mixedPort)

	// 1. DNS check
	dnsRes := DNSCheckResult{}
	if ips, err := net.LookupIP("google.com"); err == nil && len(ips) > 0 {
		dnsRes.LocalDNSSuccess = true
		dnsRes.LocalIPs = ips[0].String()
	}

	if mgr != nil && mgr.Client() != nil {
		if queryResp, err := mgr.Client().QueryDNS(ctx, "google.com", "A"); err == nil && len(queryResp.Answer) > 0 {
			dnsRes.ProxyDNSSuccess = true
			dnsRes.ProxyIPs = queryResp.Answer[0].Data
		}
	}

	// 2. Direct vs Proxy egress
	egressRes := EgressCheckResult{}
	directClient := &http.Client{
		Transport: &http.Transport{Proxy: nil},
		Timeout:   3 * time.Second,
	}
	dStart := time.Now()
	if resp, err := directClient.Get("https://www.gstatic.com/generate_204"); err == nil {
		resp.Body.Close()
		egressRes.DirectSuccess = true
		egressRes.DirectLatencyMs = int(time.Since(dStart).Milliseconds())
	}

	egressRes.ProxySuccess = threeTier.EgressVerified
	egressRes.ProxyLatencyMs = threeTier.EgressLatencyMs

	// 3. Active subscription & gateway health
	var activeSub *sub.SubscriptionMeta
	gwRes := GatewayCheckResult{}
	if subMgr != nil {
		activeID := subMgr.ActiveID()
		if activeID != "" {
			if s, err := subMgr.Get(activeID); err == nil {
				activeSub = s
				if s.Origin != "" {
					gwRes.PrimaryOrigin = s.Origin
					healthy, _ := sub.ProbeGatewayHealth(ctx, s.Origin, false, 0)
					gwRes.PrimaryHealthy = healthy
				}
				if len(s.FallbackOrigins) > 0 {
					gwRes.FallbackOrigins = s.FallbackOrigins
					gwRes.FallbackStatuses = make([]bool, len(s.FallbackOrigins))
					for i, fb := range s.FallbackOrigins {
						h, _ := sub.ProbeGatewayHealth(ctx, fb, false, 0)
						gwRes.FallbackStatuses[i] = h
					}
				}
			}
		}
	}

	return DoctorReport{
		Timestamp:    time.Now(),
		ThreeTier:    threeTier,
		DNS:          dnsRes,
		Egress:       egressRes,
		Gateway:      gwRes,
		Subscription: activeSub,
	}
}

func GenerateBugReport(
	ctx context.Context,
	mgr *engine.Manager,
	subMgr *sub.Manager,
	mode engine.TakeoverMode,
	routing engine.RoutingMode,
	mixedPort int,
) BugReport {
	doc := RunDoctor(ctx, mgr, subMgr, mode, routing, mixedPort)

	var activeSubCopy *sub.SubscriptionMeta
	var runtimeRedacted string
	if subMgr != nil && subMgr.ActiveID() != "" {
		if s, err := subMgr.Get(subMgr.ActiveID()); err == nil {
			cp := *s
			cp.Token = Redact(cp.Token)
			activeSubCopy = &cp

			if rtBytes, err := os.ReadFile(paths.SubRuntimePath(s.ID)); err == nil {
				runtimeRedacted = Redact(string(rtBytes))
			} else if srcBytes, err := os.ReadFile(paths.SubSourcePath(s.ID)); err == nil {
				runtimeRedacted = Redact(string(srcBytes))
			}
		}
	}

	var logsRedacted []engine.LogEntry
	if mgr != nil && mgr.RingLog() != nil {
		rawLogs := mgr.RingLog().Snapshot("", 100)
		logsRedacted = make([]engine.LogEntry, len(rawLogs))
		for i, l := range rawLogs {
			logsRedacted[i] = engine.LogEntry{
				Timestamp: l.Timestamp,
				Level:     l.Level,
				Message:   Redact(l.Message),
			}
		}
	}

	return BugReport{
		GeneratedAt:           time.Now(),
		VersionInfo:           version.Get(),
		Doctor:                doc,
		ActiveSubscription:    activeSubCopy,
		RuntimeConfigRedacted: runtimeRedacted,
		RecentLogsRedacted:    logsRedacted,
	}
}
