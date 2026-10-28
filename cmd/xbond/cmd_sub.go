package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/openxbond/xbond/daemon"
	"github.com/openxbond/xbond/diag"
	"github.com/openxbond/xbond/i18n"
	"github.com/openxbond/xbond/paths"
	"github.com/openxbond/xbond/sub"
	"github.com/spf13/cobra"
)

var (
	loginToken     string
	loginURL       string
	loginFile      string
	loginOrigin    string
	loginFallback  string
	loginProtocol  string
	loginName      string
	loginNoBrowser bool
	loginDevice    bool

	logoutPurge bool

	subAddOrigin   string
	subAddFallback string
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
	loginCmd.Flags().StringVar(&loginToken, "token", "", "XBond subscription token (starts with sub-)")
	loginCmd.Flags().StringVar(&loginURL, "url", "", "Remote subscription URL")
	loginCmd.Flags().StringVar(&loginFile, "file", "", "Local subscription configuration file path")
	loginCmd.Flags().StringVar(&loginOrigin, "origin", "", "XBond gateway origin (default https://www.xbond.net)")
	loginCmd.Flags().StringVar(&loginFallback, "fallback", "", "Comma-separated fallback origins")
	loginCmd.Flags().StringVar(&loginProtocol, "protocol", "vless-reality", "Preferred protocol: vless-reality, trojan-ws")
	loginCmd.Flags().StringVar(&loginName, "name", "", "Subscription profile label")
	loginCmd.Flags().BoolVar(&loginNoBrowser, "no-browser", false, "Do not open browser automatically, print URL only")
	loginCmd.Flags().BoolVar(&loginDevice, "device", false, "Use OAuth 2.0 Device Authorization flow (for Docker, SSH, or headless environments)")
	rootCmd.AddCommand(loginCmd)

	// logout
	logoutCmd.Flags().BoolVar(&logoutPurge, "purge", false, "Delete local credentials and cached subscription files")
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
	subAddCmd.Flags().StringVar(&subAddFallback, "fallback", "", "Comma-separated fallback origins")
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
	Short: "Bind and activate an XBond token or subscription URL",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		var fallbacks []string
		if loginFallback != "" {
			fallbacks = strings.Split(loginFallback, ",")
		}

		targetInput := loginToken
		urlOrFile := loginURL
		if urlOrFile == "" {
			urlOrFile = loginFile
		}

		if targetInput == "" && urlOrFile == "" && len(args) > 0 {
			arg := args[0]
			if strings.HasPrefix(arg, "sub-") {
				targetInput = arg
			} else {
				urlOrFile = arg
			}
		}

		effectiveLang := i18n.Resolve(globalLang, "")
		t := func(id string, data ...i18n.P) string { return i18n.T(effectiveLang, id, data...) }

		var meta *sub.SubscriptionMeta
		if targetInput == "" && urlOrFile == "" {
			if loginDevice || isDockerEnvironment() {
				meta, err = runDeviceLogin(ctx, client, loginOrigin, fallbacks, loginProtocol, effectiveLang, loginName, loginNoBrowser)
			} else {
				meta, err = runPkceLogin(ctx, client, loginOrigin, fallbacks, loginProtocol, effectiveLang, loginName, loginNoBrowser)
			}
			if err != nil {
				return err
			}
		} else {
			meta, err = client.Login(ctx, targetInput, loginOrigin, fallbacks, loginProtocol, effectiveLang, loginName, urlOrFile)
			if err != nil {
				return err
			}
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

func runPkceLogin(
	ctx context.Context,
	client *daemon.Client,
	origin string,
	fallbacks []string,
	protocol, lang, name string,
	noBrowser bool,
) (*sub.SubscriptionMeta, error) {
	effectiveLang := i18n.Resolve(lang, "")
	t := func(id string, data ...i18n.P) string { return i18n.T(effectiveLang, id, data...) }

	if origin == "" {
		origin = "https://www.xbond.net"
	}
	origin = strings.TrimSuffix(origin, "/")

	// 1. 生成 PKCE code_verifier (32 字節高熵隨機數，Base64URL 編碼無補位，符合 RFC 7636)
	verifierBytes := make([]byte, 32)
	if _, err := rand.Read(verifierBytes); err != nil {
		return nil, fmt.Errorf("failed to generate pkce verifier: %w", err)
	}
	codeVerifier := base64.RawURLEncoding.EncodeToString(verifierBytes)

	// 2. 計算 code_challenge = Base64URL(SHA256(code_verifier))
	hash := sha256.Sum256([]byte(codeVerifier))
	codeChallenge := base64.RawURLEncoding.EncodeToString(hash[:])

	// 3. 生成 CSRF state
	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		return nil, fmt.Errorf("failed to generate state: %w", err)
	}
	cliState := hex.EncodeToString(stateBytes)

	// 4. 監聽本機隨機可用端口 (RFC 8252 Loopback Interface)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Printf("%s %s\n", t("tag.info"), t("pkce.listen_failed", i18n.P{"err": err}))
		return runDeviceLogin(ctx, client, origin, fallbacks, protocol, effectiveLang, name, noBrowser)
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

	authURL := fmt.Sprintf(
		"%s/api/oauth/authorize?client_id=xbond-cli&response_type=code&code_challenge=%s&code_challenge_method=S256&redirect_uri=%s&state=%s&lang=%s",
		origin,
		url.QueryEscape(codeChallenge),
		url.QueryEscape(redirectURI),
		url.QueryEscape(cliState),
		url.QueryEscape(effectiveLang),
	)

	fmt.Println(strings.Repeat("=", 66))
	fmt.Println(t("pkce.banner"))
	fmt.Println(strings.Repeat("=", 66))
	if !noBrowser {
		fmt.Println(t("pkce.opening_browser"))
		if err := openBrowser(authURL); err != nil {
			fmt.Println(t("pkce.browser_open_failed", i18n.P{"err": err}))
		}
	}
	fmt.Println(t("pkce.visit_url"))
	fmt.Printf("  %s\n\n", authURL)
	fmt.Println(t("pkce.waiting"))
	fmt.Println(t("pkce.headless_hint"))
	fmt.Print("> ")

	inputChan := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		if scanner.Scan() {
			text := strings.TrimSpace(scanner.Text())
			if text != "" {
				inputChan <- text
			}
		}
	}()

	var authCode string
	select {
	case code := <-codeChan:
		authCode = code
	case input := <-inputChan:
		targetInput := ""
		urlOrFile := ""
		if strings.HasPrefix(input, "sub-") {
			targetInput = input
		} else {
			urlOrFile = input
		}
		return client.Login(ctx, targetInput, origin, fallbacks, protocol, effectiveLang, name, urlOrFile)
	case err := <-errChan:
		return nil, fmt.Errorf("auth error: %w", err)
	case <-time.After(5 * time.Minute):
		return nil, fmt.Errorf("login timed out after 5 minutes")
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	// 5. 憑授權碼向 Token 端點兌換訂閱憑據
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {"xbond-cli"},
		"code":          {authCode},
		"code_verifier": {codeVerifier},
		"redirect_uri":  {redirectURI},
	}
	tokenURL := fmt.Sprintf("%s/api/oauth/token", origin)
	resp, err := http.PostForm(tokenURL, form)
	if err != nil {
		return nil, fmt.Errorf("failed to exchange authorization code: %w", err)
	}
	defer resp.Body.Close()

	var tokenData struct {
		AccessToken      string `json:"access_token"`
		TokenType        string `json:"token_type"`
		ExpiresIn        int    `json:"expires_in"`
		Scope            string `json:"scope"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenData); err != nil {
		return nil, fmt.Errorf("failed to decode token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token exchange failed: %s (%s)", tokenData.Error, tokenData.ErrorDescription)
	}
	if tokenData.AccessToken == "" {
		return nil, fmt.Errorf("received empty access token from server")
	}

	fmt.Printf("\n%s %s\n", t("tag.success"), t("pkce.success"))
	return client.Login(ctx, tokenData.AccessToken, origin, fallbacks, protocol, effectiveLang, name, "")
}

func runDeviceLogin(
	ctx context.Context,
	client *daemon.Client,
	origin string,
	fallbacks []string,
	protocol, lang, name string,
	noBrowser bool,
) (*sub.SubscriptionMeta, error) {
	effectiveLang := i18n.Resolve(lang, "")
	t := func(id string, data ...i18n.P) string { return i18n.T(effectiveLang, id, data...) }

	if origin == "" {
		origin = "https://www.xbond.net"
	}
	origin = strings.TrimSuffix(origin, "/")

	// 1. 請求設備授權碼 (POST /api/oauth/device/code)
	reqBody, _ := json.Marshal(map[string]string{
		"client_id": "xbond-cli",
	})
	codeURL := fmt.Sprintf("%s/api/oauth/device/code", origin)
	resp, err := http.Post(codeURL, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to request device authorization code: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("device authorization request failed (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	var deviceResp struct {
		DeviceCode              string `json:"device_code"`
		UserCode                string `json:"user_code"`
		VerificationURI         string `json:"verification_uri"`
		VerificationURIComplete string `json:"verification_uri_complete"`
		ExpiresIn               int    `json:"expires_in"`
		Interval                int    `json:"interval"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&deviceResp); err != nil {
		return nil, fmt.Errorf("failed to decode device authorization response: %w", err)
	}

	// 2. 顯示終端授權指引
	fmt.Println(strings.Repeat("=", 66))
	fmt.Println(t("device.banner"))
	fmt.Println(strings.Repeat("=", 66))
	if !noBrowser && !isDockerEnvironment() {
		fmt.Println(t("device.opening_browser"))
		if err := openBrowser(deviceResp.VerificationURIComplete); err != nil {
			// In headless environments, openBrowser might fail silently or error
		}
	}
	fmt.Println(t("device.visit_url"))
	fmt.Printf("  %s\n\n", deviceResp.VerificationURI)
	fmt.Println(t("device.code_prompt"))
	fmt.Printf("  >>>  %s  <<<\n\n", deviceResp.UserCode)
	if deviceResp.VerificationURIComplete != "" {
		fmt.Println(t("device.quick_link"))
		fmt.Printf("  %s\n\n", deviceResp.VerificationURIComplete)
	}
	fmt.Println(t("device.waiting"))
	fmt.Print("> ")

	inputChan := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		if scanner.Scan() {
			text := strings.TrimSpace(scanner.Text())
			if text != "" {
				inputChan <- text
			}
		}
	}()

	// 3. 輪詢 Token 端點 (RFC 8628)
	pollInterval := deviceResp.Interval
	if pollInterval < 3 {
		pollInterval = 5
	}
	expiresIn := deviceResp.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 900
	}

	ticker := time.NewTicker(time.Duration(pollInterval) * time.Second)
	defer ticker.Stop()

	timeout := time.After(time.Duration(expiresIn) * time.Second)
	tokenURL := fmt.Sprintf("%s/api/oauth/token", origin)

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timeout:
			return nil, fmt.Errorf("%s", t("device.timed_out", i18n.P{"seconds": expiresIn}))
		case input := <-inputChan:
			targetInput := ""
			urlOrFile := ""
			if strings.HasPrefix(input, "sub-") {
				targetInput = input
			} else {
				urlOrFile = input
			}
			return client.Login(ctx, targetInput, origin, fallbacks, protocol, effectiveLang, name, urlOrFile)
		case <-ticker.C:
			form := url.Values{
				"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
				"client_id":   {"xbond-cli"},
				"device_code": {deviceResp.DeviceCode},
			}
			tResp, err := http.PostForm(tokenURL, form)
			if err != nil {
				continue // 網絡暫時抖動，繼續重試
			}

			var tokenData struct {
				AccessToken      string `json:"access_token"`
				TokenType        string `json:"token_type"`
				ExpiresIn        int    `json:"expires_in"`
				Scope            string `json:"scope"`
				Error            string `json:"error"`
				ErrorDescription string `json:"error_description"`
			}
			_ = json.NewDecoder(tResp.Body).Decode(&tokenData)
			tResp.Body.Close()

			if tResp.StatusCode == http.StatusOK && tokenData.AccessToken != "" {
				fmt.Printf("\n%s %s\n", t("tag.success"), t("device.approved"))
				return client.Login(ctx, tokenData.AccessToken, origin, fallbacks, protocol, effectiveLang, name, "")
			}

			switch tokenData.Error {
			case "authorization_pending":
				// 用戶尚未點擊確認，保持靜默輪詢
				continue
			case "slow_down":
				// RFC 8628: 增加 5 秒間隔
				pollInterval += 5
				ticker.Reset(time.Duration(pollInterval) * time.Second)
				continue
			case "expired_token":
				return nil, errors.New(t("device.expired"))
			case "access_denied":
				return nil, errors.New(t("device.denied"))
			default:
				if tokenData.Error != "" {
					return nil, fmt.Errorf("oauth error: %s (%s)", tokenData.Error, tokenData.ErrorDescription)
				}
			}
		}
	}
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Log out and stop the active subscription",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.NewClient()
		if err != nil {
			return err
		}
		if err := client.Logout(ctx, logoutPurge); err != nil {
			return err
		}
		fmt.Println("Logged out successfully.")
		return nil
	},
}

