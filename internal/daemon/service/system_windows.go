//go:build windows

package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"

	"github.com/openxbond/xbond/internal/upgrade"
)

// The machine-scoped daemon is a real Windows service (LocalSystem, automatic
// start): TUN takeover needs an elevated session that survives logout, and
// the user-session daemon deliberately stays un-elevated so system proxy
// ownership keeps working. The UI reaches the service daemon through its
// loopback LocalAPI (remote management), so the split is invisible to the web
// UI. The start must not be delayed: the logon daemon restores a TUN
// connection right away, and a delayed service leaves the delegation pipe
// missing for the first minutes after boot — the gate then reports
// service_unreachable and connect fails for no user-visible reason.
const (
	systemServiceName    = "XBondSystemService"
	systemServiceDisplay = "XBond Daemon (system)"
)

var (
	shell32           = windows.NewLazySystemDLL("shell32.dll")
	procShellExecute  = shell32.NewProc("ShellExecuteExW")
	procIsUserAnAdmin = shell32.NewProc("IsUserAnAdmin")
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

type shellExecuteInfo struct {
	size       uint32
	mask       uint32
	window     windows.Handle
	verb       *uint16
	file       *uint16
	parameters *uint16
	directory  *uint16
	show       int32
	instance   windows.Handle
	idList     uintptr
	class      *uint16
	classKey   windows.Handle
	hotkey     uint32
	icon       windows.Handle
	process    windows.Handle
}

var errElevationDeclined = errors.New("elevation was declined")

// runElevatedWindowsCommand launches executable with UAC elevation and waits
// for the elevated child process to exit, returning its exit code.
func runElevatedWindowsCommand(executable string, args []string) (uint32, error) {
	verb, err := windows.UTF16PtrFromString("runas")
	if err != nil {
		return 0, err
	}
	file, err := windows.UTF16PtrFromString(executable)
	if err != nil {
		return 0, err
	}
	parameters, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(args))
	if err != nil {
		return 0, err
	}
	info := shellExecuteInfo{
		size:       uint32(unsafe.Sizeof(shellExecuteInfo{})),
		mask:       0x00000040 | 0x00000100 | 0x00000400, // NOCLOSEPROCESS, NOASYNC, FLAG_NO_UI
		verb:       verb,
		file:       file,
		parameters: parameters,
		show:       0, // SW_HIDE
	}
	runtime.LockOSThread()
	ole := windows.NewLazySystemDLL("ole32.dll")
	initialise := ole.NewProc("CoInitializeEx")
	uninitialise := ole.NewProc("CoUninitialize")
	result, _, _ := initialise.Call(0, 0x2|0x4) // APARTMENTTHREADED | DISABLE_OLE1DDE
	if result != 0 && result != 1 {
		runtime.UnlockOSThread()
		return 0, fmt.Errorf("initialize COM for elevation: %#x", result)
	}
	success, _, launchErr := procShellExecute.Call(uintptr(unsafe.Pointer(&info)))
	uninitialise.Call()
	runtime.UnlockOSThread()
	if success == 0 {
		if errors.Is(launchErr, windows.ERROR_CANCELLED) {
			return 0, errElevationDeclined
		}
		return 0, fmt.Errorf("launch elevated helper: %w", launchErr)
	}
	if info.process == 0 {
		return 0, errors.New("elevated helper returned no process handle")
	}
	defer windows.CloseHandle(info.process)
	event, err := windows.WaitForSingleObject(info.process, windows.INFINITE)
	if err != nil {
		return 0, fmt.Errorf("wait for elevated helper: %w", err)
	}
	if event != windows.WAIT_OBJECT_0 {
		return 0, fmt.Errorf("unexpected wait status for elevated helper: %d", event)
	}
	var code uint32
	if err := windows.GetExitCodeProcess(info.process, &code); err != nil {
		return 0, err
	}
	return code, nil
}

// elevateForSystemAction re-launches the executable elevated with the given
// action verb (UAC prompt) and waits for the helper's completion and exit status.
func elevateForSystemAction(_ string, action string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to resolve the executable: %w", err)
	}
	args := []string{"daemon", "system-action", action}
	var errFile string
	if f, err := os.CreateTemp("", "xbond-system-action-*.err"); err == nil {
		errFile = f.Name()
		_ = f.Close()
		defer os.Remove(errFile)
		args = append(args, errFile)
	}
	code, err := runElevatedWindowsCommand(exe, args)
	if err != nil {
		if errors.Is(err, errElevationDeclined) {
			return errors.New("elevation was declined; nothing changed")
		}
		return err
	}
	if code != 0 {
		if errFile != "" {
			if raw, readErr := os.ReadFile(errFile); readErr == nil {
				if msg := strings.TrimSpace(string(raw)); msg != "" {
					return errors.New(msg)
				}
			}
		}
		return fmt.Errorf("elevated system action %q failed (exit %d)", action, code)
	}
	return nil
}

