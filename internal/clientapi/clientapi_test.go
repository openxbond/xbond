package clientapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

// Config 指向 httptest 服务器：契约断言聚焦在请求形态（client_id/scope/
// resource 的位置与取值）与响应解析，协议轮询本身由 x/oauth2 上游测试覆盖。

func TestNewConfigEndpointShape(t *testing.T) {
	conf := NewConfig("https://api.example.com/")
	if conf.ClientID != ClientID {
		t.Errorf("client id: got %q", conf.ClientID)
	}
	if got := strings.Join(conf.Scopes, " "); got != Scope {
		t.Errorf("scopes: got %q, want %q", got, Scope)
	}
	if conf.Endpoint.AuthURL != "https://api.example.com/api/auth/oauth2/authorize" {
		t.Errorf("auth url: %q", conf.Endpoint.AuthURL)
	}
	if conf.Endpoint.DeviceAuthURL != "https://api.example.com/api/auth/device/code" {
		t.Errorf("device auth url: %q", conf.Endpoint.DeviceAuthURL)
	}
	if conf.Endpoint.TokenURL != "https://api.example.com/api/auth/oauth2/token" {
		t.Errorf("token url: %q", conf.Endpoint.TokenURL)
	}
	if conf.Endpoint.AuthStyle != oauth2.AuthStyleInParams {
		t.Errorf("public client must send client_id in params")
	}
}

func TestAuthCodeURLCarriesPKCEAndResource(t *testing.T) {
	conf := NewConfig("https://api.example.com")
	verifier := oauth2.GenerateVerifier()
	authURL := conf.AuthCodeURL(
		"state-1",
		oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("redirect_uri", "http://127.0.0.1:9/callback"),
		ResourceOption(),
	)
	for _, want := range []string{
		"client_id=" + ClientID,
		"response_type=code",
		"code_challenge_method=S256",
		"scope=" + strings.ReplaceAll(Scope, " ", "+"),
		"resource=" + strings.ReplaceAll(SubscriptionResource, ":", "%3A"),
		"state=state-1",
	} {
		if !strings.Contains(authURL, want) {
			t.Errorf("authorize url missing %q: %s", want, authURL)
		}
	}
}

func TestExchangeCarriesVerifierAndResource(t *testing.T) {
	var form map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		form = map[string]string{}
		for k := range r.Form {
			form[k] = r.FormValue(k)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  "at-1",
			"refresh_token": "rt-1",
			"expires_in":    3600,
			"token_type":    "Bearer",
			"scope":         Scope,
		})
	}))
	defer server.Close()

	conf := NewConfig(server.URL)
	verifier := oauth2.GenerateVerifier()
	token, err := conf.Exchange(
		context.Background(), "the-code",
		oauth2.VerifierOption(verifier),
		oauth2.SetAuthURLParam("redirect_uri", "http://127.0.0.1:9/callback"),
		ResourceOption(),
	)
	if err != nil {
		t.Fatalf("exchange failed: %v", err)
	}
	if form["client_id"] != ClientID {
		t.Errorf("client_id must ride in the body for public clients: %+v", form)
	}
	if form["code_verifier"] != verifier {
		t.Errorf("pkce verifier mismatch: %+v", form)
	}
	if form["resource"] != SubscriptionResource {
		t.Errorf("resource missing: %+v", form)
	}
	if token.AccessToken != "at-1" || token.RefreshToken != "rt-1" {
		t.Errorf("unexpected token: %+v", token)
	}
}

func TestDeviceAuthCarriesContractAndParsesResponse(t *testing.T) {
	var form map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		form = map[string]string{}
		for k := range r.Form {
			form[k] = r.FormValue(k)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"device_code":               "dvc-1",
			"user_code":                 "ABCD-EFGH",
			"verification_uri":          "https://www.xbond.net/activate",
			"verification_uri_complete": "https://www.xbond.net/activate?user_code=ABCD-EFGH",
			"expires_in":                900,
			"interval":                  1,
		})
	}))
	defer server.Close()

	conf := NewConfig(server.URL)
	deviceAuth, err := conf.DeviceAuth(context.Background(), ResourceOption())
	if err != nil {
		t.Fatalf("device auth failed: %v", err)
	}
	if form["client_id"] != ClientID || form["scope"] != Scope ||
		form["resource"] != SubscriptionResource {
		t.Errorf("device auth request missing contract fields: %+v", form)
	}
	if deviceAuth.DeviceCode != "dvc-1" || deviceAuth.UserCode != "ABCD-EFGH" {
		t.Errorf("unexpected device auth response: %+v", deviceAuth)
	}
	if deviceAuth.Interval != 1 {
		t.Errorf("interval: got %d", deviceAuth.Interval)
	}
}

