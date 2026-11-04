//go:build windows

package service

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"

	"github.com/openxbond/xbond/internal/platform/wintun"
)

// The machine-scoped daemon is a real Windows service (LocalSystem, delayed
// autostart): TUN takeover needs an elevated session that survives logout,
// and the user-session daemon deliberately stays un-elevated so system
// proxy ownership keeps working. The UI reaches the service daemon through
// its loopback LocalAPI (remote management), so the split is invisible to
// the web UI.
const (
	systemServiceName    = "XBondSystemService"
	systemServiceDisplay = "XBond Daemon (system)"
	systemDataDir        = `C:\ProgramData\xbond`
)

// SystemDataDir is the machine-scoped daemon's state directory (Windows
// slice); the elevated installer records the delegation grant inside it.
const SystemDataDir = systemDataDir

var (
	shell32           = windows.NewLazySystemDLL("shell32.dll")
	shell32RunAs      = shell32.NewProc("ShellExecuteW")
	shell32IsAdmin    = windows.NewLazySystemDLL("shell32.dll")
	procIsUserAnAdmin = shell32IsAdmin.NewProc("IsUserAnAdmin")
)

func isElevated() (bool, error) {
	r1, _, _ := procIsUserAnAdmin.Call()
	switch r1 {
	case 1:
		return true, nil
	case 0:
		return false, nil
	default:
		return false, fmt.Errorf("IsUserAnAdmin failed")
	}
}

// elevateForSystemAction re-launches the executable elevated with the given
// action verb (UAC prompt); the elevated copy continues the action and this
// process exits. Errors surface only if the launch itself fails — a declined
// UAC prompt reports "canceled" through the exit path.
func elevateForSystemAction(exePath, action string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to resolve the executable: %w", err)
	}
	verb, err := windows.UTF16PtrFromString("runas")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		return err
	}
	params, err := windows.UTF16PtrFromString("daemon system-action " + action)
	if err != nil {
		return err
	}
	r1, _, _ := shell32RunAs.Call(
		0,
		uintptr(unsafe.Pointer(verb)),
		uintptr(unsafe.Pointer(file)),
		uintptr(unsafe.Pointer(params)),
		0,
		0,
		0, // SW_HIDE (silent elevation in background)
	)
	if r1 <= 32 {
		return fmt.Errorf("elevation was declined or failed (ShellExecute %d); nothing changed", r1)
	}
	fmt.Println("Elevated helper launched; approve the UAC prompt to continue.")
	return nil
}

func installSystem(exePath string) error {
	if ok, err := isElevated(); err != nil || !ok {
		return elevateForSystemAction(exePath, "system-install")
	}
	_ = wintun.EnsureLocal()

	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("failed to connect to the service manager: %w", err)
	}
	defer m.Disconnect()

	if existing, err := m.OpenService(systemServiceName); err == nil {
		status, qerr := existing.Query()
		existing.Close()
		if qerr == nil && (status.State == svc.Running || status.State == svc.StartPending) {
			return nil
		}
		return startSystemInstalled(m)
	}
	svc, err := m.CreateService(
		systemServiceName,
		exePath,
		mgr.Config{
			DisplayName:      systemServiceDisplay,
			Description:      "XBond daemon in the machine session: TUN takeover that survives logout. Managed by the per-user xbond CLI.",
			StartType:        mgr.StartAutomatic,
			DelayedAutoStart: true,
		},
		// Arguments ride binPath: a fixed loopback listen, the machine data
		// dir (the LocalSystem profile has none), and service-run selecting
		// the SCM lifecycle.
		"daemon", "--service-run", "--listen", SystemListen, "--data-dir", systemDataDir,
	)
	if err != nil {
		return fmt.Errorf("failed to create the service: %w", err)
	}
	defer svc.Close()
	// Crash resilience: SCM restarts the tunnel host after a fault, and the
	// delegating daemon's reconciler re-applies the delegated config.
	if err := svc.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 30 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 60 * time.Second},
	}, 86400); err != nil {
		fmt.Printf("recovery actions could not be set (%v); a crashed service stays down until the next delegation attempt\n", err)
	}
	// The elevated copy runs under the invoking user's account (UAC keeps the
	// user, elevation only widens the token), so this token's SID is exactly
	// who may later delegate to the service's privileged transport.
	if err := writeDelegationGrant(systemDataDir); err != nil {
		fmt.Printf("delegation grant could not be written (%v); the service will refuse delegators until reinstall\n", err)
	}
	// Installing does not start anything; bring the daemon up right away so
	// install matches the user-scope behavior.
	return startSystemInstalled(m)
}

// writeDelegationGrant persists the current (invoking, elevated) user's SID
// for the machine-scoped daemon's privileged transport to admit.
func writeDelegationGrant(dataDir string) error {
	sid, err := currentUserSID()
	if err != nil {
		return err
	}
	grant := filepath.Join(dataDir, "delegated-user")
	return os.WriteFile(grant, []byte(sid), 0o644)
}

// currentUserSID resolves the SID string of this process's token user.
func currentUserSID() (string, error) {
	var token windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_QUERY, &token); err != nil {
		return "", fmt.Errorf("open process token: %w", err)
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return "", fmt.Errorf("read token user: %w", err)
	}
	return user.User.Sid.String(), nil
}