var updateCmd = &cobra.Command{
	Use:   "update [name-or-id]",
	Short: "Refresh active or specified subscription",
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
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		listRes, err := client.ListSubs(ctx)
		if err != nil {
			return err
		}

		if subListJSON {
			data, _ := json.MarshalIndent(listRes, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(listRes.Subscriptions) == 0 {
			fmt.Println("No subscriptions configured. Use 'xbond login' or 'xbond sub add' to get started.")
			return nil
		}

		fmt.Printf("%-3s %-16s %-10s %-12s %-20s %-20s\n", "ACT", "NAME", "TYPE", "STATUS", "QUOTA (USED/TOTAL)", "LAST UPDATED")
		fmt.Println(strings.Repeat("-", 85))

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

			fmt.Printf("%-3s %-16s %-10s %-12s %-20s %-20s\n",
				act, truncate(s.Name, 16), s.Type, s.Health, quotaStr, lastUp)
		}
		return nil
	},
}

var subAddCmd = &cobra.Command{
	Use:   "add <token|url|file>",
	Short: "Add a new subscription",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		input := args[0]
		var subType sub.SubscriptionType
		var token, urlOrFile string

		if strings.HasPrefix(input, "sub-") {
			subType = sub.SubTypeXBond
			token = input
		} else {
			subType = sub.SubTypeUniversal
			urlOrFile = input
		}

		var fallbacks []string
		if subAddFallback != "" {
			fallbacks = strings.Split(subAddFallback, ",")
		}

		meta, err := client.AddSub(ctx, subType, token, subAddOrigin, fallbacks, subAddProtocol, subAddLang, subAddName, urlOrFile, subAddInterval, subAddUse)
		if err != nil {
			return err
		}

		fmt.Printf("Added subscription %s (%s)\n", meta.Name, meta.ID)
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
	RunE: func(cmd *cobra.Command, args []string) error {
		return runUpdate(cmd, args)
	},
}

