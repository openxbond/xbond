//go:build !windows && !darwin && !linux

package telemetry

// osVersion is unknown on hosts without a stdlib probe (Android today);
// supplying it needs a new PlatformBridge method and a gomobile rebuild.
func osVersion() string { return "" }
