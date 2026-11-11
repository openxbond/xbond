package service

import (
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

func isMachineAdministrator() (bool, error) { return isElevated() }

// ShellExecuteEx gives the caller the elevated helper's completion result.
// ShellExecuteW, used by older service verbs, only reports that it launched.
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

func elevateMachineUpgrade(executable, origin, version string) error {
	args := []string{"daemon", "system-upgrade", origin, version}
	admin, err := isElevated()
	if err != nil {
		return err
	}
	if admin {
		out, err := exec.Command(executable, args...).CombinedOutput()
		if err != nil {
			return fmt.Errorf("machine upgrade: %w: %s", err, out)
		}
		return nil
	}

	verb, err := windows.UTF16PtrFromString("runas")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(executable)
	if err != nil {
		return err
	}
	parameters, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(args))
	if err != nil {
		return err
	}
	info := shellExecuteInfo{
		size:       uint32(unsafe.Sizeof(shellExecuteInfo{})),
		mask:       0x00000040 | 0x00000100 | 0x00000400, // NOCLOSEPROCESS, NOASYNC, FLAG_NO_UI
		verb:       verb,
		file:       file,
		parameters: parameters,
	}
	runtime.LockOSThread()
	ole := windows.NewLazySystemDLL("ole32.dll")
	initialise := ole.NewProc("CoInitializeEx")
	uninitialise := ole.NewProc("CoUninitialize")
	result, _, _ := initialise.Call(0, 0x2|0x4) // APARTMENTTHREADED | DISABLE_OLE1DDE
	if result != 0 && result != 1 {
		runtime.UnlockOSThread()
		return fmt.Errorf("initialize COM for machine upgrade: %#x", result)
	}
	execute := shell32.NewProc("ShellExecuteExW")
	success, _, launchErr := execute.Call(uintptr(unsafe.Pointer(&info)))
	uninitialise.Call()
	runtime.UnlockOSThread()
	if success == 0 {
		if errors.Is(launchErr, windows.ERROR_CANCELLED) {
			return errors.New("machine upgrade authorization was declined")
		}
		return fmt.Errorf("launch the elevated machine updater: %w", launchErr)
	}
	if info.process == 0 {
		return errors.New("the elevated machine updater returned no process handle")
	}
	defer windows.CloseHandle(info.process)
	if _, err := windows.WaitForSingleObject(info.process, windows.INFINITE); err != nil {
		return fmt.Errorf("wait for the machine updater: %w", err)
	}
	var code uint32
	if err := windows.GetExitCodeProcess(info.process, &code); err != nil {
		return err
	}
	if code != 0 {
		return fmt.Errorf("the elevated machine updater failed (exit %d)", code)
	}
	return nil
}