func installSystem(exePath string) error {
	if ok, err := isElevated(); err != nil || !ok {
		return elevateForSystemAction(exePath, "system-install")
	}
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("failed to connect to the service manager: %w", err)
	}
	defer m.Disconnect()

	dir, err := machineWindowsDirectory()
	if err != nil {
		return fmt.Errorf("resolve Program Files: %w", err)
	}
	if existing, err := m.OpenService(systemServiceName); err == nil {
		defer existing.Close()
		cfg, err := existing.Config()
		if err != nil {
			return err
		}
		fixed, err := isFixedWindowsMachineCommand(cfg.BinaryPathName, filepath.Join(dir, "xbond.exe"))
		if err != nil {
			return err
		}
		if !fixed {
			return errors.New("the existing machine service uses a different executable; remove its registration before installing this version")
		}
		// A reinstall against an existing registration is also the upgrade
		// path for its SCM config: converge delayed auto-start to immediate
		// auto-start, otherwise the boot window that broke TUN survives
		// every reinstall.
		if cfg.StartType != mgr.StartAutomatic || cfg.DelayedAutoStart {
			cfg.StartType = mgr.StartAutomatic
			cfg.DelayedAutoStart = false
			if err := existing.UpdateConfig(cfg); err != nil {
				return fmt.Errorf("failed to fix the machine service start type: %w", err)
			}
		}
		status, err := existing.Query()
		if err != nil {
			return err
		}
		if status.State == svc.Running || status.State == svc.StartPending {
			return nil
		}
		return existing.Start()
	} else if !errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		return err
	}
	if err := ensureMachineDirectory(dir, machinePublicDirACL); err != nil {
		return err
	}
	releaseLock, err := upgrade.Lock(dir)
	if err != nil {
		return err
	}
	defer releaseLock()
	if existing, err := m.OpenService(systemServiceName); err == nil {
		existing.Close()
		return errors.New("the machine service was registered concurrently")
	} else if !errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		return err
	}
	binary, stateDir, err := installWindowsMachineFiles(exePath, dir)
	if err != nil {
		return fmt.Errorf("install the protected machine binary: %w", err)
	}
	if err := writeDelegationGrant(stateDir); err != nil {
		return fmt.Errorf("write the delegation grant: %w", err)
	}
	svc, err := m.CreateService(
		systemServiceName,
		binary,
		mgr.Config{
			DisplayName: systemServiceDisplay,
			Description: "XBond daemon in the machine session: TUN takeover that survives logout. Managed by the per-user xbond CLI.",
			StartType:   mgr.StartAutomatic,
		},
		// Arguments ride binPath: a fixed loopback listen, the machine data
		// dir (the LocalSystem profile has none), and service-run selecting
		// the SCM lifecycle.
		machineWindowsArguments(stateDir)...,
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
	// Installing does not start anything; bring the daemon up right away so
	// install matches the user-scope behavior.
	if err := svc.Start(); err != nil {
		return errors.Join(err, svc.Delete())
	}
	return nil
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

func uninstallSystem(exePath string) error {
	// Probe the registration before touching elevation: uninstalling a
	// machine service that was never installed must stay a no-op instead of
	// spending a UAC prompt on it. The query needs only CONNECT +
	// QUERY_STATUS, which unprivileged callers hold.
	if _, err := querySystem(); err != nil {
		if errors.Is(err, ErrServiceNotInstalled) {
			return nil
		}
		return err
	}
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
		if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
			return nil
		}
		return err
	}
	defer handle.Close()
	if err := stopSystemInstalled(handle); err != nil {
		return err
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
	if err := svc.Start(); err != nil && !errors.Is(err, windows.ERROR_SERVICE_ALREADY_RUNNING) {
		return err
	}
	return nil
}

func stopSystem() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("failed to connect to the service manager: %w", err)
	}
	defer m.Disconnect()
	handle, err := m.OpenService(systemServiceName)
	if err != nil {
		if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
			return nil
		}
		return err
	}
	defer handle.Close()
	return stopSystemInstalled(handle)
}

func stopSystemInstalled(handle *mgr.Service) error {
	deadline := time.Now().Add(10 * time.Second)
	requested := false
	for {
		status, err := handle.Query()
		if err != nil {
			return err
		}
		switch status.State {
		case svc.Stopped:
			return nil
		case svc.StartPending, svc.StopPending:
			// Wait for a pending start before requesting a stop, or for
			// an in-flight stop to finish.
		default:
			if !requested {
				_, err := handle.Control(svc.Stop)
				if err != nil && !errors.Is(err, windows.ERROR_SERVICE_NOT_ACTIVE) {
					return err
				}
				requested = true
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("machine service did not stop (state: %d)", status.State)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// ErrServiceNotInstalled reports that the machine-scoped service is not registered in SCM.
var ErrServiceNotInstalled = errors.New("service is not installed")

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
		if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
			return 0, ErrServiceNotInstalled
		}
		return 0, fmt.Errorf("open machine service: %w", err)
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
		if errors.Is(err, ErrServiceNotInstalled) {
			return "not installed", nil
		}
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
