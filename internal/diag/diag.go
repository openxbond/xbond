package diag

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/platform/sysproxy"
	"github.com/openxbond/xbond/internal/sub"
	"github.com/openxbond/xbond/internal/version"
)

func EvaluateThreeTier(
	ctx context.Context,
	client *engine.ClashClient,
	coreStatus engine.EngineStatus,
	mode engine.TakeoverMode,
	routing engine.RoutingMode,
	mixedPort int,
	proxySnap sysproxy.Snapshot,
	proxyErr error,
) ThreeTierStatus {
	st := ThreeTierStatus{
		TakeoverMode:       mode,
		RoutingMode:        routing,
		TrafficIntercepted: false,
		InterceptNote:      "port mode only, whole-system not intercepted",
	}

	// The core this daemon serves may run in the machine session (delegated
	// TUN): the caller decides which core is "the user's" via
	// coreClient()/coreStatus(). Gate on that status, not on the local
	// manager.
	if client == nil || !coreStatus.Running {
		return st
	}

	// 1. Tier 1: Core Reachable
	if ver, err := client.GetVersion(ctx); err == nil && ver != "" {
		st.CoreReachable = true
	}

	// 2. Tier 2: Traffic Intercepted (System Proxy and/or TUN). The caller
	// supplies the host proxy read so a status poll costs one snapshot, not
	// one per consumer; a read error keeps SystemProxyActive false.
	if proxyErr == nil && proxySnap.Enabled && (mixedPort <= 0 || proxySnap.TargetsPort(mixedPort)) {
		st.SystemProxyActive = true
	}
	if (mode == engine.ModeTun || coreStatus.TakeoverMode == engine.ModeTun) && st.CoreReachable {
		st.TunActive = true
	}
	st.TrafficIntercepted = st.SystemProxyActive || st.TunActive
	if st.SystemProxyActive && st.TunActive {
		st.InterceptNote = "dual takeover (system proxy + tun active)"
	} else if st.SystemProxyActive {
		st.InterceptNote = "system proxy active"
	} else if st.TunActive {
		st.InterceptNote = "tun interface active"
	} else {
		st.TrafficIntercepted = false
		st.InterceptNote = "port mode only, whole-system not intercepted"
	}

	// Tier 3 (egress verified through the mixed port) is deliberately not
	// evaluated here: it dials through the proxy to a remote URL with a
	// multi-second timeout, and EvaluateThreeTier sits in the per-poll status
	// path. No status consumer reads EgressVerified — 真实出口连通 is
	// doctor's job (RunDoctor probes fresh on demand) — so the poll stays
	// local-only and fast even with a slow upstream node.

	// 4. Focus strategy chain
	if client != nil {
		if proxies, err := client.GetProxies(ctx); err == nil {
			st.FocusStrategy, st.StrategyChain = ResolveStrategyChain(proxies)
		}
	}

	return st
}

// ProbeEgress verifies real outbound connectivity through the local mixed
// port by fetching a generate_204 endpoint. It dials through the proxy with
// a multi-second timeout, so callers run it on demand (doctor), never in a
// polling path.
func ProbeEgress(ctx context.Context, mixedPort int) (verified bool, latencyMs int) {
	if mixedPort <= 0 {
		return false, 0
	}
	proxyURL, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", mixedPort))
	testClient := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
		},
		Timeout: 4 * time.Second,
	}

	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.gstatic.com/generate_204", nil)
	if err != nil {
		return false, 0
	}
	resp, err := testClient.Do(req)
	if err != nil {
		return false, 0
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusOK {
		return true, int(time.Since(start).Milliseconds())
	}
	return false, 0
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
	client *engine.ClashClient,
	coreStatus engine.EngineStatus,
	subMgr *sub.Manager,
	mode engine.TakeoverMode,
	routing engine.RoutingMode,
	mixedPort int,
) DoctorReport {
	proxySnap, proxyErr := sysproxy.Get()
	threeTier := EvaluateThreeTier(ctx, client, coreStatus, mode, routing, mixedPort, proxySnap, proxyErr)

	// 1. DNS check
	dnsRes := DNSCheckResult{}
	if ips, err := net.LookupIP("google.com"); err == nil && len(ips) > 0 {
		dnsRes.LocalDNSSuccess = true
		dnsRes.LocalIPs = ips[0].String()
	}

	if client != nil {
		if queryResp, err := client.QueryDNS(ctx, "google.com", "A"); err == nil && len(queryResp.Answer) > 0 {
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

	// Doctor owns the through-proxy egress probe: it is on-demand and must
	// reflect the moment's connectivity, not a cached poll-time answer.
	egressRes.ProxySuccess, egressRes.ProxyLatencyMs = ProbeEgress(ctx, mixedPort)

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
					healthy, _ := sub.ProbeGatewayHealth(ctx, s.Origin, "")
					gwRes.PrimaryHealthy = healthy
				}
				if len(s.FallbackOrigins) > 0 {
					gwRes.FallbackOrigins = s.FallbackOrigins
					gwRes.FallbackStatuses = make([]bool, len(s.FallbackOrigins))
					for i, fb := range s.FallbackOrigins {
						h, _ := sub.ProbeGatewayHealth(ctx, fb, "")
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
	client *engine.ClashClient,
	coreStatus engine.EngineStatus,
	subMgr *sub.Manager,
	mode engine.TakeoverMode,
	routing engine.RoutingMode,
	mixedPort int,
) BugReport {
	doc := RunDoctor(ctx, client, coreStatus, subMgr, mode, routing, mixedPort)

	// The report is designed to leave the machine: the doctor's embedded
	// subscription meta carries the raw credential, and older stores may
	// still hold unredacted fetch errors from before the source-level
	// redaction. Redact every carried-over surface (Get returns a copy, so
	// this cannot corrupt the live store).
	redactSubMeta := func(meta *sub.SubscriptionMeta) {
		if meta == nil {
			return
		}
		meta.Token = Redact(meta.Token)
		meta.SourceURL = Redact(meta.SourceURL)
		meta.UpdateProxy = Redact(meta.UpdateProxy)
		meta.LastErrorMessage = Redact(meta.LastErrorMessage)
	}
	redactSubMeta(doc.Subscription)
	var activeSubCopy *sub.SubscriptionMeta
	var runtimeRedacted string
	if subMgr != nil && subMgr.ActiveID() != "" {
		if s, err := subMgr.Get(subMgr.ActiveID()); err == nil {
			cp := *s
			redactSubMeta(&cp)
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
