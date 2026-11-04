package engine

import (
	"fmt"
	"sync/atomic"

	"github.com/metacubex/mihomo/hub"
	"github.com/metacubex/mihomo/hub/executor"
	"github.com/sagernet/sing-tun"
	"golang.org/x/sys/unix"
)

// The Packet Tunnel owns one end of a socketpair for the lifetime of the
// tunnel. Each new core (including a rollback) adopts a fresh descriptor.
func startMihomo(config []byte) error {
	parsed, err := executor.ParseWithBytes(config)
	if err != nil {
		return err
	}
	if fd := parsed.General.Tun.FileDescriptor; fd > 0 {
		copy, err := unix.FcntlInt(uintptr(fd), unix.F_DUPFD_CLOEXEC, 3)
		if err != nil {
			return fmt.Errorf("duplicate packet-flow descriptor: %w", err)
		}
		parsed.General.Tun.FileDescriptor = copy
		parsed.General.Tun.RecvMsgX = false
		parsed.General.Tun.SendMsgX = false
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
	copy, err := unix.FcntlInt(uintptr(fd), unix.F_DUPFD_CLOEXEC, 3)
	if err != nil {
		return nil, fmt.Errorf("duplicate packet-flow descriptor: %w", err)
	}
	pendingSingBoxDescriptor.Store(int32(copy))
	return func() {
		if unused := pendingSingBoxDescriptor.Swap(0); unused > 0 {
			_ = unix.Close(int(unused))
		}
	}, nil
}

func useMobileTunDescriptor(options *tun.Options, fd int32) {
	options.FileDescriptor = int(pendingSingBoxDescriptor.Swap(0))
	// UTUN kernel socket options do not apply to the datagram socket.
	options.EXP_MultiPendingPackets = false
	options.EXP_SendMsgX = false
}
