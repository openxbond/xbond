package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/openxbond/xbond/daemon"
	"github.com/openxbond/xbond/diag"
	"github.com/openxbond/xbond/engine"
	"github.com/openxbond/xbond/i18n"
	"github.com/spf13/cobra"
)

var (
	statusJSON  bool
	doctorJSON  bool
	bugrepPath  string
	connsFilter string
	connsJSON   bool
	rulesSearch string
	rulesJSON   bool
	logsLevel   string
	logsFollow  bool
	logsLines   int
)

func init() {
	// status
	statusCmd.Flags().BoolVar(&statusJSON, "json", false, "Output as JSON")
	rootCmd.AddCommand(statusCmd)

	// doctor
	doctorCmd.Flags().BoolVar(&doctorJSON, "json", false, "Output as JSON")
	rootCmd.AddCommand(doctorCmd)

	// bugreport
	bugreportCmd.Flags().StringVarP(&bugrepPath, "output", "o", "", "Write report to file path")
	rootCmd.AddCommand(bugreportCmd)

	// conns
	connsCmd.Flags().StringVar(&connsFilter, "filter", "", "Filter connections by keyword (host, ip, rule)")
	connsCmd.Flags().BoolVar(&connsJSON, "json", false, "Output as JSON")
	rootCmd.AddCommand(connsCmd)

	// rules
	rulesCmd.Flags().StringVar(&rulesSearch, "search", "", "Search rules by keyword")
	rulesCmd.Flags().BoolVar(&rulesJSON, "json", false, "Output as JSON")
	rootCmd.AddCommand(rulesCmd)

	// dns
	rootCmd.AddCommand(dnsCmd)
	dnsCmd.AddCommand(dnsQueryCmd)
	dnsCmd.AddCommand(dnsFlushCmd)

	// logs
	logsCmd.Flags().StringVar(&logsLevel, "level", "info", "Minimum log level: debug, info, warn, error")
	logsCmd.Flags().BoolVarP(&logsFollow, "follow", "f", false, "Follow log stream in real time")
	logsCmd.Flags().IntVarP(&logsLines, "lines", "n", 50, "Number of recent lines to display")
	rootCmd.AddCommand(logsCmd)
}

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show three-tier connection status, active subscription, and traffic stats",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		st, err := client.GetStatus(ctx)
		if err != nil {
			return err
		}

		if statusJSON {
			data, _ := json.MarshalIndent(st, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		lang := i18n.Resolve(globalLang, "")
		t := func(id string, data ...i18n.P) string { return i18n.T(lang, id, data...) }
		field := func(id string) string { return i18n.Pad(t(id), i18n.StatusWidth) }

		fmt.Println(t("status.title"))
		fmt.Println(strings.Repeat("=", 60))

		// 1. Three-tier status
		tier1 := t("status.core_offline")
		if st.ThreeTier.CoreReachable {
			tier1 = t("status.core_ready")
		}
		tier2 := t("status.takeover_disabled", i18n.P{"mode": st.ThreeTier.TakeoverMode})
		if st.ThreeTier.TrafficIntercepted {
			tier2 = t("status.takeover_active", i18n.P{"mode": st.ThreeTier.TakeoverMode})
		} else if st.ThreeTier.InterceptNote != "" {
			tier2 = t("status.takeover_disabled", i18n.P{"mode": st.ThreeTier.InterceptNote})
		}
		tier3 := t("status.egress_unverified")
		if st.ThreeTier.EgressVerified {
			tier3 = t("status.egress_verified", i18n.P{"ms": st.ThreeTier.EgressLatencyMs})
		}

		fmt.Printf("%s %s\n", t("status.core_reachability"), tier1)
		fmt.Printf("%s %s\n", t("status.traffic_takeover"), tier2)
		fmt.Printf("%s %s\n", t("status.network_egress"), tier3)
		fmt.Println(strings.Repeat("-", 60))

		// 2. Preferences & Strategy
		allowLanStr := t("status.off")
		if st.Preferences.AllowLan {
			allowLanStr = t("status.on")
		}
		fmt.Printf("%s%s\n", field("status.label.takeover_mode"), st.Preferences.TakeoverMode)
		fmt.Printf("%s%s\n", field("status.label.routing_mode"), st.Preferences.RoutingMode)
		allowLanName := strings.TrimSuffix(t("status.label.allow_lan"), ":")
		fmt.Printf("%s%d (%s: %s)\n", field("status.label.mixed_port"), st.Preferences.MixedPort, allowLanName, allowLanStr)
		if len(st.ThreeTier.StrategyChain) > 0 {
			fmt.Printf("%s%s\n", field("status.label.egress_chain"), strings.Join(st.ThreeTier.StrategyChain, " -> "))
		}
		fmt.Println(strings.Repeat("-", 60))

		// 3. Active Subscription
		if st.ActiveSub != nil {
			fmt.Printf("%s%s (%s)\n", field("status.label.active_sub"), st.ActiveSub.Name, st.ActiveSub.Type)
			healthStr := string(st.ActiveSub.Health)
			if healthStr == "ok" {
				healthStr = t("status.health_ok")
			}
			fmt.Printf("%s%s\n", field("status.label.health"), healthStr)
			if st.ActiveSub.Quota.TotalBytes > 0 {
				usedGB := float64(st.ActiveSub.Quota.DownloadBytes+st.ActiveSub.Quota.UploadBytes) / (1024 * 1024 * 1024)
				totalGB := float64(st.ActiveSub.Quota.TotalBytes) / (1024 * 1024 * 1024)
				pct := (usedGB / totalGB) * 100
				fmt.Printf("%s%.2f GB / %.2f GB (%.1f%%)\n", field("status.label.quota_usage"), usedGB, totalGB, pct)
				if st.ActiveSub.Quota.ExpireUnix > 0 {
					fmt.Printf("%s%s\n", field("status.label.service_expire"), time.Unix(st.ActiveSub.Quota.ExpireUnix, 0).Local().Format("2006-01-02 15:04"))
				}
			}
		} else {
			fmt.Printf("%s%s\n", field("status.label.active_sub"), t("status.no_active_sub"))
		}
		return nil
	},
}

var doctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Run comprehensive diagnostic self-checks",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		rep, err := client.RunDoctor(ctx)
		if err != nil {
			return err
		}

		if doctorJSON {
			data, _ := json.MarshalIndent(rep, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("XBond Diagnostics Self-Check Report")
		fmt.Println(strings.Repeat("=", 60))

		// 1. Core & Takeover
		fmt.Printf("[Core]       Running: %v\n", rep.ThreeTier.CoreReachable)
		fmt.Printf("[Takeover]   Mode: %s, Intercepted: %v\n", rep.ThreeTier.TakeoverMode, rep.ThreeTier.TrafficIntercepted)
		if rep.ThreeTier.InterceptNote != "" {
			fmt.Printf("             Note: %s\n", rep.ThreeTier.InterceptNote)
		}

		// 2. DNS
		fmt.Printf("[DNS]        Local: %v (%s)\n", rep.DNS.LocalDNSSuccess, rep.DNS.LocalIPs)
		fmt.Printf("             Proxy: %v (%s)\n", rep.DNS.ProxyDNSSuccess, rep.DNS.ProxyIPs)

		// 3. Egress
		fmt.Printf("[Egress]     Direct: %v (%d ms)\n", rep.Egress.DirectSuccess, rep.Egress.DirectLatencyMs)
		fmt.Printf("             Proxy:  %v (%d ms)\n", rep.Egress.ProxySuccess, rep.Egress.ProxyLatencyMs)

		// 4. Gateway
		if rep.Gateway.PrimaryOrigin != "" {
			fmt.Printf("[Gateway]    Primary: %s (healthy: %v)\n", rep.Gateway.PrimaryOrigin, rep.Gateway.PrimaryHealthy)
			for i, fb := range rep.Gateway.FallbackOrigins {
				h := false
				if i < len(rep.Gateway.FallbackStatuses) {
					h = rep.Gateway.FallbackStatuses[i]
				}
				fmt.Printf("             Fallback: %s (healthy: %v)\n", fb, h)
			}
		}

		if rep.ThreeTier.CoreReachable && rep.ThreeTier.EgressVerified {
			fmt.Println("\nAll core proxy checks passed! System is connected and functional.")
		} else {
			fmt.Println("\nDiagnostics identified issues. Check individual items above or run 'xbond bugreport'.")
		}
		return nil
	},
}

var bugreportCmd = &cobra.Command{
	Use:   "bugreport",
	Short: "Generate a 100% credential-redacted diagnostic bundle",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		rep, err := client.GetBugReport(ctx)
		if err != nil {
			return err
		}

		data, err := json.MarshalIndent(rep, "", "  ")
		if err != nil {
			return err
		}

		redactedJSON := diag.Redact(string(data))

		if bugrepPath != "" {
			if err := os.WriteFile(bugrepPath, []byte(redactedJSON), 0o600); err != nil {
				return fmt.Errorf("failed to write bugreport to file: %w", err)
			}
			fmt.Printf("Redacted bugreport written to: %s\n", bugrepPath)
		} else {
			fmt.Println(redactedJSON)
		}
		return nil
	},
}

