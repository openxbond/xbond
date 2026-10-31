package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/openxbond/xbond/internal/account"
	"github.com/openxbond/xbond/internal/daemon"
	"github.com/openxbond/xbond/internal/diag"
	"github.com/openxbond/xbond/internal/i18n"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/sub"
	"github.com/spf13/cobra"
)

var (
	loginOrigin    string
	loginName      string
	loginNoBrowser bool
	loginDevice    bool

	subAddOrigin   string
	subAddProtocol string
	subAddLang     string
	subAddName     string
	subAddInterval int
	subAddUse      bool

	subUpdForce    bool
	subUpdViaProxy bool
	subUpdAll      bool
	subUpdJSON     bool

	subListJSON bool
	subInfoJSON bool

	subExpRuntime  bool
	subExpRedacted bool
)

func init() {
	// login
	loginCmd.Flags().StringVar(&loginOrigin, "origin", "", "XBond gateway origin (default https://www.xbond.net)")
	loginCmd.Flags().StringVar(&loginName, "name", "", "Subscription profile label")
	loginCmd.Flags().BoolVar(&loginNoBrowser, "no-browser", false, "Do not open browser automatically, print URL only")
	loginCmd.Flags().BoolVar(&loginDevice, "device", false, "Use OAuth 2.0 Device Authorization flow (for Docker, SSH, or headless environments)")
	rootCmd.AddCommand(loginCmd)

	// logout
	rootCmd.AddCommand(logoutCmd)

	// top-level update
	updateCmd.Flags().BoolVarP(&subUpdForce, "force", "f", false, "Force refresh without using ETag conditional request")
	updateCmd.Flags().BoolVar(&subUpdViaProxy, "via-proxy", false, "Fetch subscription via local proxy port")
	updateCmd.Flags().BoolVarP(&subUpdAll, "all", "a", false, "Update all configured subscriptions")
	updateCmd.Flags().BoolVar(&subUpdJSON, "json", false, "Output results as JSON")
	rootCmd.AddCommand(updateCmd)

	// sub root
	rootCmd.AddCommand(subCmd)

	// sub list
	subListCmd.Flags().BoolVar(&subListJSON, "json", false, "Output as JSON")
	subCmd.AddCommand(subListCmd)

	// sub add
	subAddCmd.Flags().StringVar(&subAddOrigin, "origin", "", "Gateway origin (for XBond tokens)")
	subAddCmd.Flags().StringVar(&subAddProtocol, "protocol", "vless-reality", "Transport protocol: vless-reality, trojan-ws")
	subAddCmd.Flags().StringVar(&subAddLang, "lang", "zh-HK", "Display language: zh-HK, zh, en, ko, fa")
	subAddCmd.Flags().StringVar(&subAddName, "name", "", "Custom subscription name")
	subAddCmd.Flags().IntVar(&subAddInterval, "interval", 24, "Auto-update interval in hours (1-168)")
	subAddCmd.Flags().BoolVar(&subAddUse, "use", true, "Activate as active subscription immediately")
	subCmd.AddCommand(subAddCmd)

	// sub use
	subCmd.AddCommand(subUseCmd)

	// sub update
	subUpdateCmd.Flags().BoolVarP(&subUpdForce, "force", "f", false, "Force refresh without using ETag")
	subUpdateCmd.Flags().BoolVar(&subUpdViaProxy, "via-proxy", false, "Fetch subscription via local proxy port")
	subUpdateCmd.Flags().BoolVarP(&subUpdAll, "all", "a", false, "Update all subscriptions")
	subUpdateCmd.Flags().BoolVar(&subUpdJSON, "json", false, "Output as JSON")
	subCmd.AddCommand(subUpdateCmd)

	// sub info
	subInfoCmd.Flags().BoolVar(&subInfoJSON, "json", false, "Output as JSON")
	subCmd.AddCommand(subInfoCmd)

	// sub export
	subExportCmd.Flags().BoolVar(&subExpRuntime, "runtime", false, "Export derived runtime config instead of source config")
	subExportCmd.Flags().BoolVar(&subExpRedacted, "redacted", true, "Redact sensitive tokens and passwords in output")
	subCmd.AddCommand(subExportCmd)

	// sub remove
	subCmd.AddCommand(subRemoveCmd)
}

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Sign in to your XBond account and activate its subscription",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		effectiveLang := i18n.Resolve(globalLang, "")

		var resp *daemon.LoginResponse
		resp, err = runAccountLogin(ctx, client, loginOrigin, effectiveLang, loginName, loginNoBrowser, loginDevice || isDockerEnvironment())
		if err != nil {
			return err
		}
		if resp.Meta == nil {
			return errors.New("login succeeded but the daemon returned no subscription")
		}

		t := func(id string, data ...i18n.P) string { return i18n.T(effectiveLang, id, data...) }
		meta := resp.Meta
		// Three distinct outcomes: ready to connect, saved-but-fetch-failed,
		// or a hard failure (returned above as err).
		if resp.UpdateError != "" {
			fmt.Printf("%s %s\n", t("tag.success"), t("login.update_failed", i18n.P{"err": resp.UpdateError}))
			return nil
		}
		fmt.Printf("%s %s\n", t("tag.success"), t("pkce.subscription_active", i18n.P{"name": meta.Name, "id": meta.ID}))
		if meta.Quota.TotalBytes > 0 {
			usedGB := float64(meta.Quota.DownloadBytes+meta.Quota.UploadBytes) / (1024 * 1024 * 1024)
			totalGB := float64(meta.Quota.TotalBytes) / (1024 * 1024 * 1024)
			pct := (usedGB / totalGB) * 100
			fmt.Printf("%s %s\n", t("tag.quota"), t("pkce.quota_usage", i18n.P{
				"used": fmt.Sprintf("%.2f", usedGB), "total": fmt.Sprintf("%.2f", totalGB), "pct": fmt.Sprintf("%.1f", pct),
			}))
		}
		fmt.Printf("%s %s\n", t("tag.info"), t("login.next_step"))
		return nil
	},
}

