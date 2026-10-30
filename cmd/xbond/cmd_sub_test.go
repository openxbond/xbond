package main

import (
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
