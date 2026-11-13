//go:build android

package telemetry

// osVersion has no stdlib probe in the Android sandbox; the mobile bridge
// supplies the value instead via SetOSVersion (XBondVpnService reads
// Build.VERSION.RELEASE). GOOS=android also satisfies the linux tag, so
// this file — not the kernel-release probe — is the android definition.
func osVersion() string { return "" }
