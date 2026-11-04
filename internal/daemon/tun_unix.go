//go:build !windows

package daemon

import (
	"fmt"
	"os"

	"github.com/openxbond/xbond/internal/daemon/service"
)

// tunCapability gates TUN takeover on an elevated token — this process's
// root, or the machine-scoped daemon via delegation (the daemon spec keeps
// the user-session daemon unprivileged; a privileged helper is the layered
// alternative). A registered service alone is not TUN access: the gate
// verifies the delegation transport actually answers before reporting
// capable, because the embedded core would otherwise fail on the utun
// device and silently degrade to mixed-only.
// serviceSystemInstalled indirection exists for tests: the delegation paths
// are exercised against a fake machine session, not the real supervisor.
var serviceSystemInstalled = func() bool { return service.InstalledScope(service.ScopeSystem) }

func tunCapability(delegate *delegateManager) TUNCapability {
	svcInstalled := serviceSystemInstalled()
	if os.Geteuid() != 0 {
		if !svcInstalled {
			return TUNCapability{
				ServiceInstalled: svcInstalled,
				ReasonCode:       "not_root",
				Reason:           fmt.Sprintf("TUN takeover requires root privileges (current euid %d); install the system service or restart the daemon as root", os.Geteuid()),
			}
		}
		if delegate == nil {
			return TUNCapability{
				ServiceInstalled: svcInstalled,
				ReasonCode:       "service_unreachable",
				Reason:           "the system service is installed but this build cannot reach it",
			}
		}
		if err := delegate.Available(); err != nil {
			return TUNCapability{
				ServiceInstalled: svcInstalled,
				ReasonCode:       "service_unreachable",
				Reason:           fmt.Sprintf("the system service is installed but not serving delegation: %v", err),
			}
		}
		return TUNCapability{Tun: true, ServiceInstalled: svcInstalled, Delegated: true}
	}
	return TUNCapability{Tun: true, ServiceInstalled: svcInstalled}
}

// localTunCapable reports whether this very process could open the device;
// the apply path uses it to pick between the local and the delegated core.
func localTunCapable() bool {
	return os.Geteuid() == 0
}
