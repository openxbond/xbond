//go:build linux && !android

package telemetry

import "syscall"

// osVersion reports the kernel release (e.g. "6.8.0-43"). Distro versions
// have no portable stdlib probe; the kernel release still separates the
// platforms that matter for support.
func osVersion() string {
	var uts syscall.Utsname
	if err := syscall.Uname(&uts); err != nil {
		return ""
	}
	release := make([]rune, 0, len(uts.Release))
	for _, c := range uts.Release {
		if c == 0 {
			break
		}
		release = append(release, rune(c))
	}
	return string(release)
}
