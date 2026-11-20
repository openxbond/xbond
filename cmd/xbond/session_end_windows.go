//go:build windows

package main

import (
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	wmClose           = 0x0010
	wmQueryEndSession = 0x0011
	wmEndSession      = 0x0016
	wmDestroy         = 0x0002
)

var (
	user32               = windows.NewLazySystemDLL("user32.dll")
	procRegisterClassExW = user32.NewProc("RegisterClassExW")
	procCreateWindowExW  = user32.NewProc("CreateWindowExW")
	procDefWindowProcW   = user32.NewProc("DefWindowProcW")
	procGetMessageW      = user32.NewProc("GetMessageW")
	procTranslateMessage = user32.NewProc("TranslateMessage")
	procDispatchMessageW = user32.NewProc("DispatchMessageW")
	procPostMessageW     = user32.NewProc("PostMessageW")
	procDestroyWindow    = user32.NewProc("DestroyWindow")
	procPostQuitMessage  = user32.NewProc("PostQuitMessage")
)

type wndClassExW struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     windows.Handle
	hIcon         windows.Handle
	hCursor       windows.Handle
	hbrBackground windows.Handle
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       windows.Handle
}

type winMSG struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      struct{ x, y int32 }
}

type sessionEndState struct {
	triggerOnce sync.Once
	triggerCh   chan struct{}
	doneCh      chan struct{}
}

var (
	activeSessionEnd atomic.Pointer[sessionEndState]
	sessionWndProc   = syscall.NewCallback(func(hwnd, msg, wParam, lParam uintptr) uintptr {
		switch msg {
		case wmQueryEndSession:
			return 1
		case wmEndSession:
			if wParam != 0 {
				if st := activeSessionEnd.Load(); st != nil {
					st.triggerOnce.Do(func() { close(st.triggerCh) })
					select {
					case <-st.doneCh:
					case <-time.After(4 * time.Second):
					}
				}
			}
			return 0
		case wmClose:
			_, _, _ = procDestroyWindow.Call(hwnd)
			return 0
		case wmDestroy:
			_, _, _ = procPostQuitMessage.Call(0)
			return 0
		}
		r1, _, _ := procDefWindowProcW.Call(hwnd, msg, wParam, lParam)
		return r1
	})
)

// watchSessionEnd creates a hidden top-level window on Windows so a
// CREATE_NO_WINDOW user-session daemon receives WM_QUERYENDSESSION /
// WM_ENDSESSION on user logoff or shutdown and restores the system proxy
// before the OS terminates the session.
func watchSessionEnd() (trigger <-chan struct{}, markDone func()) {
	st := &sessionEndState{
		triggerCh: make(chan struct{}),
		doneCh:    make(chan struct{}),
	}
	activeSessionEnd.Store(st)

	var hwndAtomic atomic.Uintptr
	ready := make(chan struct{})
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		var mod windows.Handle
		_ = windows.GetModuleHandleEx(0, nil, &mod)
		className, err := windows.UTF16PtrFromString("XBondDaemonSessionWatcher")
		if err != nil {
			close(ready)
			return
		}
		cls := wndClassExW{
			cbSize:        uint32(unsafe.Sizeof(wndClassExW{})),
			lpfnWndProc:   sessionWndProc,
			hInstance:     mod,
			lpszClassName: className,
		}
		_, _, _ = procRegisterClassExW.Call(uintptr(unsafe.Pointer(&cls)))
		hwnd, _, _ := procCreateWindowExW.Call(
			0,
			uintptr(unsafe.Pointer(className)),
			uintptr(unsafe.Pointer(className)),
			0, // invisible top-level window (HWND_MESSAGE does not receive session broadcasts)
			0, 0, 0, 0,
			0, 0, uintptr(mod), 0,
		)
		hwndAtomic.Store(hwnd)
		close(ready)
		if hwnd == 0 {
			return
		}

		var msg winMSG
		for {
			r1, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
			if int32(r1) <= 0 {
				break
			}
			_, _, _ = procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
			_, _, _ = procDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
		}
	}()
	<-ready

	var closeOnce sync.Once
	return st.triggerCh, func() {
		closeOnce.Do(func() {
			close(st.doneCh)
			activeSessionEnd.CompareAndSwap(st, nil)
			if hwnd := hwndAtomic.Load(); hwnd != 0 {
				_, _, _ = procPostMessageW.Call(hwnd, wmClose, 0, 0)
			}
		})
	}
}
