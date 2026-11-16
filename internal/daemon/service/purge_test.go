package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPurgeUserDataRemovesDirectory(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XBOND_DATA_DIR", dir)
	marker := filepath.Join(dir, "subscriptions.json")
	if err := os.WriteFile(marker, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := PurgeUserData(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("user data directory still exists: %v", err)
	}
}

func TestPurgeUserDataMissingDirectoryIsNotAnError(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", filepath.Join(t.TempDir(), "absent"))
	if err := PurgeUserData(); err != nil {
		t.Fatal(err)
	}
}
