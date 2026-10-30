package account

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestDeviceLoginPersistsSessionAndResolvesLink(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/device/code":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":               "dvc-1",
				"user_code":                 "ABCD-EFGH",
				"verification_uri":          "https://www.xbond.net/activate",
				"verification_uri_complete": "https://www.xbond.net/activate?user_code=ABCD-EFGH",
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
	credentials, err := manager.Login(
		context.Background(),
		LoginOptions{Origin: server.URL, Device: true, NoBrowser: true},
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

func TestLoginKeepsSessionWhenLinkFetchFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/device/code":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":      "dvc-1",
				"user_code":        "ABCD-EFGH",
				"verification_uri": "https://www.xbond.net/activate",
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

func TestLogoutRemovesSession(t *testing.T) {
	sessionPath := filepath.Join(t.TempDir(), "account.json")
	manager := NewManager(sessionPath)
	if err := SaveSession(sessionPath, &Session{AccessToken: "at", Origin: DefaultOrigin}); err != nil {
		t.Fatalf("save session: %v", err)
	}
	if err := manager.Logout(); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if _, err := manager.Session(); !os.IsNotExist(err) {
		t.Fatalf("session still present: %v", err)
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
