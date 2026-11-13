//go:build windows

package telemetry

import (
	"fmt"

	"golang.org/x/sys/windows"
)

// osVersion reports the real Windows release (e.g. "10.0.22631"); RtlGetVersion
// bypasses any manifest-reported compatibility version.
func osVersion() string {
	info := windows.RtlGetVersion()
	if info == nil {
		return ""
	}
	return fmt.Sprintf("%d.%d.%d", info.MajorVersion, info.MinorVersion, info.BuildNumber)
}
