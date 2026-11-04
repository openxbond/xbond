package engine

import (
	"sync/atomic"

	boxtun "github.com/sagernet/sing-box/protocol/tun"
	"github.com/sagernet/sing-tun"
)

// mobileTunFD carries the platform VPN file descriptor for the sing-box core.
// The desktop TUN path opens its own device, so it stays zero there and the
// hook below never fires a value into it.
var mobileTunFD atomic.Int32

// SetMobileTunFD registers the platform VPN fd the sing-box TUN inbound
// should adopt. The JSON config has no field for it any more (v1.13 strict
// parsing rejects "file_descriptor"), and the fd otherwise only rides the
// libbox platform interface — whose mere presence flips ForwarderBindInterface
// and skips BuildAndroidRules, side effects the embedded fd mode must not
// take. Register before starting or reloading the core; clear on stop.
func SetMobileTunFD(fd int32) {
	mobileTunFD.Store(fd)
}

func init() {
	// Vendored patch (scripts/patches/sing-box-tun_hook.go.txt): the hook now
	// receives the inbound's tun options copy right before sing-tun opens
	// the device. Only fd-less configs adopt the registered fd — the desktop
	// auto-route path opens its own device with fd 0 and must stay untouched.
	boxtun.HookBeforeCreatePlatformInterface = func(options *tun.Options) {
		if fd := mobileTunFD.Load(); fd > 0 && options.FileDescriptor == 0 {
			useMobileTunDescriptor(options, fd)
		}
	}
}