var subInfoCmd = &cobra.Command{
	Use:   "info [name-or-id]",
	Short: "Inspect subscription details and metadata",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
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
		} else {
			target = subsList.ActiveID
		}

		var found *sub.SubscriptionMeta
		for _, s := range subsList.Subscriptions {
			if s.ID == target || s.Name == target {
				cp := s
				found = &cp
				break
			}
		}

		if found == nil {
			return fmt.Errorf("subscription %q not found", target)
		}

		if subInfoJSON {
			data, _ := json.MarshalIndent(found, "", "  ")
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
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := context.Background()
		client, err := daemon.EnsureRunning(ctx)
		if err != nil {
			return err
		}

		subsList, err := client.ListSubs(ctx)
		if err != nil {
			return err
		}

		targetID := subsList.ActiveID
		if len(args) > 0 {
			for _, s := range subsList.Subscriptions {
				if s.ID == args[0] || s.Name == args[0] {
					targetID = s.ID
					break
				}
			}
		}

		if targetID == "" {
			return fmt.Errorf("no subscription specified and no active subscription")
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
	ctx := context.Background()
	client, err := daemon.EnsureRunning(ctx)
	if err != nil {
		return err
	}

	target := ""
	if len(args) > 0 {
		target = args[0]
	}

	res, err := client.UpdateSub(ctx, target, subUpdForce, subUpdViaProxy, subUpdAll)
	if err != nil {
		return err
	}

	if subUpdJSON {
		data, _ := json.MarshalIndent(res, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	if res.StatusNotMod {
		fmt.Printf("Subscription %s is already up to date (304 Not Modified). Zero disruption.\n", res.Meta.Name)
	} else if !res.ContentChanged {
		fmt.Printf("Subscription %s content unchanged. Zero disruption.\n", res.Meta.Name)
	} else {
		fmt.Printf("Subscription %s updated successfully.\n", res.Meta.Name)
		if res.Diff != nil {
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
	}

	if res.Meta.Quota.TotalBytes > 0 {
		usedGB := float64(res.Meta.Quota.DownloadBytes+res.Meta.Quota.UploadBytes) / (1024 * 1024 * 1024)
		totalGB := float64(res.Meta.Quota.TotalBytes) / (1024 * 1024 * 1024)
		fmt.Printf("Quota: %.2f GB / %.2f GB\n", usedGB, totalGB)
	}
	return nil
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}