func isDockerEnvironment() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	if _, err := os.Stat("/run/.containerenv"); err == nil {
		return true
	}
	if os.Getenv("DOCKER") != "" || os.Getenv("CONTAINER") != "" || os.Getenv("KUBERNETES_SERVICE_HOST") != "" {
		return true
	}
	return false
}

// runAccountLogin performs OAuth through the daemon's shared account module,
// then binds the discovered subscription through LocalAPI. Progress and
// prompts stay on stderr; the final result stays on stdout.
func runAccountLogin(
	ctx context.Context,
	client *daemon.Client,
	origin string,
	lang, name string,
	noBrowser, device bool,
) (*daemon.LoginResponse, error) {
	t := func(id string, data ...i18n.P) string { return i18n.T(lang, id, data...) }
	manager := account.NewManager(paths.AccountSessionPath())

	var method string
	var expiresIn int
	credentials, err := manager.Login(
		ctx,
		account.LoginOptions{
			Origin:       origin,
			Device:       device,
			NoBrowser:    noBrowser || isDockerEnvironment(),
			CallbackHTML: i18n.RenderCallbackHTML,
			OpenBrowser: func(target string) error {
				if err := openBrowser(target); err != nil {
					fmt.Fprintln(os.Stderr, t("pkce.browser_open_failed", i18n.P{"err": err}))
					return err
				}
				return nil
			},
		},
		func(progress account.Progress) {
			method = progress.Method
			expiresIn = progress.ExpiresIn
			switch progress.Method {
			case "device":
				fmt.Fprintln(os.Stderr, strings.Repeat("=", 66))
				fmt.Fprintln(os.Stderr, t("device.banner"))
				fmt.Fprintln(os.Stderr, strings.Repeat("=", 66))
				if !noBrowser && !isDockerEnvironment() {
					fmt.Fprintln(os.Stderr, t("device.opening_browser"))
				}
				fmt.Fprintln(os.Stderr, t("device.visit_url"))
				fmt.Fprintf(os.Stderr, "  %s\n\n", progress.VerificationURI)
				fmt.Fprintln(os.Stderr, t("device.code_prompt"))
				fmt.Fprintf(os.Stderr, "  >>>  %s  <<<\n\n", progress.UserCode)
				if progress.VerificationURIComplete != "" {
					fmt.Fprintln(os.Stderr, t("device.quick_link"))
					fmt.Fprintf(os.Stderr, "  %s\n\n", progress.VerificationURIComplete)
				}
				fmt.Fprintln(os.Stderr, t("device.waiting"))
			case "pkce":
				fmt.Fprintln(os.Stderr, strings.Repeat("=", 66))
				fmt.Fprintln(os.Stderr, t("pkce.banner"))
				fmt.Fprintln(os.Stderr, strings.Repeat("=", 66))
				if !noBrowser {
					fmt.Fprintln(os.Stderr, t("pkce.opening_browser"))
				}
				fmt.Fprintln(os.Stderr, t("pkce.visit_url"))
				fmt.Fprintf(os.Stderr, "  %s\n\n", progress.AuthURL)
				fmt.Fprintln(os.Stderr, t("pkce.waiting"))
			}
		},
	)
	if err != nil {
		return nil, localizeLoginError(t, err, method, expiresIn)
	}

	switch method {
	case "device":
		fmt.Fprintf(os.Stderr, "\n%s %s\n", t("tag.success"), t("device.approved"))
	case "pkce":
		fmt.Fprintf(os.Stderr, "\n%s %s\n", t("tag.success"), t("pkce.success"))
	}

	if credentials.LinkError != nil {
		return nil, fmt.Errorf("failed to resolve subscription link: %w", credentials.LinkError)
	}
	if credentials.SubscriptionToken == "" {
		return nil, errors.New(t("login.link_unprovisioned"))
	}

	fmt.Fprintln(os.Stderr, t("login.downloading_config"))
	var response *daemon.LoginResponse
	if err := withFetchProgress(ctx, client, func() error {
		var loginErr error
		response, loginErr = client.Login(
			ctx,
			credentials.SubscriptionToken,
			credentials.Origin,
			credentials.FallbackOrigins,
			"",
			lang,
			name,
			"",
		)
		return loginErr
	}); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, fmt.Errorf("%w; the subscription was saved locally; run `xbond update` to retry the first config fetch", err)
		}
		return nil, err
	}
	return response, nil
}

