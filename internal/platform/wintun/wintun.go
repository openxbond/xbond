//go:build windows

// Package wintun ships the wintun driver DLL inside the binary. The TUN
// gate looks for wintun.dll next to the executable or in System32; a
// downloaded daemon has neither, so the packaged copy is extracted beside
// the executable on first need. The DLL is redistributable per the Wintun
// license (wintun.net, 0.14.1).
package wintun

import (
	_ "embed"
	"os"
	"path/filepath"
)

//go:embed bin/wintun.dll
var embedded []byte

// DLLName is the file name the loader searches for.
const DLLName = "wintun.dll"

// EnsureLocal extracts the packaged DLL next to the executable when neither
// the executable's directory nor System32 provides one. It reports whether
// the DLL is present afterwards.
func EnsureLocal() bool {
	if presentOnDisk() {
		return true
	}
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	target := filepath.Join(filepath.Dir(exe), DLLName)
	// A read-only install directory is a real deployment choice; the
	// outcome rules — the gate reports wintun_missing either way.
	if err := os.WriteFile(target, embedded, 0o644); err != nil {
		return false
	}
	return presentOnDisk()
}

func presentOnDisk() bool {
	exe, err := os.Executable()
	if err == nil {
		if _, err := os.Stat(filepath.Join(filepath.Dir(exe), DLLName)); err == nil {
			return true
		}
	}
	if sysDir := os.Getenv("SystemRoot"); sysDir != "" {
		if _, err := os.Stat(filepath.Join(sysDir, "System32", DLLName)); err == nil {
			return true
		}
	}
	return false
}
