package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/openxbond/xbond/internal/clientapi"
	"github.com/openxbond/xbond/internal/daemon"
	"github.com/openxbond/xbond/internal/diag"
	"github.com/openxbond/xbond/internal/i18n"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/sub"
	"github.com/spf13/cobra"
	"golang.org/x/oauth2"
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
		if loginDevice || isDockerEnvironment() {
			resp, err = runDeviceLogin(ctx, client, loginOrigin, effectiveLang, loginName, loginNoBrowser)
		} else {
			resp, err = runPkceLogin(ctx, client, loginOrigin, effectiveLang, loginName, loginNoBrowser)
		}
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

// defaultOrigin 是未显式指定 --origin 时的 OAuth 端点基址；登录成功后配置
// 拉取的线路会按服务端返回的 fallbackDomains 重新落位（completeOAuthLogin）。
const defaultOrigin = "https://www.xbond.net"

func runPkceLogin(
	ctx context.Context,
	client *daemon.Client,
	origin string,
	lang, name string,
	noBrowser bool,
) (*daemon.LoginResponse, error) {
	effectiveLang := i18n.Resolve(lang, "")
	t := func(id string, data ...i18n.P) string { return i18n.T(effectiveLang, id, data...) }

	if origin == "" {
		origin = defaultOrigin
	}
	origin = strings.TrimSuffix(origin, "/")

	// 1. PKCE verifier + CSRF state（challenge 由 x/oauth2 按 RFC 7636 派生）
	codeVerifier := oauth2.GenerateVerifier()
	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		return nil, fmt.Errorf("failed to generate state: %w", err)
	}
	cliState := hex.EncodeToString(stateBytes)
	conf := clientapi.NewConfig(origin)

	// 4. 監聽本機隨機可用端口 (RFC 8252 Loopback Interface)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s %s\n", t("tag.info"), t("pkce.listen_failed", i18n.P{"err": err}))
		return runDeviceLogin(ctx, client, origin, effectiveLang, name, noBrowser)
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port
	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/callback", port)

	codeChan := make(chan string, 1)
	errChan := make(chan error, 1)

	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Private-Network", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		errParam := r.URL.Query().Get("error")
		errDesc := r.URL.Query().Get("error_description")
		if errParam != "" {
			http.Error(w, fmt.Sprintf("OAuth error: %s (%s)", errParam, errDesc), http.StatusBadRequest)
			select {
			case errChan <- fmt.Errorf("oauth error: %s (%s)", errParam, errDesc):
			default:
			}
			return
		}

		code := r.URL.Query().Get("code")
		state := r.URL.Query().Get("state")

		if state != cliState {
			http.Error(w, "Invalid state parameter", http.StatusBadRequest)
			return
		}
		if code == "" {
			http.Error(w, "Missing authorization code", http.StatusBadRequest)
			return
		}

		reqLang := r.URL.Query().Get("lang")
		if reqLang == "" {
			reqLang = effectiveLang
		}
		callbackHTML := i18n.RenderCallbackHTML(reqLang)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(callbackHTML))

		select {
		case codeChan <- code:
		default:
		}
	})

	server := &http.Server{Handler: mux}
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			select {
			case errChan <- err:
			default:
			}
		}
	}()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	authURL := conf.AuthCodeURL(
		cliState,
		oauth2.S256ChallengeOption(codeVerifier),
		oauth2.SetAuthURLParam("redirect_uri", redirectURI),
		clientapi.ResourceOption(),
	)

	// Progress and prompts go to stderr; the final result goes to stdout, so
	// piping login output never swallows the URL you must open.
	fmt.Fprintln(os.Stderr, strings.Repeat("=", 66))
	fmt.Fprintln(os.Stderr, t("pkce.banner"))
	fmt.Fprintln(os.Stderr, strings.Repeat("=", 66))
	if !noBrowser {
		fmt.Fprintln(os.Stderr, t("pkce.opening_browser"))
		if err := openBrowser(authURL); err != nil {
			fmt.Fprintln(os.Stderr, t("pkce.browser_open_failed", i18n.P{"err": err}))
		}
	}
	fmt.Fprintln(os.Stderr, t("pkce.visit_url"))
	fmt.Fprintf(os.Stderr, "  %s\n\n", authURL)
	fmt.Fprintln(os.Stderr, t("pkce.waiting"))

	var authCode string
	select {
	case code := <-codeChan:
		authCode = code
	case err := <-errChan:
		return nil, fmt.Errorf("auth error: %w", err)
	case <-time.After(5 * time.Minute):
		return nil, fmt.Errorf("login timed out after 5 minutes")
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	// 5. 憑授權碼向 Token 端點兌換 OAuth token set
	token, err := conf.Exchange(
		ctx,
		authCode,
		oauth2.VerifierOption(codeVerifier),
		oauth2.SetAuthURLParam("redirect_uri", redirectURI),
		clientapi.ResourceOption(),
	)
	if err != nil {
		return nil, err
	}

	fmt.Fprintf(os.Stderr, "\n%s %s\n", t("tag.success"), t("pkce.success"))
	return completeOAuthLogin(ctx, client, origin, effectiveLang, name, token)
}