func localizeLoginError(t func(string, ...i18n.P) string, err error, method string, expiresIn int) error {
	var accountErr *account.Error
	if errors.As(err, &accountErr) {
		switch accountErr.Code {
		case account.ErrCodeAccessDenied:
			return errors.New(t("device.denied"))
		case account.ErrCodeExpired:
			return errors.New(t("device.expired"))
		case account.ErrCodeTimeout:
			seconds := 300
			if method == "device" && expiresIn > 0 {
				seconds = expiresIn
			}
			return errors.New(t("device.timed_out", i18n.P{"seconds": seconds}))
		}
	}
	return err
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Remove local XBond login credentials (universal subscriptions are kept)",
	Args:  cobra.NoArgs,
	Long: `Remove the local XBond login credentials: every xbond-type subscription is deleted, and the core disconnects only if the active one was among them.

Third-party (universal) subscriptions are untouched — remove those with ` + "`xbond sub remove`" + `, and disconnect without removing credentials with ` + "`xbond down`" + `. The remote account authorization is NOT revoked; manage that in the XBond dashboard.

Requires a running daemon (xbond daemon start) because it owns the credential store.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.NewClient()
		if err != nil {
			return fmt.Errorf("xbond daemon is not running; start it first (xbond daemon start) so the credential store can be updated")
		}
		removed, err := client.Logout(ctx)
		if err != nil {
			return err
		}
		if len(removed) == 0 {
			fmt.Println("No XBond login credentials found locally; nothing was removed.")
			fmt.Println("To disconnect the core, run `xbond down`. To remove a third-party subscription, use `xbond sub remove`.")
			return nil
		}
		for _, m := range removed {
			fmt.Printf("Removed XBond subscription: %s (%s)\n", m.Name, m.ID)
		}
		fmt.Println("Local login credentials removed; the remote account authorization was not revoked.")
		fmt.Println("Universal subscriptions were kept; remove them with `xbond sub remove`.")
		return nil
	},
}

var updateCmd = &cobra.Command{
	Use:   "update [name-or-id]",
	Short: "Refresh active or specified subscription",
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runUpdate(cmd, args)
	},
}

var subCmd = &cobra.Command{
	Use:   "sub",
	Short: "Manage dual-track subscriptions (XBond and universal)",
}

var subListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all configured subscriptions",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.Connect(ctx)
		if err != nil {
			return err
		}

		listRes, err := client.ListSubs(ctx)
		if err != nil {
			return err
		}

		if subListJSON {
			for i := range listRes.Subscriptions {
				listRes.Subscriptions[i] = redactSubscriptionMeta(listRes.Subscriptions[i])
			}
			data, _ := json.MarshalIndent(listRes, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(listRes.Subscriptions) == 0 {
			fmt.Println("No subscriptions configured. Use 'xbond login' or 'xbond sub add' to get started.")
			return nil
		}

		fmt.Printf("%-3s %-18s %-16s %-10s %-14s %-19s %-17s\n", "ACT", "NAME", "ID", "TYPE", "STATUS", "QUOTA (USED/TOTAL)", "LAST UPDATED")
		fmt.Println(strings.Repeat("-", 100))

		for _, s := range listRes.Subscriptions {
			act := " "
			if s.ID == listRes.ActiveID {
				act = "*"
			}

			quotaStr := "N/A"
			if s.Quota.TotalBytes > 0 {
				usedGB := float64(s.Quota.DownloadBytes+s.Quota.UploadBytes) / (1024 * 1024 * 1024)
				totalGB := float64(s.Quota.TotalBytes) / (1024 * 1024 * 1024)
				quotaStr = fmt.Sprintf("%.1fG / %.1fG", usedGB, totalGB)
			}

			lastUp := "Never"
			if !s.LastUpdatedAt.IsZero() {
				lastUp = s.LastUpdatedAt.Local().Format("2006-01-02 15:04")
			}

			fmt.Printf("%-3s %-18s %-16s %-10s %-14s %-19s %-17s\n",
				act, truncate(s.Name, 18), s.ID, s.Type, s.Health, quotaStr, lastUp)
		}
		return nil
	},
}

var subAddCmd = &cobra.Command{
	Use:   "add <token|url|file>",
	Short: "Add a new subscription",
	Args:  cobra.ExactArgs(1),
	Long: `Add a new subscription from an XBond token (sub-…), a universal subscription URL, or a local configuration file.

A universal URL or local file needs no XBond account. A local file is re-read on every update — edit it and run ` + "`xbond update`" + ` to pick up changes; the path is resolved by the CLI before the daemon sees it.

Requires the background daemon (first time? ` + "`xbond daemon install`" + `). With --use (the default) a running core switches to the new subscription immediately.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		input := args[0]
		var subType sub.SubscriptionType
		var token, urlOrFile string

		switch {
		case strings.HasPrefix(input, "sub-"):
			subType = sub.SubTypeXBond
			token = input
		case strings.HasPrefix(input, "http://"), strings.HasPrefix(input, "https://"):
			subType = sub.SubTypeUniversal
			urlOrFile = input
		default:
			// A local file path is read by the daemon on every update, so it
			// must survive out of the CLI's working directory: absolutize it
			// here, not inside the daemon's cwd.
			subType = sub.SubTypeUniversal
			abs, err := filepath.Abs(input)
			if err != nil {
				return fmt.Errorf("resolve local path %q: %w", input, err)
			}
			urlOrFile = abs
		}

		var res *daemon.AddSubResponse
		err = withFetchProgress(ctx, client, func() error {
			var addErr error
			res, addErr = client.AddSub(ctx, subType, token, subAddOrigin, nil, subAddProtocol, subAddLang, subAddName, urlOrFile, subAddInterval, subAddUse)
			return addErr
		})
		if err != nil {
			return err
		}
		meta := res.Meta

		fmt.Printf("Added subscription %s (%s)\n", meta.Name, meta.ID)
		if res.Activated {
			fmt.Println("Set as the active subscription.")
			if res.Reloaded {
				fmt.Println("Running core switched to it.")
			} else {
				fmt.Println("Core is not running; it will use this subscription on the next `xbond up`.")
			}
		} else {
			fmt.Println("Not activated; switch with `xbond sub use`.")
		}
		if res.UpdateError != "" {
			fmt.Printf("Warning: initial configuration fetch failed: %s\n", res.UpdateError)
			fmt.Printf("Run `xbond update %s` to retry.\n", meta.Name)
		}
		return nil
	},
}

