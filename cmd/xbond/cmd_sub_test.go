package main

import (
	"crypto/sha256"
	"encoding/base64"
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
