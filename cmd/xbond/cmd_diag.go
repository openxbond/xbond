package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/openxbond/xbond/internal/daemon"
	"github.com/openxbond/xbond/internal/daemon/service"
	"github.com/openxbond/xbond/internal/diag"
	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/i18n"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/sub"
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
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.Connect(ctx)
		if err != nil {
			// A status query reports the actual state; it never starts the
			// daemon it is asking about.
			return printStatusOffline(statusJSON)
		}

		st, err := client.GetStatus(ctx)
		if err != nil {
			return err
		}

		if statusJSON {
			data, _ := json.MarshalIndent(redactStatus(st), "", "  ")
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

// printStatusOffline reports the daemon's absence truthfully instead of
// starting it. Daemon-down, engine-down, and proxy-state-unknown are three
// different facts; only the first two are knowable from here.
func printStatusOffline(asJSON bool) error {
	installed := service.Installed()
	lockHeld, err := daemon.InstanceLockHeld(paths.DataDir())
	if err != nil {
		return err
	}

	if asJSON {
		data, _ := json.MarshalIndent(map[string]any{
			"daemon": map[string]any{
				"running":   false,
				"installed": installed,
				"lockHeld":  lockHeld,
			},
			"engine": map[string]any{"running": false},
		}, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	fmt.Println("XBond daemon is not running; the core is stopped.")
	if lockHeld {
		fmt.Println("A daemon process holds the instance lock but is not responding.")
	} else if installed {
		fmt.Println("The background service is installed but not running; start it: xbond daemon start")
	} else {
		fmt.Println("The background service is not installed (xbond daemon install), or run the core in a terminal: xbond daemon")
	}
	fmt.Println("System proxy state cannot be verified while the daemon is down; check system settings if a previous session was interrupted.")
	return nil
}

var doctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Run comprehensive diagnostic self-checks",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.Connect(ctx)
		if err != nil {
			// The daemon being down is exactly when diagnosis matters most:
			// check registration, handshake files, the instance lock, and
			// local configuration without it.
			return runOfflineDoctor(doctorJSON)
		}

		rep, err := client.RunDoctor(ctx)
		if err != nil {
			return err
		}

		if doctorJSON {
			data, _ := json.MarshalIndent(redactDoctorReport(rep), "", "  ")
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

type doctorCheck struct {
	Name    string `json:"name"`
	Status  string `json:"status"` // ok, warn, fail
	Details string `json:"details,omitempty"`
}

// runOfflineDoctor diagnoses a machine whose daemon will not come up: the
// checks that need no daemon cover registration, handshake files, the
// instance lock, preferences, and the subscription store.
func runOfflineDoctor(asJSON bool) error {
	checks := []doctorCheck{}
	add := func(name, status, details string) {
		checks = append(checks, doctorCheck{Name: name, Status: status, Details: details})
	}

	installed := service.Installed()
	if installed {
		add("service-registration", "ok", "background service is installed")
	} else {
		add("service-registration", "warn", "background service is not installed (xbond daemon install)")
	}

	lockHeld, lockErr := daemon.InstanceLockHeld(paths.DataDir())
	switch {
	case lockErr != nil:
		add("instance-lock", "fail", lockErr.Error())
	case lockHeld:
		add("instance-lock", "warn", "a daemon process holds the instance lock but does not answer on the LocalAPI; it may be hung — check daemon logs")
	default:
		add("instance-lock", "ok", "free; no daemon process is running")
	}

	handshakePaths := []struct{ name, path string }{
		{"localapi.addr", paths.LocalAPIAddrPath()},
		{"localapi.token", paths.LocalAPITokenPath()},
	}
	for _, f := range handshakePaths {
		if _, err := os.ReadFile(f.path); err != nil {
			add("handshake-files", "ok", f.name+" absent (daemon not running)")
		} else {
			add("handshake-files", "warn", f.name+" present but no daemon answered; stale file from an unclean exit")
		}
	}

	if prefs, err := daemon.LoadPreferences(); err != nil {
		add("preferences", "fail", err.Error())
	} else {
		add("preferences", "ok", fmt.Sprintf("mode=%s routing=%s mixedPort=%d clashPort=%d (secret not shown)",
			prefs.TakeoverMode, prefs.RoutingMode, prefs.MixedPort, prefs.ClashPort))
	}

	if mgr, err := sub.NewManager(); err != nil {
		add("subscription-store", "fail", err.Error())
	} else {
		subs := mgr.List()
		details := fmt.Sprintf("%d subscription(s), active: %s", len(subs), mgr.ActiveID())
		status := "ok"
		for _, s := range subs {
			if s.Health != sub.HealthOK && s.LastErrorMessage != "" {
				status = "warn"
				details += fmt.Sprintf("; %s (%s): %s", s.Name, s.Health, s.LastErrorMessage)
			}
		}
		add("subscription-store", status, details)
		if activeID := mgr.ActiveID(); activeID != "" {
			if _, err := os.Stat(paths.SubSourcePath(activeID)); err != nil {
				add("active-config", "fail", fmt.Sprintf("active subscription has no downloaded config (%s); run `xbond update` once the network path works", activeID))
			} else {
				add("active-config", "ok", "downloaded configuration present")
			}
		}
	}

	failed := 0
	for _, c := range checks {
		if c.Status == "fail" {
			failed++
		}
	}

	if asJSON {
		data, _ := json.MarshalIndent(map[string]any{"offline": true, "checks": checks}, "", "  ")
		fmt.Println(string(data))
	} else {
		fmt.Println("XBond Diagnostics (offline — daemon did not answer)")
		fmt.Println(strings.Repeat("=", 60))
		for _, c := range checks {
			fmt.Printf("[%s] %s: %s\n", strings.ToUpper(c.Status), c.Name, c.Details)
		}
		if failed > 0 {
			fmt.Printf("\n%d check(s) failed. Fix the items above, then run `xbond daemon start`.\n", failed)
		} else {
			fmt.Println("\nLocal checks passed. Start the daemon and run `xbond doctor` again for the full network checks.")
		}
	}
	if failed > 0 {
		return fmt.Errorf("%d offline check(s) failed", failed)
	}
	return nil
}

var bugreportCmd = &cobra.Command{
	Use:   "bugreport",
	Short: "Generate a 100% credential-redacted diagnostic bundle",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.Connect(ctx)
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
		client, err := daemon.Connect(ctx)
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

		if connsJSON {
			data, _ := json.MarshalIndent(filtered, "", "  ")
			fmt.Println(string(data))
			return nil
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
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.Connect(ctx)
		if err != nil {
			return err
		}

		rules, err := client.GetRules(ctx)
		if err != nil {
			return err
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

		if rulesJSON {
			data, _ := json.MarshalIndent(rules, "", "  ")
			fmt.Println(string(data))
			return nil
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
		client, err := daemon.Connect(ctx)
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
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.Connect(ctx)
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
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.Connect(ctx)
		if err != nil {
			return err
		}

		logs, err := client.GetLogs(ctx, logsLevel, 200)
		if err != nil {
			return err
		}

		start := 0
		if logsLines > 0 && len(logs) > logsLines {
			start = len(logs) - logsLines
		}

		lastSeq := uint64(0)
		for _, l := range logs {
			if l.Seq > lastSeq {
				lastSeq = l.Seq
			}
		}
		for _, l := range logs[start:] {
			printLogEntry(l)
		}

		if logsFollow {
			// The ring buffer wraps, so array length is not a cursor: poll a
			// wide window and print only entries past the last seen Seq.
			for {
				time.Sleep(1 * time.Second)
				latest, err := client.GetLogs(ctx, logsLevel, 1000)
				if err != nil {
					return fmt.Errorf("log stream ended: %w", err)
				}
				for _, l := range latest {
					if l.Seq > lastSeq {
						printLogEntry(l)
						lastSeq = l.Seq
					}
				}
			}
		}
		return nil
	},
}

func printLogEntry(l engine.LogEntry) {
	fmt.Printf("[%s] [%s] %s\n", l.Timestamp.Format("15:04:05"), strings.ToUpper(string(l.Level)), l.Message)
}