var connsCmd = &cobra.Command{
	Use:   "conns [close <id|all>]",
	Short: "Inspect and manage active proxy connections",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		if len(args) > 0 && args[0] == "close" {
			targetID := "all"
			if len(args) > 1 {
				targetID = args[1]
			}
			if err := client.CloseConnections(ctx, targetID); err != nil {
				return err
			}
			fmt.Printf("Closed connection(s): %s\n", targetID)
			return nil
		}

		conns, err := client.GetConnections(ctx)
		if err != nil {
			return err
		}

		if connsJSON {
			data, _ := json.MarshalIndent(conns, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		filtered := conns.Connections
		if connsFilter != "" {
			kw := strings.ToLower(connsFilter)
			filtered = make([]engine.ConnectionItem, 0)
			for _, c := range conns.Connections {
				if strings.Contains(strings.ToLower(c.Metadata.Host), kw) ||
					strings.Contains(strings.ToLower(c.Metadata.Destination), kw) ||
					strings.Contains(strings.ToLower(c.Rule), kw) ||
					strings.Contains(strings.ToLower(strings.Join(c.Chains, " ")), kw) {
					filtered = append(filtered, c)
				}
			}
		}

		fmt.Printf("Active Connections: %d (Total Upload: %.2f MB, Download: %.2f MB)\n",
			len(filtered), float64(conns.UploadTotal)/(1024*1024), float64(conns.DownloadTotal)/(1024*1024))
		fmt.Printf("%-24s %-12s %-25s %-10s\n", "DESTINATION", "RULE", "CHAIN", "TRANSFER")
		fmt.Println(strings.Repeat("-", 75))

		for _, c := range filtered {
			dest := c.Metadata.Host
			if dest == "" {
				dest = c.Metadata.Destination
			}
			transfer := fmt.Sprintf("↑%.1fK ↓%.1fK", float64(c.Upload)/1024, float64(c.Download)/1024)
			fmt.Printf("%-24s %-12s %-25s %-10s\n",
				truncate(dest, 24), truncate(c.Rule, 12), truncate(strings.Join(c.Chains, "/"), 25), transfer)
		}
		return nil
	},
}

var rulesCmd = &cobra.Command{
	Use:   "rules",
	Short: "List active routing rules and dispatch targets",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		rules, err := client.GetRules(ctx)
		if err != nil {
			return err
		}

		if rulesJSON {
			data, _ := json.MarshalIndent(rules, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if rulesSearch != "" {
			kw := strings.ToLower(rulesSearch)
			filtered := make([]engine.RuleItem, 0)
			for _, r := range rules {
				if strings.Contains(strings.ToLower(r.Payload), kw) || strings.Contains(strings.ToLower(r.Proxy), kw) {
					filtered = append(filtered, r)
				}
			}
			rules = filtered
		}

		fmt.Printf("%-15s %-35s %-20s\n", "TYPE", "PAYLOAD", "OUTBOUND TARGET")
		fmt.Println(strings.Repeat("-", 75))
		for _, r := range rules {
			fmt.Printf("%-15s %-35s %-20s\n", r.Type, truncate(r.Payload, 35), r.Proxy)
		}
		return nil
	},
}

var dnsCmd = &cobra.Command{
	Use:   "dns",
	Short: "Query DNS resolution or flush FakeIP cache",
}

var dnsQueryCmd = &cobra.Command{
	Use:   "query <domain> [type]",
	Short: "Test DNS resolution through the engine",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		recordType := "A"
		if len(args) > 1 {
			recordType = args[1]
		}

		res, err := client.QueryDNS(ctx, args[0], recordType)
		if err != nil {
			return err
		}

		fmt.Printf("DNS Query: %s (%s)\n", args[0], recordType)
		for _, ans := range res.Answer {
			fmt.Printf("  - %s (TTL: %d)\n", ans.Data, ans.TTL)
		}
		return nil
	},
}

var dnsFlushCmd = &cobra.Command{
	Use:   "flush",
	Short: "Flush internal DNS and FakeIP cache",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}
		if err := client.FlushDNS(ctx); err != nil {
			return err
		}
		fmt.Println("FakeIP and DNS cache flushed successfully.")
		return nil
	},
}

var logsCmd = &cobra.Command{
	Use:   "logs",
	Short: "View or follow recent engine and daemon logs",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		logs, err := client.GetLogs(ctx, logsLevel)
		if err != nil {
			return err
		}

		start := 0
		if logsLines > 0 && len(logs) > logsLines {
			start = len(logs) - logsLines
		}

		for _, l := range logs[start:] {
			fmt.Printf("[%s] [%s] %s\n", l.Timestamp.Format("15:04:05"), strings.ToUpper(string(l.Level)), l.Message)
		}

		if logsFollow {
			lastCount := len(logs)
			for {
				time.Sleep(1 * time.Second)
				latest, err := client.GetLogs(ctx, logsLevel)
				if err == nil && len(latest) > lastCount {
					for _, l := range latest[lastCount:] {
						fmt.Printf("[%s] [%s] %s\n", l.Timestamp.Format("15:04:05"), strings.ToUpper(string(l.Level)), l.Message)
					}
					lastCount = len(latest)
				}
			}
		}
		return nil
	},
}
