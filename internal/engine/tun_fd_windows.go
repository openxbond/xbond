//go:build windows

package engine

import (
	"github.com/metacubex/mihomo/hub"
	"github.com/sagernet/sing-tun"
)

// Desktop Windows never carries a platform VPN descriptor (mobileTunFD stays
// zero and the desktop TUN path opens its own device), so the raw handover
// below is never exercised; unix builds dup per start instead (tun_fd_other.go).
func startMihomo(config []byte) error { return hub.Parse(config) }

func prepareSingBoxDescriptor() (func(), error) { return func() {}, nil }

func useMobileTunDescriptor(options *tun.Options, fd int32) {
	options.FileDescriptor = int(fd)
}