func TestDeviceAccessTokenPollsUntilApproved(t *testing.T) {
	var pollCount int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.FormValue("resource") != SubscriptionResource {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		pollCount++
		w.Header().Set("Content-Type", "application/json")
		if pollCount == 1 {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error": "authorization_pending", "error_description": "waiting",
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "at-ok", "refresh_token": "rt-ok", "token_type": "Bearer",
			"expires_in": 3600, "scope": Scope,
		})
	}))
	defer server.Close()

	conf := NewConfig(server.URL)
	deviceAuth := &oauth2.DeviceAuthResponse{
		DeviceCode: "dvc-1",
		Interval:   1, // keep the test fast; slow_down handling is upstream-tested
	}
	token, err := conf.DeviceAccessToken(
		context.Background(), deviceAuth, ResourceOption(),
	)
	if err != nil {
		t.Fatalf("poll failed: %v", err)
	}
	if token.AccessToken != "at-ok" {
		t.Errorf("unexpected token: %+v", token)
	}
	if pollCount < 2 {
		t.Errorf("expected at least two polls, got %d", pollCount)
	}
}

func TestDeviceAccessTokenSurfacesDenial(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error": "access_denied", "error_description": "user rejected",
		})
	}))
	defer server.Close()

	conf := NewConfig(server.URL)
	deviceAuth := &oauth2.DeviceAuthResponse{DeviceCode: "dvc-1", Interval: 1}
	_, err := conf.DeviceAccessToken(context.Background(), deviceAuth, ResourceOption())
	var retrieveErr *oauth2.RetrieveError
	if !errors.As(err, &retrieveErr) || retrieveErr.ErrorCode != "access_denied" {
		t.Fatalf("denied: got %v, want access_denied RetrieveError", err)
	}
}

func TestFetchSubscriptionLink(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/trpc/user.credentials.subscriptionLink" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer at-1" {
			// 云 API 实测的 401 形态：批量数组 + legacy 错误项。
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode([]map[string]any{{
				"error": map[string]any{
					"message": "Authentication required",
					"code":    -32001,
					"data":    map[string]any{"code": "UNAUTHORIZED", "httpStatus": 401},
				},
			}})
			return
		}
		if r.URL.Query().Get("batch") != "1" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{{
			"result": map[string]any{
				"data": map[string]any{
					"subscriptionToken": "sub-abc",
					"fallbackDomains":   []string{"https://sub-01.xbond.dev", "https://sub-02.xbond.dev"},
				},
			},
		}})
	}))
	defer server.Close()

	link, err := FetchSubscriptionLink(context.Background(), server.URL, "at-1")
	if err != nil {
		t.Fatalf("fetch failed: %v", err)
	}
	if link.SubscriptionToken != "sub-abc" {
		t.Errorf("unexpected token: %q", link.SubscriptionToken)
	}
	if len(link.FallbackDomains) != 2 || link.FallbackDomains[0] != "https://sub-01.xbond.dev" {
		t.Errorf("unexpected domains: %+v", link.FallbackDomains)
	}

	if _, err := FetchSubscriptionLink(context.Background(), server.URL, "wrong"); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("wrong token: got %v, want ErrUnauthorized", err)
	}
}

func TestFetchSubscriptionLinkWithRefresh(t *testing.T) {
	tokenState := struct{ refresh string }{refresh: "rt-1"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/api/auth/oauth2/token"):
			_ = r.ParseForm()
			if r.FormValue("grant_type") != "refresh_token" ||
				r.FormValue("refresh_token") != tokenState.refresh {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
				return
			}
			tokenState.refresh = "rt-2"
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "at-2", "refresh_token": "rt-2",
				"expires_in": 3600, "token_type": "Bearer", "scope": Scope,
			})
		default:
			// tRPC: only the refreshed token passes.
			if r.Header.Get("Authorization") != "Bearer at-2" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_ = json.NewEncoder(w).Encode([]map[string]any{{
				"result": map[string]any{
					"data": map[string]any{
						"subscriptionToken": "sub-after-refresh",
						"fallbackDomains":   []string{},
					},
				},
			}})
		}
	}))
	defer server.Close()

	token := &oauth2.Token{AccessToken: "at-expired", RefreshToken: "rt-1"}
	link, err := FetchSubscriptionLinkWithRefresh(context.Background(), server.URL, token)
	if err != nil {
		t.Fatalf("fetch with refresh failed: %v", err)
	}
	if link.SubscriptionToken != "sub-after-refresh" {
		t.Errorf("unexpected token: %q", link.SubscriptionToken)
	}
	if token.AccessToken != "at-2" || token.RefreshToken != "rt-2" {
		t.Errorf("rotated values not written back: %+v", token)
	}
	// The refreshed token must be non-expiring so callers holding it can
	// reuse it without an immediate second refresh.
	if !token.Expiry.After(time.Now()) {
		t.Errorf("expiry not propagated: %+v", token.Expiry)
	}
}
