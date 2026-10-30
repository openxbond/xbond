//go:build windows

package service

import (
	"testing"

	"golang.org/x/sys/windows"
)

func TestBackgroundCommandHidesConsole(t *testing.T) {
	exePath := `C:\Program Files\XBond\xbond.exe`
	cmd := backgroundCommand(exePath)
	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr is nil")
	}
	if cmd.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW == 0 {
		t.Fatalf("CREATE_NO_WINDOW missing: %#x", cmd.SysProcAttr.CreationFlags)
	}
	want := []string{exePath, "daemon", "--background"}
	if len(cmd.Args) != len(want) {
		t.Fatalf("args: got %q, want %q", cmd.Args, want)
	}
	for i := range want {
		if cmd.Args[i] != want[i] {
			t.Fatalf("args[%d]: got %q, want %q", i, cmd.Args[i], want[i])
		}
	}
}
