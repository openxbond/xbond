package sub

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/openxbond/xbond/version"
)

type FetchOptions struct {
	ETag      string
	ViaProxy  bool
	ProxyPort int
	Timeout   time.Duration
}

type FetchResponse struct {
	StatusCode       int
	NotModified      bool
	Body             []byte
	ETag             string
	Quota            *QuotaInfo
	UpdateInterval   int
	WebPageURL       string
	Filename         string
	Health           SubscriptionHealth
	ErrorMessage     string
	RetryAfterHeader int
}

func BuildXBondURL(origin, token, protocol, lang string) string {
	if origin == "" {
		origin = "https://www.xbond.net"
	}
	origin = strings.TrimSuffix(origin, "/")

	if protocol == "" {
		protocol = "vless-reality"
	}
	if lang == "" {
		lang = "zh-HK"
	}

	q := url.Values{}
	q.Set("token", token)
	q.Set("target", "sing-box")
	q.Set("protocol", protocol)
	q.Set("lang", lang)

	return fmt.Sprintf("%s/api/subscription/config?%s", origin, q.Encode())
}

func ProbeGatewayHealth(ctx context.Context, origin string, viaProxy bool, proxyPort int) (bool, error) {
	origin = strings.TrimSuffix(origin, "/")
	nonceBytes := make([]byte, 16)
	_, _ = rand.Read(nonceBytes)
	nonce := hex.EncodeToString(nonceBytes)

	probeURL := fmt.Sprintf("%s/api/subscription/health?nonce=%s", origin, nonce)

	client := createHTTPClient(viaProxy, proxyPort, 3*time.Second)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, probeURL, nil)
	if err != nil {
		return false, err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", fmt.Sprintf("xbond/%s sing-box/%s", version.Version, version.SingBoxVersion))

	resp, err := client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("probe returned status %d", resp.StatusCode)
	}

	var res struct {
		OK    bool   `json:"ok"`
		Nonce string `json:"nonce"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return false, err
	}

	return res.OK && res.Nonce == nonce, nil
}

func FetchSubscription(ctx context.Context, fetchURL string, opts FetchOptions) (*FetchResponse, error) {
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}

	client := createHTTPClient(opts.ViaProxy, opts.ProxyPort, timeout)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fetchURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("User-Agent", fmt.Sprintf("xbond/%s sing-box/%s", version.Version, version.SingBoxVersion))

	if opts.ETag != "" {
		req.Header.Set("If-None-Match", opts.ETag)
	}

	resp, err := client.Do(req)
	if err != nil {
		return &FetchResponse{
			Health:       HealthTransientError,
			ErrorMessage: err.Error(),
		}, err
	}
	defer resp.Body.Close()

	result := &FetchResponse{
		StatusCode: resp.StatusCode,
		ETag:       resp.Header.Get("ETag"),
	}

	// Parse Userinfo header
	if userinfo := resp.Header.Get("Subscription-Userinfo"); userinfo != "" {
		result.Quota = ParseQuotaHeader(userinfo)
	}

	// Parse Profile-Update-Interval header (clamped to 10m - 168h)
	if intervalStr := resp.Header.Get("Profile-Update-Interval"); intervalStr != "" {
		if hours, err := strconv.Atoi(intervalStr); err == nil {
			if hours < 1 {
				hours = 1
			}
			if hours > 168 {
				hours = 168
			}
			result.UpdateInterval = hours
		}
	}

	// Parse Profile-Web-Page-Url
	if webURL := resp.Header.Get("Profile-Web-Page-Url"); webURL != "" {
		result.WebPageURL = webURL
	}

	// Parse Content-Disposition filename
	if cd := resp.Header.Get("Content-Disposition"); cd != "" {
		if _, params, err := mime.ParseMediaType(cd); err == nil {
			if fn, ok := params["filename"]; ok && fn != "" {
				fn = strings.TrimSuffix(fn, ".json")
				fn = strings.TrimSuffix(fn, ".yaml")
				result.Filename = fn
			}
		}
		if result.Filename == "" && strings.Contains(cd, "filename=") {
			parts := strings.Split(cd, "filename=")
			if len(parts) > 1 {
				fn := strings.Split(parts[1], ";")[0]
				fn = strings.Trim(fn, `"' `)
				fn = strings.TrimSuffix(fn, ".json")
				fn = strings.TrimSuffix(fn, ".yaml")
				result.Filename = fn
			}
		}
	}

	// Check status code
	if resp.StatusCode == http.StatusNotModified {
		result.NotModified = true
		result.Health = HealthOK
		return result, nil
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		result.Health = HealthTransientError
		result.ErrorMessage = fmt.Sprintf("failed to read response body: %v", err)
		return result, err
	}
	result.Body = bodyBytes

	switch resp.StatusCode {
	case http.StatusOK:
		result.Health = HealthOK
		return result, nil

	case http.StatusUnauthorized:
		result.Health = HealthCredentialInvalid
		result.ErrorMessage = "Subscription token is invalid or has expired."
		return result, fmt.Errorf("credential invalid: %s", string(bodyBytes))

	case http.StatusForbidden:
		bodyStr := string(bodyBytes)
		var errObj struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(bodyBytes, &errObj)
		errMsg := errObj.Error
		if errMsg == "" {
			errMsg = bodyStr
		}

		lower := strings.ToLower(errMsg)
		if strings.Contains(lower, "quota") {
			result.Health = HealthQuotaExhausted
			result.ErrorMessage = "Data quota exhausted."
		} else if strings.Contains(lower, "plan") {
			result.Health = HealthNoActivePlan
			result.ErrorMessage = "No active subscription plan."
		} else if strings.Contains(lower, "banned") {
			result.Health = HealthAccountBanned
			result.ErrorMessage = "Account is banned."
		} else {
			result.Health = HealthQuotaExhausted
			result.ErrorMessage = errMsg
		}
		return result, fmt.Errorf("forbidden: %s", errMsg)

	case http.StatusConflict:
		result.Health = HealthProxyTokenConflict
		result.ErrorMessage = "Proxy token conflict. Please rotate token in console."
		return result, fmt.Errorf("proxy token conflict: %s", string(bodyBytes))

	case http.StatusTooManyRequests:
		result.Health = HealthRateLimited
		result.ErrorMessage = "Rate limited by upstream server."
		if retryAfter := resp.Header.Get("Retry-After"); retryAfter != "" {
			if secs, err := strconv.Atoi(retryAfter); err == nil {
				result.RetryAfterHeader = secs
			}
		}
		return result, fmt.Errorf("rate limited")

	default:
		result.Health = HealthTransientError
		result.ErrorMessage = fmt.Sprintf("upstream server returned status %d", resp.StatusCode)
		return result, fmt.Errorf("upstream error %d: %s", resp.StatusCode, string(bodyBytes))
	}
}

func createHTTPClient(viaProxy bool, proxyPort int, timeout time.Duration) *http.Client {
	transport := &http.Transport{
		DisableKeepAlives: true,
	}

	if viaProxy && proxyPort > 0 {
		proxyURL, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", proxyPort))
		transport.Proxy = http.ProxyURL(proxyURL)
	} else {
		// Explicitly disable any OS/env proxy to ensure direct-bypass
		transport.Proxy = nil
	}

	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
	}
}
