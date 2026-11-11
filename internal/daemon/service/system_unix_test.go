//go:build linux || darwin

package service

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestMachineInstallVerifiesStagedSource(t *testing.T) {
	group, stat, hash := "root", "stat -c '%u:%a'", "sha256sum"
	if runtime.GOOS == "darwin" {
		group, stat, hash = "wheel", "stat -f '%u:%Lp'", "shasum -a 256"
	}
	dir := t.TempDir()
	source := filepath.Join(dir, "it's a source executable")
	target := filepath.Join(dir, "protected", "xbond")
	registration := filepath.Join(dir, "service-registration")
	const original = "the original binary"
	if err := os.WriteFile(source, []byte(original), 0o755); err != nil {
		t.Fatal(err)
	}
	script, err := installUnixSystemBinary(source, target, registration, group, stat, hash)
	if err != nil {
		t.Fatal(err)
	}
	syntax := exec.Command("/bin/sh", "-n")
	syntax.Stdin = strings.NewReader(script)
	if output, err := syntax.CombinedOutput(); err != nil {
		t.Fatalf("invalid machine installation script: %v: %s", err, output)
	}
	if os.Geteuid() != 0 {
		t.Log("checksum and ownership assertions require a root-owned temporary directory")
		return
	}

	if err := os.WriteFile(source, []byte("changed before authorization"), 0o755); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("/bin/sh", "-c", script).CombinedOutput(); err == nil ||
		!strings.Contains(string(output), "source executable changed") {
		t.Fatalf("tampered source was not refused: %v: %s", err, output)
	}
	if _, err := os.Lstat(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("tampered executable was installed: %v", err)
	}
	if err := os.WriteFile(source, []byte(original), 0o755); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("/bin/sh", "-c", script).CombinedOutput(); err != nil {
		t.Fatalf("install into protected temp path: %v: %s", err, output)
	}
	if err := validateMachineFile(target); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(target)
	if err != nil || string(contents) != original {
		t.Fatalf("installed file = %q, %v", contents, err)
	}
	if err := os.WriteFile(registration, []byte("existing registration"), 0o644); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("/bin/sh", "-c", script).CombinedOutput(); err == nil ||
		!strings.Contains(string(output), "registered concurrently") {
		t.Fatalf("existing registration was not protected: %v: %s", err, output)
	}
}
