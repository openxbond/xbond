//go:build windows

package service

import (
	"fmt"
	"os"
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
	systemListen         = "127.0.0.1:9059"
)

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
		1, // SW_SHOWNORMAL
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
		"daemon", "--service-run", "--listen", systemListen, "--data-dir", systemDataDir,
	)
	if err != nil {
		return fmt.Errorf("failed to create the service: %w", err)
	}
	defer svc.Close()
	// Installing does not start anything; bring the daemon up right away so
	// install matches the user-scope behavior.
	return startSystemInstalled(m)
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

func querySystem() (svc.State, error) {
	m, err := mgr.Connect()
	if err != nil {
		return 0, fmt.Errorf("failed to connect to the service manager: %w", err)
	}
	defer m.Disconnect()
	handle, err := m.OpenService(systemServiceName)
	if err != nil {
		return svc.Stopped, nil
	}
	defer handle.Close()
	status, err := handle.Query()
	if err != nil {
		return 0, err
	}
	return status.State, nil
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
