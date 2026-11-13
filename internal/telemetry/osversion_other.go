//go:build !windows && !darwin && !linux

package telemetry

// osVersion is unknown on hosts without a stdlib probe and without a mobile
// bridge (wasm and other exotic targets). Android has its own file: it
// satisfies the linux tag here, and the bridge owns its answer.
func osVersion() string { return "" }
