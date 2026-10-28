package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

func TestIsDockerEnvironment(t *testing.T) {
	// Test environment variable detection
	t.Run("detects DOCKER env", func(t *testing.T) {
		t.Setenv("DOCKER", "1")
		if !isDockerEnvironment() {
			t.Errorf("expected isDockerEnvironment to be true when DOCKER=1")
		}
	})

	t.Run("detects CONTAINER env", func(t *testing.T) {
		t.Setenv("CONTAINER", "docker")
		if !isDockerEnvironment() {
			t.Errorf("expected isDockerEnvironment to be true when CONTAINER=docker")
		}
	})

	t.Run("detects KUBERNETES env", func(t *testing.T) {
		t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
		if !isDockerEnvironment() {
			t.Errorf("expected isDockerEnvironment to be true when KUBERNETES_SERVICE_HOST is set")
		}
	})
}

func TestPKCEChallengeComputation(t *testing.T) {
	// RFC 7636 Appendix B test vector
	verifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	expectedChallenge := "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

	hash := sha256.Sum256([]byte(verifier))
	actualChallenge := base64.RawURLEncoding.EncodeToString(hash[:])

	if actualChallenge != expectedChallenge {
		t.Fatalf("PKCE challenge mismatch: got %s, want %s", actualChallenge, expectedChallenge)
	}
}

func TestDeviceAuthorizationEndpoints(t *testing.T) {
	var pollCount int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/oauth/device/code":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":               "dvc_test_xyz123",
				"user_code":                 "TEST-CODE",
				"verification_uri":          "https://www.xbond.net/activate",
				"verification_uri_complete": "https://www.xbond.net/activate?code=TEST-CODE",
				"expires_in":                10,
				"interval":                  1,
			})

		case "/api/oauth/token":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_ = r.ParseForm()
			grantType := r.FormValue("grant_type")
			if grantType != "urn:ietf:params:oauth:grant-type:device_code" {
				http.Error(w, "unsupported grant type", http.StatusBadRequest)
				return
			}
			deviceCode := r.FormValue("device_code")
			if deviceCode != "dvc_test_xyz123" {
				http.Error(w, "invalid device code", http.StatusBadRequest)
				return
			}

			count := atomic.AddInt32(&pollCount, 1)
			w.Header().Set("Content-Type", "application/json")
			if count < 2 {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]string{
					"error":             "authorization_pending",
					"error_description": "Waiting for user approval",
				})
				return
			}

			// Success on second poll
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "sub-test-token-device-success",
				"token_type":   "Bearer",
				"expires_in":   2592000,
				"scope":        "subscription",
			})

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	// 1. Verify device code response
	resp, err := http.Post(server.URL+"/api/oauth/device/code", "application/json", strings.NewReader(`{"client_id":"xbond-cli"}`))
	if err != nil {
		t.Fatalf("failed to call mock device code endpoint: %v", err)
	}
	defer resp.Body.Close()

	var dResp struct {
		DeviceCode string `json:"device_code"`
		UserCode   string `json:"user_code"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&dResp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if dResp.DeviceCode != "dvc_test_xyz123" || dResp.UserCode != "TEST-CODE" {
		t.Errorf("unexpected device code response: %+v", dResp)
	}

	// 2. Verify token polling
	form := url.Values{
		"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
		"device_code": {"dvc_test_xyz123"},
	}
	// First call should fail with authorization_pending
	pResp1, err := http.PostForm(server.URL+"/api/oauth/token", form)
	if err != nil {
		t.Fatalf("poll 1 failed: %v", err)
	}
	defer pResp1.Body.Close()
	if pResp1.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for pending poll, got %d", pResp1.StatusCode)
	}

	// Second call should succeed with access token
	pResp2, err := http.PostForm(server.URL+"/api/oauth/token", form)
	if err != nil {
		t.Fatalf("poll 2 failed: %v", err)
	}
	defer pResp2.Body.Close()
	if pResp2.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for successful poll, got %d", pResp2.StatusCode)
	}

	var tData struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(pResp2.Body).Decode(&tData); err != nil {
		t.Fatalf("failed to decode token response: %v", err)
	}
	if tData.AccessToken != "sub-test-token-device-success" {
		t.Errorf("unexpected access token: %s", tData.AccessToken)
	}
}
