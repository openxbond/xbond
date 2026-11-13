package account

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/openxbond/xbond/internal/clientapi"
	"golang.org/x/oauth2"
)

func TestRefreshAfterLogoutCannotRestoreSessionFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "account.json")
	if err := SaveSession(path, &Session{AccessToken: "fixture-access", Origin: "https://cloud.example.invalid"}); err != nil {
		t.Fatal(err)
	}
	manager := NewManager(path)
	started, release := make(chan struct{}), make(chan struct{})
	manager.fetchLink = func(context.Context, string, *oauth2.Token) (*clientapi.SubscriptionLink, error) {
		close(started)
		<-release
		return &clientapi.SubscriptionLink{SubscriptionToken: "sub-fixture"}, nil
	}
	done := make(chan error)
	go func() { _, err := manager.RefreshLink(context.Background()); done <- err }()
	<-started
	if err := manager.Logout(context.Background()); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("late refresh was not invalidated: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("late refresh recreated the session file")
	}
}

func TestDeviceLoginPersistsSessionAndResolvesLink(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/device/code":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":               "dvc-1",
				"user_code":                 "ABCD-EFGH",
				"verification_uri":          "/auth/activate",
				"verification_uri_complete": "/auth/activate?user_code=ABCD-EFGH",
				"expires_in":                900,
				"interval":                  1,
			})
		case "/api/auth/oauth2/token":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "at-1",
				"refresh_token": "rt-1",
				"token_type":    "Bearer",
				"expires_in":    3600,
			})
		case "/api/trpc/user.credentials.subscriptionLink":
			if r.URL.Query().Get("batch") != "1" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if r.Header.Get("Authorization") != "Bearer at-1" {
				w.WriteHeader(http.StatusUnauthorized)
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
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	sessionPath := filepath.Join(t.TempDir(), "account.json")
	manager := NewManager(sessionPath)

	var progress Progress
	var openedURL string
	credentials, err := manager.Login(
		context.Background(),
		LoginOptions{
			Origin: server.URL,
			Device: true,
			OpenBrowser: func(target string) error {
				openedURL = target
				return nil
			},
		},
		func(value Progress) { progress = value },
	)
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}
	if credentials.SubscriptionToken != "sub-abc" {
		t.Errorf("subscription token: got %q", credentials.SubscriptionToken)
	}
	if len(credentials.FallbackOrigins) != 2 {
		t.Errorf("fallback origins: got %v", credentials.FallbackOrigins)
	}
	if credentials.LinkError != nil {
		t.Errorf("unexpected link error: %v", credentials.LinkError)
	}
	if progress.Method != "device" || progress.UserCode != "ABCD-EFGH" {
		t.Errorf("progress: %+v", progress)
	}
	if progress.VerificationURI != server.URL+"/auth/activate" {
		t.Errorf("verification URI: got %q", progress.VerificationURI)
	}
	verificationURL := server.URL + "/auth/activate?user_code=ABCD-EFGH"
	if progress.VerificationURIComplete != verificationURL {
		t.Errorf("complete verification URI: got %q", progress.VerificationURIComplete)
	}
	if openedURL != verificationURL {
		t.Errorf("browser URL: got %q, want %q", openedURL, verificationURL)
	}

	session, err := manager.Session()
	if err != nil {
		t.Fatalf("session not saved: %v", err)
	}
	if session.AccessToken != "at-1" || session.RefreshToken != "rt-1" {
		t.Errorf("session tokens: %+v", session)
	}
	if session.Origin != server.URL {
		t.Errorf("session origin: got %q", session.Origin)
	}

	info, err := os.Stat(sessionPath)
	if err != nil {
		t.Fatalf("stat session: %v", err)
	}
	// Windows does not expose POSIX mode bits; the write path still passes
	// 0600 to atomicfile, and Linux/macOS enforce it.
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Errorf("session permissions: got %o", info.Mode().Perm())
	}
}

func TestPKCELoginThroughLoopbackCallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/oauth2/token":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "at-pkce",
				"refresh_token": "rt-pkce",
				"token_type":    "Bearer",
				"expires_in":    3600,
			})
		case "/api/trpc/user.credentials.subscriptionLink":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]any{{
				"result": map[string]any{
					"data": map[string]any{
						"subscriptionToken": "sub-pkce",
						"fallbackDomains":   []string{"https://sub-01.xbond.dev"},
					},
				},
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	sessionPath := filepath.Join(t.TempDir(), "account.json")
	manager := NewManager(sessionPath)
	credentials, err := manager.Login(
		context.Background(),
		LoginOptions{
			Origin: server.URL,
			OpenBrowser: func(authURL string) error {
				parsed, err := url.Parse(authURL)
				if err != nil {
					return err
				}
				callback, err := url.Parse(parsed.Query().Get("redirect_uri"))
				if err != nil {
					return err
				}
				query := callback.Query()
				query.Set("code", "the-code")
				query.Set("state", parsed.Query().Get("state"))
				callback.RawQuery = query.Encode()
				client := &http.Client{
					Transport: &http.Transport{Proxy: nil},
					Timeout:   5 * time.Second,
				}
				response, err := client.Get(callback.String())
				if err != nil {
					return err
				}
				_ = response.Body.Close()
				return nil
			},
		},
		nil,
	)
	if err != nil {
		t.Fatalf("pkce login failed: %v", err)
	}
	if credentials.SubscriptionToken != "sub-pkce" {
		t.Errorf("subscription token: got %q", credentials.SubscriptionToken)
	}
	session, err := manager.Session()
	if err != nil {
		t.Fatalf("session not saved: %v", err)
	}
	if session.AccessToken != "at-pkce" || session.RefreshToken != "rt-pkce" {
		t.Errorf("session tokens: %+v", session)
	}
}

func TestSchemeLoginDeliversCodeThroughDeepLink(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/oauth2/token":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "at-scheme",
				"refresh_token": "rt-scheme",
				"token_type":    "Bearer",
				"expires_in":    3600,
			})
		case "/api/trpc/user.credentials.subscriptionLink":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]any{{
				"result": map[string]any{
					"data": map[string]any{
						"subscriptionToken": "sub-scheme",
						"fallbackDomains":   []string{"https://sub-01.xbond.dev"},
					},
				},
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	// The daemon never listens on loopback in this flow: the desktop shell
	// hands the code over the LocalAPI callback and the state must be the
	// one the authorize URL was built with.
	codeCh := make(chan string, 1)
	var browserState string

	sessionPath := filepath.Join(t.TempDir(), "account.json")
	manager := NewManager(sessionPath)
	credentials, err := manager.Login(
		context.Background(),
		LoginOptions{
			Origin:      server.URL,
			RedirectURI: "xbond://callback",
			OpenBrowser: func(authURL string) error {
				parsed, err := url.Parse(authURL)
				if err != nil {
					return err
				}
				if got := parsed.Query().Get("redirect_uri"); got != "xbond://callback" {
					t.Errorf("redirect_uri: got %q", got)
				}
				browserState = parsed.Query().Get("state")
				if browserState == "" {
					t.Error("authorize URL carries no state")
				}
				codeCh <- "the-code"
				return nil
			},
			WaitCode: func(ctx context.Context, state string) (string, error) {
				if state != browserState {
					return "", errors.New("state mismatch between flow and shell")
				}
				select {
				case code := <-codeCh:
					return code, nil
				case <-ctx.Done():
					return "", ctx.Err()
				}
			},
		},
		nil,
	)
	if err != nil {
		t.Fatalf("scheme login failed: %v", err)
	}
	if credentials.SubscriptionToken != "sub-scheme" {
		t.Errorf("subscription token: got %q", credentials.SubscriptionToken)
	}
	session, err := manager.Session()
	if err != nil {
		t.Fatalf("session not saved: %v", err)
	}
	if session.AccessToken != "at-scheme" || session.RefreshToken != "rt-scheme" {
		t.Errorf("session tokens: %+v", session)
	}
}

func TestLoginKeepsSessionWhenLinkFetchFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/device/code":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":      "dvc-1",
				"user_code":        "ABCD-EFGH",
				"verification_uri": "https://www.xbond.net/auth/activate",
				"expires_in":       900,
				"interval":         1,
			})
		case "/api/auth/oauth2/token":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "at-1",
				"refresh_token": "rt-1",
				"token_type":    "Bearer",
				"expires_in":    3600,
			})
		case "/api/trpc/user.credentials.subscriptionLink":
			w.WriteHeader(http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	sessionPath := filepath.Join(t.TempDir(), "account.json")
	manager := NewManager(sessionPath)
	credentials, err := manager.Login(
		context.Background(),
		LoginOptions{Origin: server.URL, Device: true, NoBrowser: true},
		nil,
	)
	if err != nil {
		t.Fatalf("login failed: %v", err)
	}
	if credentials.LinkError == nil {
		t.Fatal("expected a link error")
	}
	if _, err := manager.Session(); err != nil {
		t.Fatalf("valid login must keep its session: %v", err)
	}
}

func TestRefreshLinkPersistsRotatedToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/trpc/user.credentials.subscriptionLink" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer at-1" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{{
			"result": map[string]any{
				"data": map[string]any{
					"subscriptionToken": "sub-abc",
					"fallbackDomains":   []string{"https://sub-01.xbond.dev"},
				},
			},
		}})
	}))
	defer server.Close()

	sessionPath := filepath.Join(t.TempDir(), "account.json")
	manager := NewManager(sessionPath)
	if err := SaveSession(sessionPath, &Session{
		AccessToken:  "at-1",
		RefreshToken: "rt-1",
		TokenType:    "Bearer",
		Expiry:       time.Now().Add(time.Hour),
		Origin:       server.URL,
	}); err != nil {
		t.Fatalf("save session: %v", err)
	}

	link, err := manager.RefreshLink(context.Background())
	if err != nil {
		t.Fatalf("refresh link: %v", err)
	}
	if link.SubscriptionToken != "sub-abc" {
		t.Errorf("subscription token: got %q", link.SubscriptionToken)
	}
}

// Logout revokes the refresh chain (best effort — even a failing network
// must not strand local credentials) and removes the session file.
func TestLogoutRevokesAndRemovesSession(t *testing.T) {
	sessionPath := filepath.Join(t.TempDir(), "account.json")
	manager := NewManager(sessionPath)
	if err := SaveSession(sessionPath, &Session{AccessToken: "at", RefreshToken: "rt", Origin: DefaultOrigin}); err != nil {
		t.Fatalf("save session: %v", err)
	}
	var revokedOrigin, revokedToken string
	manager.revoke = func(_ context.Context, origin, token string) error {
		revokedOrigin, revokedToken = origin, token
		return errors.New("network down")
	}
	if err := manager.Logout(context.Background()); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if revokedOrigin != DefaultOrigin || revokedToken != "rt" {
		t.Fatalf("refresh token not revoked: %q %q", revokedOrigin, revokedToken)
	}
	if _, err := manager.Session(); !os.IsNotExist(err) {
		t.Fatalf("session still present: %v", err)
	}
}

// Overview reads with the saved session and persists rotated tokens.
func TestOverviewPersistsRotatedTokens(t *testing.T) {
	sessionPath := filepath.Join(t.TempDir(), "account.json")
	manager := NewManager(sessionPath)
	if err := SaveSession(sessionPath, &Session{AccessToken: "at-1", RefreshToken: "rt-1", Origin: DefaultOrigin}); err != nil {
		t.Fatalf("save session: %v", err)
	}
	manager.fetchOverview = func(_ context.Context, origin string, token *oauth2.Token) (*clientapi.AccountOverview, error) {
		if origin != DefaultOrigin || token.AccessToken != "at-1" {
			t.Errorf("unexpected fetch context: %q %q", origin, token.AccessToken)
		}
		token.AccessToken = "at-2"
		return &clientapi.AccountOverview{
			Profile: clientapi.Profile{Email: "user@example.invalid", Name: "User"},
		}, nil
	}
	overview, err := manager.Overview(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if overview.Profile.Email != "user@example.invalid" {
		t.Fatalf("unexpected overview: %+v", overview)
	}
	session, err := manager.Session()
	if err != nil || session.AccessToken != "at-2" {
		t.Fatalf("rotated token not persisted: %+v (%v)", session, err)
	}
}

func TestNormalizeOriginRejectsNonHTTPS(t *testing.T) {
	if _, err := NormalizeOrigin("ftp://example.com"); err == nil {
		t.Fatal("expected invalid origin")
	}
	origin, err := NormalizeOrigin("")
	if err != nil || origin != DefaultOrigin {
		t.Fatalf("default origin: %q, %v", origin, err)
	}
}

func TestIsSessionExpired(t *testing.T) {
	if IsSessionExpired(nil) {
		t.Fatal("nil error should not be expired")
	}
	if IsSessionExpired(errors.New("some network timeout")) {
		t.Fatal("regular error should not be expired")
	}
	if !IsSessionExpired(clientapi.ErrUnauthorized) {
		t.Fatal("ErrUnauthorized should be expired")
	}
	if !IsSessionExpired(&oauth2.RetrieveError{ErrorCode: "invalid_grant", ErrorDescription: "session not found"}) {
		t.Fatal("invalid_grant retrieve error should be expired")
	}
	if !IsSessionExpired(errors.New(`oauth2: "invalid_grant" "session not found"`)) {
		t.Fatal("formatted oauth2 invalid_grant error should be expired")
	}
	if !IsSessionExpired(errors.New("oauth2: invalid refresh token")) {
		t.Fatal("invalid refresh token should be expired")
	}
}
