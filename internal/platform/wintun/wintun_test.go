//go:build windows

package wintun

import (
	"os"
	"path/filepath"
	"testing"
)

// EnsureLocal must produce the DLL beside the executable (the gate's first
// search location) and report presence.
func TestEnsureLocalExtractsBesideExecutable(t *testing.T) {
	if !EnsureLocal() {
		t.Fatal("EnsureLocal reported the DLL missing after extraction")
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(exe), DLLName)); err != nil {
		t.Fatalf("extracted DLL not found beside the executable: %v", err)
	}
}