// SystemStartInteractive starts the machine service from a normal user
// session without self-elevation: the default service DACL grants
// authenticated users SERVICE_START (stop stays admin-only), and the
// delegation reconciler uses this after SCM crash restarts. An access
// denial surfaces honestly.
func SystemStartInteractive() error {
	sm, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return fmt.Errorf("failed to connect to the service manager: %w", err)
	}
	defer windows.CloseServiceHandle(sm)
	name, err := windows.UTF16PtrFromString(systemServiceName)
	if err != nil {
		return err
	}
	sh, err := windows.OpenService(sm, name, windows.SERVICE_START)
	if err != nil {
		return fmt.Errorf("service %q is not installed or start is not permitted: %w", systemServiceName, err)
	}
	defer windows.CloseServiceHandle(sh)
	return windows.StartService(sh, 0, nil)
}

func uninstallSystem(exePath string) error {
	if ok, err := isElevated(); err != nil || !ok {
		return elevateForSystemAction(exePath, "system-uninstall")
	}
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("failed to connect to the service manager: %w", err)
	}
	defer m.Disconnect()
	handle, err := m.OpenService(systemServiceName)
	if err != nil {
		return nil // already gone: uninstall converges on "gone"
	}
	defer handle.Close()
	status, err := handle.Query()
	if err != nil {
		return err
	}
	if status.State == svc.Running || status.State == svc.StartPending {
		_, _ = handle.Control(svc.Stop)
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			status, err = handle.Query()
			if err != nil || (status.State != svc.Running && status.State != svc.StopPending) {
				break
			}
			time.Sleep(300 * time.Millisecond)
		}
	}
	return handle.Delete()
}

func installSystemScope(exePath string) error { return installSystem(exePath) }

func startSystem() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("failed to connect to the service manager: %w", err)
	}
	defer m.Disconnect()
	return startSystemInstalled(m)
}

func startSystemInstalled(m *mgr.Mgr) error {
	svc, err := m.OpenService(systemServiceName)
	if err != nil {
		return fmt.Errorf("service %q is not installed", systemServiceName)
	}
	defer svc.Close()
	return svc.Start()
}

func stopSystem() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("failed to connect to the service manager: %w", err)
	}
	defer m.Disconnect()
	handle, err := m.OpenService(systemServiceName)
	if err != nil {
		return nil
	}
	defer handle.Close()
	_, err = handle.Control(svc.Stop)
	return err
}

// querySystem reads the machine service's SCM state through read-only
// handles. mgr.Connect (and mgr.OpenService) request ALL_ACCESS, which a
// non-elevated process is denied — exactly the caller whose capability gate
// and status output need this answer. The default service DACL grants
// authenticated users QUERY_STATUS, so connect-and-query never needs
// elevation.
func querySystem() (svc.State, error) {
	sm, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return 0, fmt.Errorf("failed to connect to the service manager: %w", err)
	}
	defer windows.CloseServiceHandle(sm)
	name, err := windows.UTF16PtrFromString(systemServiceName)
	if err != nil {
		return 0, err
	}
	sh, err := windows.OpenService(sm, name, windows.SERVICE_QUERY_STATUS)
	if err != nil {
		// Not installed is the honest, expected negative: the service does
		// not exist, not "we could not look".
		return svc.Stopped, nil
	}
	defer windows.CloseServiceHandle(sh)
	var status windows.SERVICE_STATUS
	if err := windows.QueryServiceStatus(sh, &status); err != nil {
		return 0, fmt.Errorf("query service status: %w", err)
	}
	return svc.State(status.CurrentState), nil
}

// ServiceSystemInstalled reports whether the machine service exists.
func ServiceSystemInstalled() bool {
	_, err := querySystem()
	return err == nil
}

// ServiceSystemState returns the service's SCM state name for status output.
func ServiceSystemState() (string, error) {
	state, err := querySystem()
	if err != nil {
		return "", err
	}
	switch state {
	case svc.Running:
		return "running", nil
	case svc.StartPending:
		return "starting", nil
	case svc.StopPending:
		return "stopping", nil
	default:
		return "stopped", nil
	}
}

// SystemStart/Stop are the CLI entry points; the mutating ones elevate
// themselves first (UAC prompt) and continue in the elevated copy.
func SystemStart(exePath string) error {
	if ok, err := isElevated(); err != nil || !ok {
		return elevateForSystemAction(exePath, "system-start")
	}
	return startSystem()
}

func SystemStop(exePath string) error {
	if ok, err := isElevated(); err != nil || !ok {
		return elevateForSystemAction(exePath, "system-stop")
	}
	return stopSystem()
}

// SystemAction names the mutating system-scope operation.
type SystemAction string

const (
	SystemActionInstall   SystemAction = "system-install"
	SystemActionUninstall SystemAction = "system-uninstall"
	SystemActionStart     SystemAction = "system-start"
	SystemActionStop      SystemAction = "system-stop"
)

// RunSystemAction executes a system-scope action in the (already elevated)
// copy launched by elevateForSystemAction.
func RunSystemAction(exePath string, action SystemAction) error {
	switch action {
	case SystemActionInstall:
		return installSystem(exePath)
	case SystemActionUninstall:
		return uninstallSystem(exePath)
	case SystemActionStart:
		return startSystem()
	case SystemActionStop:
		return stopSystem()
	default:
		return fmt.Errorf("unknown system action %q", action)
	}
}

// SystemStatus reports the system-scope service state for status output.
func SystemStatus() (string, error) { return systemStatus() }
