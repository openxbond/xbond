//go:build darwin

package telemetry

import "syscall"

// osVersion reports the macOS / iOS product version (e.g. "14.5") from the
// kernel; GOOS=ios satisfies the darwin build constraint.
func osVersion() string {
	v, err := syscall.Sysctl("kern.osproductversion")
	if err != nil {
		return ""
	}
	return v
}
