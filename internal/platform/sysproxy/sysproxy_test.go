package sysproxy

import (
	"os"
	"testing"
	"time"
)

func TestSnapshotLifecycle(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "xbond-sysproxy-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)
	t.Setenv("XBOND_DATA_DIR", tempDir)

	snap := Snapshot{
		Enabled:   true,
		Server:    "127.0.0.1:7890",
		Bypass:    "localhost;127.*",
		Timestamp: time.Now().Unix(),
	}

	if err := SaveSnapshot(snap); err != nil {
		t.Fatalf("SaveSnapshot failed: %v", err)
	}

	loaded, err := LoadSnapshot()
	if err != nil {
		t.Fatalf("LoadSnapshot failed: %v", err)
	}
	if !loaded.Enabled || loaded.Server != "127.0.0.1:7890" {
		t.Errorf("loaded snapshot mismatch: %+v", loaded)
	}

	ClearSnapshot()
	if _, err := LoadSnapshot(); err == nil {
		t.Errorf("expected error after ClearSnapshot, got nil")
	}
}
