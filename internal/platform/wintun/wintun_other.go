//go:build !windows

package wintun

// EnsureLocal is the no-op stub for non-Windows platforms; wintun is a
// Windows driver DLL and the TUN gate on other platforms never asks.
func EnsureLocal() bool { return true }
