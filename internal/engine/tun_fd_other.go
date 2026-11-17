//go:build !ios && !windows

package engine

import (
	"fmt"
	"sync/atomic"

	"github.com/metacubex/mihomo/hub"
	"github.com/metacubex/mihomo/hub/executor"
	"github.com/sagernet/sing-tun"
	"golang.org/x/sys/unix"
)

// Cores adopt the platform VPN fd by raw number and close it when the
// instance stops: sing-tun wraps the number in an os.File, so every box
// shutdown takes the platform descriptor with it. Each start therefore
// receives its own F_DUPFD_CLOEXEC copy — the platform keeps the original
// open for the next start, rollback included, and a core stop only closes
// its copy. The iOS build carries the same mechanism with UTUN-specific
// extras (tun_fd_ios.go).
func dupMobileDescriptor(fd int32) (int32, error) {
	copy, err := unix.FcntlInt(uintptr(fd), unix.F_DUPFD_CLOEXEC, 3)
	if err != nil {
		return 0, fmt.Errorf("duplicate packet-flow descriptor: %w", err)
	}
	return int32(copy), nil
}

func startMihomo(config []byte) error {
	parsed, err := executor.ParseWithBytes(config)
	if err != nil {
		return err
	}
	if fd := parsed.General.Tun.FileDescriptor; fd > 0 {
		copy, err := dupMobileDescriptor(int32(fd))
		if err != nil {
			return err
		}
		parsed.General.Tun.FileDescriptor = int(copy)
	}
	hub.ApplyConfig(parsed)
	return nil
}

var pendingSingBoxDescriptor atomic.Int32

func prepareSingBoxDescriptor() (func(), error) {
	fd := mobileTunFD.Load()
	if fd <= 0 {
		return func() {}, nil
	}
	copy, err := dupMobileDescriptor(fd)
	if err != nil {
		return nil, err
	}
	pendingSingBoxDescriptor.Store(copy)
	return func() {
		if unused := pendingSingBoxDescriptor.Swap(0); unused > 0 {
			_ = unix.Close(int(unused))
		}
	}, nil
}

func useMobileTunDescriptor(options *tun.Options, fd int32) {
	options.FileDescriptor = int(pendingSingBoxDescriptor.Swap(0))
}