var subUseCmd = &cobra.Command{
	Use:   "use <name-or-id>",
	Short: "Switch the active subscription",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		if err := client.UseSub(ctx, args[0]); err != nil {
			return err
		}
		fmt.Printf("Switched active subscription to: %s\n", args[0])
		return nil
	},
}

var subUpdateCmd = &cobra.Command{
	Use:   "update [name-or-id]",
	Short: "Update subscription(s)",
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runUpdate(cmd, args)
	},
}

var subInfoCmd = &cobra.Command{
	Use:   "info [name-or-id]",
	Short: "Inspect subscription details and metadata",
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.Connect(ctx)
		if err != nil {
			return err
		}

		subsList, err := client.ListSubs(ctx)
		if err != nil {
			return err
		}

		target := ""
		if len(args) > 0 {
			target = args[0]
		}
		targetID, err := resolveSubscriptionTarget(subsList, target)
		if err != nil {
			return err
		}

		var found *sub.SubscriptionMeta
		for _, s := range subsList.Subscriptions {
			if s.ID == targetID {
				cp := s
				found = &cp
				break
			}
		}

		if found == nil {
			return fmt.Errorf("subscription %q not found", target)
		}

		if subInfoJSON {
			data, _ := json.MarshalIndent(redactSubscriptionMeta(*found), "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Printf("Subscription Details: %s\n", found.Name)
		fmt.Printf("  ID:           %s\n", found.ID)
		fmt.Printf("  Type:         %s\n", found.Type)
		fmt.Printf("  Health:       %s\n", found.Health)
		if found.LastErrorMessage != "" {
			fmt.Printf("  Last Error:   %s\n", found.LastErrorMessage)
		}
		if found.Quota.TotalBytes > 0 {
			usedGB := float64(found.Quota.DownloadBytes+found.Quota.UploadBytes) / (1024 * 1024 * 1024)
			totalGB := float64(found.Quota.TotalBytes) / (1024 * 1024 * 1024)
			fmt.Printf("  Quota:        %.2f GB / %.2f GB\n", usedGB, totalGB)
			if found.Quota.ExpireUnix > 0 {
				fmt.Printf("  Expires:      %s\n", time.Unix(found.Quota.ExpireUnix, 0).Local().Format("2006-01-02 15:04:05"))
			}
		}
		fmt.Printf("  Interval:     %d hours (auto-update: %v)\n", found.UpdateIntervalHours, found.AutoUpdate)
		fmt.Printf("  Last Checked: %s\n", found.LastCheckedAt.Local().Format("2006-01-02 15:04:05"))
		fmt.Printf("  Last Updated: %s\n", found.LastUpdatedAt.Local().Format("2006-01-02 15:04:05"))
		if len(found.SavedSelections) > 0 {
			fmt.Println("  Saved Selections:")
			for g, n := range found.SavedSelections {
				fmt.Printf("    - %s -> %s\n", g, n)
			}
		}
		return nil
	},
}

var subExportCmd = &cobra.Command{
	Use:   "export [name-or-id]",
	Short: "Export source or runtime configuration",
	Args:  cobra.MaximumNArgs(1),
	Long: `Export the source or derived runtime configuration of a subscription.

With no argument the active subscription is exported. An explicit name or ID that does not exist is an error — export never silently falls back to the active subscription.

--redacted=false emits live credentials; pipe that output somewhere safe.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.Connect(ctx)
		if err != nil {
			return err
		}

		subsList, err := client.ListSubs(ctx)
		if err != nil {
			return err
		}

		target := ""
		if len(args) > 0 {
			target = args[0]
		}
		targetID, err := resolveSubscriptionTarget(subsList, target)
		if err != nil {
			return err
		}

		var targetPath string
		if subExpRuntime {
			targetPath = paths.SubRuntimePath(targetID)
		} else {
			targetPath = paths.SubSourcePath(targetID)
		}

		data, err := os.ReadFile(targetPath)
		if err != nil {
			return fmt.Errorf("failed to read configuration file: %w", err)
		}

		out := string(data)
		if subExpRedacted {
			out = diag.Redact(out)
		}
		fmt.Println(out)
		return nil
	},
}

var subRemoveCmd = &cobra.Command{
	Use:   "remove <name-or-id>",
	Short: "Remove a subscription",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		if err := client.RemoveSub(ctx, args[0]); err != nil {
			return err
		}
		fmt.Printf("Removed subscription: %s\n", args[0])
		return nil
	},
}

func runUpdate(cmd *cobra.Command, args []string) error {
	if subUpdAll && len(args) > 0 {
		return fmt.Errorf("update --all takes no target argument")
	}
	ctx := context.Background()
	client, err := daemon.EnsureRunning(ctx)
	if err != nil {
		return err
	}

	if subUpdAll {
		var res *sub.BatchUpdateResult
		err = withFetchProgress(ctx, client, func() error {
			var updateErr error
			res, updateErr = client.UpdateSubAll(ctx, subUpdForce, subUpdViaProxy)
			return updateErr
		})
		if err != nil {
			return err
		}
		if subUpdJSON {
			data, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(data))
		} else {
			if len(res.Results) == 0 && len(res.Failures) == 0 {
				fmt.Println("No subscriptions to update.")
			}
			for _, r := range res.Results {
				printUpdateOutcome(r)
				printUpdateQuota(r)
			}
			for _, f := range res.Failures {
				fmt.Printf("FAILED %s (%s): %s\n", f.Name, f.ID, f.Error)
			}
		}
		if len(res.Failures) > 0 {
			return fmt.Errorf("%d of %d subscription update(s) failed", len(res.Failures), len(res.Results)+len(res.Failures))
		}
		return nil
	}

	target := ""
	if len(args) > 0 {
		target = args[0]
	}

	var res *sub.UpdateResult
	err = withFetchProgress(ctx, client, func() error {
		var updateErr error
		res, updateErr = client.UpdateSub(ctx, target, subUpdForce, subUpdViaProxy)
		return updateErr
	})
	if err != nil {
		return err
	}

	if subUpdJSON {
		data, _ := json.MarshalIndent(res, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	printUpdateOutcome(*res)
	printUpdateQuota(*res)
	return nil
}

func printUpdateOutcome(res sub.UpdateResult) {
	name := "subscription"
	if res.Meta != nil {
		name = res.Meta.Name
	}
	if res.StatusNotMod {
		fmt.Printf("Subscription %s is already up to date (304 Not Modified). Zero disruption.\n", name)
		return
	}
	if !res.ContentChanged {
		fmt.Printf("Subscription %s content unchanged. Zero disruption.\n", name)
		return
	}
	fmt.Printf("Subscription %s updated successfully.\n", name)
	if res.Diff == nil {
		return
	}
	if len(res.Diff.AddedNodes) > 0 {
		fmt.Printf("  + Added nodes (%d): %s\n", len(res.Diff.AddedNodes), strings.Join(res.Diff.AddedNodes, ", "))
	}
	if len(res.Diff.RemovedNodes) > 0 {
		fmt.Printf("  - Removed nodes (%d): %s\n", len(res.Diff.RemovedNodes), strings.Join(res.Diff.RemovedNodes, ", "))
	}
	if len(res.Diff.AddedGroups) > 0 {
		fmt.Printf("  + Added groups (%d): %s\n", len(res.Diff.AddedGroups), strings.Join(res.Diff.AddedGroups, ", "))
	}
	if len(res.Diff.RemovedGroups) > 0 {
		fmt.Printf("  - Removed groups (%d): %s\n", len(res.Diff.RemovedGroups), strings.Join(res.Diff.RemovedGroups, ", "))
	}
}

func printUpdateQuota(res sub.UpdateResult) {
	if res.Meta == nil || res.Meta.Quota.TotalBytes <= 0 {
		return
	}
	usedGB := float64(res.Meta.Quota.DownloadBytes+res.Meta.Quota.UploadBytes) / (1024 * 1024 * 1024)
	totalGB := float64(res.Meta.Quota.TotalBytes) / (1024 * 1024 * 1024)
	fmt.Printf("Quota: %.2f GB / %.2f GB\n", usedGB, totalGB)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}
