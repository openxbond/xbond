//go:build windows

package service

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"

	"github.com/openxbond/xbond/internal/platform/wintun"
)

func systemInstalled() bool { return ServiceSystemInstalled() }

func systemStatus() (string, error) {
	return ServiceSystemState()
}

func uninstallSystemScope() error {
	exe, err := SelfPath()
	if err != nil {
		return err
	}
	return uninstallSystem(exe)
}

func startSystemScope(string) error {
	exe, err := SelfPath()
	if err != nil {
		return err
	}
	return SystemStart(exe)
}

func stopSystemScope(string) error {
	exe, err := SelfPath()
	if err != nil {
		return err
	}
	return SystemStop(exe)
}

// RunSystemService hosts the daemon under the service control manager. The
// run callback blocks serving the daemon and returns on stop; SCM stop and
// shutdown both close the stop channel.
func RunSystemService(listen, webDir string, run func(stop <-chan struct{}) error) error {
	if installation, err := machinePaths(); err == nil {
		if vanish, err := machineOwnerVanished(filepath.Dir(installation.Binary)); err != nil {
			fmt.Fprintf(os.Stderr, "xbond machine service: ownership probe failed: %v\n", err)
		} else if vanish {
			return reclaimWindowsOrphanedService()
		}
	}
	return svc.Run(systemServiceName, &systemHandler{listen: listen, webDir: webDir, run: run})
}

func reclaimWindowsOrphanedService() error {
	fmt.Fprintln(os.Stderr, "xbond machine service: the installing application is gone; reclaiming the machine registration")
	if m, err := mgr.Connect(); err == nil {
		defer m.Disconnect()
		if handle, err := m.OpenService(systemServiceName); err == nil {
			_ = handle.Delete()
			_ = handle.Close()
		}
	}
	if installation, err := machinePaths(); err == nil {
		dir := filepath.Dir(installation.Binary)
		for _, p := range []string{
			machineUpdaterSlot(dir, "a"),
			machineUpdaterSlot(dir, "b"),
			filepath.Join(dir, wintun.DLLName),
			filepath.Join(dir, updaterSlotFile),
			filepath.Join(dir, machineOwnerFile),
			filepath.Join(dir, machineOwnerPathFile),
			filepath.Join(dir, "upgrade.lock"),
		} {
			_ = os.Remove(p)
		}
		_ = os.RemoveAll(installation.DataDir)
		// The running executable image cannot be unlinked in-place on Windows;
		// schedule it for deletion on next reboot after DeleteService stops SCM respawn.
		if p16, err := windows.UTF16PtrFromString(installation.Binary); err == nil {
			_ = windows.MoveFileEx(p16, nil, windows.MOVEFILE_DELAY_UNTIL_REBOOT)
		}
		if d16, err := windows.UTF16PtrFromString(dir); err == nil {
			_ = windows.MoveFileEx(d16, nil, windows.MOVEFILE_DELAY_UNTIL_REBOOT)
		}
	}
	return nil
}

type systemHandler struct {
	listen string
	webDir string
	run    func(stop <-chan struct{}) error
}

func (h *systemHandler) Execute(args []string, req <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	stop := make(chan struct{})
	serveErr := make(chan error, 1)
	go func() { serveErr <- h.run(stop) }()
	changes <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case err := <-serveErr:
			if err != nil {
				return false, 1
			}
			return false, 0
		case c := <-req:
			switch c.Cmd {
			case svc.Interrogate:
				changes <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				changes <- svc.Status{State: svc.StopPending, WaitHint: 5_000}
				close(stop)
				if err := <-serveErr; err != nil {
					return false, 1
				}
				return false, 0
			}
		}
	}
}