// completeOAuthLogin turns a fresh OAuth token set into a bound subscription:
// the subscription URL and its gateway line domains are dynamic, so they come
// from user.credentials.subscriptionLink over tRPC (same procedure as the
// dashboard) instead of being constructed client-side. Config fetching then
// rides the classic ?token= URL channel on the discovered lines.
func completeOAuthLogin(
	ctx context.Context,
	client *daemon.Client,
	origin string,
	lang, name string,
	token *oauth2.Token,
) (*daemon.LoginResponse, error) {
	link, err := clientapi.FetchSubscriptionLinkWithRefresh(ctx, origin, token)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve subscription link: %w", err)
	}
	if link.SubscriptionToken == "" {
		return nil, errors.New(i18n.T(lang, "login.link_unprovisioned"))
	}

	// 線路發現：登入後採用服務端線路表（默認線路 = fallbackDomains[0]）。
	finalOrigin := origin
	if len(link.FallbackDomains) > 0 && origin == defaultOrigin {
		finalOrigin = link.FallbackDomains[0]
	}

	return client.Login(ctx, link.SubscriptionToken, finalOrigin, link.FallbackDomains, "", lang, name, "")
}

func runDeviceLogin(
	ctx context.Context,
	client *daemon.Client,
	origin string,
	lang, name string,
	noBrowser bool,
) (*daemon.LoginResponse, error) {
	effectiveLang := i18n.Resolve(lang, "")
	t := func(id string, data ...i18n.P) string { return i18n.T(effectiveLang, id, data...) }

	if origin == "" {
		origin = defaultOrigin
	}
	origin = strings.TrimSuffix(origin, "/")

	// 1. 請求設備授權碼 (POST /api/auth/device/code, RFC 8628)
	conf := clientapi.NewConfig(origin)
	deviceResp, err := conf.DeviceAuth(ctx, clientapi.ResourceOption())
	if err != nil {
		return nil, err
	}

	// 2. 顯示終端授權指引
	fmt.Fprintln(os.Stderr, strings.Repeat("=", 66))
	fmt.Fprintln(os.Stderr, t("device.banner"))
	fmt.Fprintln(os.Stderr, strings.Repeat("=", 66))
	if !noBrowser && !isDockerEnvironment() {
		fmt.Fprintln(os.Stderr, t("device.opening_browser"))
		if err := openBrowser(deviceResp.VerificationURIComplete); err != nil {
			// In headless environments, openBrowser might fail silently or error
		}
	}
	fmt.Fprintln(os.Stderr, t("device.visit_url"))
	fmt.Fprintf(os.Stderr, "  %s\n\n", deviceResp.VerificationURI)
	fmt.Fprintln(os.Stderr, t("device.code_prompt"))
	fmt.Fprintf(os.Stderr, "  >>>  %s  <<<\n\n", deviceResp.UserCode)
	if deviceResp.VerificationURIComplete != "" {
		fmt.Fprintln(os.Stderr, t("device.quick_link"))
		fmt.Fprintf(os.Stderr, "  %s\n\n", deviceResp.VerificationURIComplete)
	}
	fmt.Fprintln(os.Stderr, t("device.waiting"))

	// 3. 輪詢 Token 端點（RFC 8628）：DeviceAccessToken 內置 pending 靜默與
	// slow_down 退避，截止時間取設備碼有效期；輪詢走後台 goroutine，保留
	// 手動輸入 sub-…/URL 的逃生通道。
	pollCtx, cancelPoll := context.WithCancel(ctx)
	defer cancelPoll()
	type pollResult struct {
		token *oauth2.Token
		err   error
	}
	tokenCh := make(chan pollResult, 1)
	go func() {
		token, err := conf.DeviceAccessToken(pollCtx, deviceResp, clientapi.ResourceOption())
		tokenCh <- pollResult{token, err}
	}()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case result := <-tokenCh:
		if result.err != nil {
			var retrieveErr *oauth2.RetrieveError
			if errors.As(result.err, &retrieveErr) {
				switch retrieveErr.ErrorCode {
				case "expired_token":
					return nil, errors.New(t("device.expired"))
				case "access_denied":
					return nil, errors.New(t("device.denied"))
				}
			}
			if errors.Is(result.err, context.DeadlineExceeded) {
				seconds := int(time.Until(deviceResp.Expiry).Seconds()) + 1
				return nil, fmt.Errorf("%s", t("device.timed_out", i18n.P{"seconds": seconds}))
			}
			return nil, result.err
		}

		fmt.Fprintf(os.Stderr, "\n%s %s\n", t("tag.success"), t("device.approved"))
		return completeOAuthLogin(ctx, client, origin, effectiveLang, name, result.token)
	}
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

		res, err := client.AddSub(ctx, subType, token, subAddOrigin, nil, subAddProtocol, subAddLang, subAddName, urlOrFile, subAddInterval, subAddUse)
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
		res, err := client.UpdateSubAll(ctx, subUpdForce, subUpdViaProxy)
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

	res, err := client.UpdateSub(ctx, target, subUpdForce, subUpdViaProxy)
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
