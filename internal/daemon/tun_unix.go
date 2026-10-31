//go:build !windows

package daemon

import (
	"fmt"
	"os"
)

// tunCapability gates TUN takeover on root: creating a TUN adapter needs
// CAP_NET_ADMIN, which in practice means running as root (the daemon spec
// keeps the daemon in the user session; a privileged helper is future work).
func tunCapability() TUNCapability {
	if os.Geteuid() != 0 {
		return TUNCapability{
			ReasonCode: "not_root",
			Reason:     fmt.Sprintf("TUN takeover requires root privileges (current euid %d); restart the daemon as root", os.Geteuid()),
		}
	}
	return TUNCapability{Tun: true}
}
