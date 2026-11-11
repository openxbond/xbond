//go:build windows

package daemon

import (
	"fmt"
	"syscall"

	"golang.org/x/sys/windows"

	"github.com/openxbond/xbond/internal/daemon/service"
	"github.com/openxbond/xbond/internal/platform/wintun"
)

var (
	shell32           = windows.NewLazySystemDLL("shell32.dll")
	procIsUserAnAdmin = shell32.NewProc("IsUserAnAdmin")
)

// serviceSystemInstalled indirection exists for tests: the delegation paths
// are exercised against a fake machine session, not the real SCM.
var serviceSystemInstalled = func() bool { return service.InstalledScope(service.ScopeSystem) }

// tunCapability gates TUN takeover on two Windows realities: somebody needs
// an elevated token to open the wintun adapter — this process, or the
// machine-scoped daemon via delegation — and the wintun driver DLL must be
// findable by whoever opens it. A registered service alone is not TUN
// access: the gate verifies the delegation transport actually answers before
// reporting capable, because the embedded core would otherwise fail on the
// adapter and silently degrade to mixed-only.
func tunCapability(delegate *delegateManager) TUNCapability {
	svcInstalled := serviceSystemInstalled()
	elevated, err := isElevated()
	if err != nil && !svcInstalled {
		return TUNCapability{
			ServiceInstalled: svcInstalled,
			ReasonCode:       "not_elevated",
			Reason:           fmt.Sprintf("could not determine elevation: %v", err),
		}
	}
	if !elevated {
		if !svcInstalled {
			return TUNCapability{
				ServiceInstalled: svcInstalled,
				ReasonCode:       "not_elevated",
				Reason:           "TUN takeover requires administrator privileges; install the system service or restart the daemon as Administrator",
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
		if !wintun.EnsureLocal() {
			return TUNCapability{
				ServiceInstalled: svcInstalled,
				Delegated:        true,
				ReasonCode:       "wintun_missing",
				Reason:           "wintun.dll could not be extracted for the system service (beside its executable or in System32)",
			}
		}
		return TUNCapability{Tun: true, ServiceInstalled: svcInstalled, Delegated: true}
	}
	// The packaged DLL ships inside the binary: extract beside the
	// executable before reporting it missing.
	if !wintun.EnsureLocal() {
		return TUNCapability{
			ServiceInstalled: svcInstalled,
			ReasonCode:       "wintun_missing",
			Reason:           "wintun.dll could not be extracted next to the executable and was not found in System32",
		}
	}
	return TUNCapability{Tun: true, ServiceInstalled: svcInstalled}
}

// localTunCapable reports whether this very process could open the adapter;
// the apply path uses it to pick between the local and the delegated core.
func localTunCapable() bool {
	elevated, err := isElevated()
	return err == nil && elevated
}

func isElevated() (bool, error) {
	// IsUserAnAdmin answers the actual question (elevated token) for both
	// the Run-key autostart and a console daemon; r1 is the BOOL and the
	// errno is the ubiquitous "operation completed successfully".
	r1, _, _ := procIsUserAnAdmin.Call()
	switch r1 {
	case 1:
		return true, nil
	case 0:
		return false, nil
	default:
		return false, syscall.EINVAL
	}
}
