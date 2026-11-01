//go:build windows

package daemon

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/openxbond/xbond/internal/platform/wintun"
)

var (
	shell32                 = windows.NewLazySystemDLL("shell32.dll")
	procIsUserAnAdmin       = shell32.NewProc("IsUserAnAdmin")
	kernel32                = windows.NewLazySystemDLL("kernel32.dll")
	procGetSystemDirectoryW = kernel32.NewProc("GetSystemDirectoryW")
)

// tunCapability gates TUN takeover on two Windows realities: the process
// needs an elevated token to open the wintun adapter, and the wintun driver
// DLL must be findable — the executable's directory or System32.
func tunCapability() TUNCapability {
	elevated, err := isElevated()
	if err != nil {
		return TUNCapability{
			ReasonCode: "not_elevated",
			Reason:     fmt.Sprintf("could not determine elevation: %v", err),
		}
	}
	if !elevated {
		return TUNCapability{
			ReasonCode: "not_elevated",
			Reason:     "TUN takeover requires administrator privileges; restart the daemon as Administrator",
		}
	}
	// The packaged DLL ships inside the binary: extract beside the
	// executable before reporting it missing.
	if !wintun.EnsureLocal() {
		return TUNCapability{
			ReasonCode: "wintun_missing",
			Reason:     "wintun.dll could not be extracted next to the executable and was not found in System32",
		}
	}
	return TUNCapability{Tun: true}
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

func wintunDLLPresent() bool {
	exe, err := os.Executable()
	if err == nil {
		if _, err := os.Stat(filepath.Join(filepath.Dir(exe), "wintun.dll")); err == nil {
			return true
		}
	}
	// GetSystemDirectoryW avoids trusting a redirected SYSWOW64 view.
	buf := make([]uint16, syscall.MAX_PATH)
	n, _, _ := procGetSystemDirectoryW.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n == 0 || int(n) > len(buf) {
		return false
	}
	system32 := windows.UTF16ToString(buf[:n])
	_, err = os.Stat(filepath.Join(system32, "wintun.dll"))
	return err == nil
}
