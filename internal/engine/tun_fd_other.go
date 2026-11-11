//go:build !ios

package engine

import (
	"github.com/metacubex/mihomo/hub"
	"github.com/sagernet/sing-tun"
)

func startMihomo(config []byte) error { return hub.Parse(config) }

func prepareSingBoxDescriptor() (func(), error) { return func() {}, nil }

func useMobileTunDescriptor(options *tun.Options, fd int32) {
	options.FileDescriptor = int(fd)
}
