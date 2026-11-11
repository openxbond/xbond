//go:build !windows && !darwin && !linux

package service

import "fmt"

// The machine-scoped daemon is a Windows service, a macOS LaunchDaemon and a Linux systemd system unit
// slice; other platforms keep the system scope explicitly unavailable
// (never silently user).
func systemInstalled() bool           { return false }
func systemStatus() (string, error)   { return "not available", nil }
func uninstallSystemScope() error     { return errSystemUnsupported }
func installSystemScope(string) error { return errSystemUnsupported }
func startSystemScope(string) error   { return errSystemUnsupported }
func stopSystemScope(string) error    { return errSystemUnsupported }

func RunSystemService(string, string, func(<-chan struct{}) error) error {
	return errSystemUnsupported
}

var errSystemUnsupported = fmt.Errorf("scope %q is not available on this platform yet", ScopeSystem)

// SystemAction names the mutating system-scope operation.
type SystemAction string

func RunSystemAction(string, SystemAction) error { return errSystemUnsupported }

// SystemStatus reports the system-scope service state (platform slices).
func SystemStatus() (string, error) { return systemStatus() }
