//go:build windows

// Package wintun ships the wintun driver DLL inside the binary. The TUN
// gate looks for wintun.dll next to the executable or in System32; a
// downloaded daemon has neither, so the packaged copy is extracted beside
// the executable on first need. The DLL is redistributable per the Wintun
// license (wintun.net, 0.14.1).
package wintun

import (
	"os"
	"path/filepath"
)

// DLLName is the file name the loader searches for.
const DLLName = "wintun.dll"

// EnsureLocal extracts the packaged DLL next to the executable when neither
// the executable's directory nor System32 provides one. It reports whether
// the DLL is present afterwards.
func EnsureLocal() bool {
	exe, err := os.Executable()
	if err != nil {
		return presentInSystem32()
	}
	return EnsureInDir(filepath.Dir(exe))
}

// EnsureInDir extracts the packaged DLL into dir when neither dir nor
// System32 already provides one.
func EnsureInDir(dir string) bool {
	if PresentInDir(dir) {
		return true
	}
	if dir == "" || len(embedded) == 0 {
		return false
	}
	target := filepath.Join(dir, DLLName)
	staged, err := os.CreateTemp(dir, ".wintun-*.dll")
	if err != nil {
		// Fallback to direct write if temp creation is blocked.
		if err := os.WriteFile(target, embedded, 0o644); err != nil {
			return false
		}
		return PresentInDir(dir)
	}
	stagedName := staged.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(stagedName)
		}
	}()
	if _, err := staged.Write(embedded); err != nil {
		_ = staged.Close()
		return false
	}
	if err := staged.Close(); err != nil {
		return false
	}
	if err := os.Rename(stagedName, target); err != nil {
		return false
	}
	cleanup = false
	return PresentInDir(dir)
}

// PresentInDir reports whether wintun.dll exists in dir or System32.
func PresentInDir(dir string) bool {
	if dir != "" {
		if _, err := os.Stat(filepath.Join(dir, DLLName)); err == nil {
			return true
		}
	}
	return presentInSystem32()
}

func presentInSystem32() bool {
	if sysDir := os.Getenv("SystemRoot"); sysDir != "" {
		if _, err := os.Stat(filepath.Join(sysDir, "System32", DLLName)); err == nil {
			return true
		}
	}
	return false
}
