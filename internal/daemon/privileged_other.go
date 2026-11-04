//go:build !windows && !darwin && !linux

package daemon

import (
	"context"
	"errors"
	"net"
	"time"
)

// The machine-scoped daemon is a Windows/macOS/Linux slice; other platforms keep
// the delegation transport explicitly unavailable (never silently anonymous).
func listenPrivileged() (net.Listener, error) {
	return nil, errors.New("privileged delegation transport is not available on this platform")
}

func dialPrivileged(ctx context.Context, _, _ string) (net.Conn, error) {
	return nil, errors.New("privileged delegation transport is not available on this platform")
}

func privilegedProbeTimeout() time.Duration { return 1500 * time.Millisecond }
