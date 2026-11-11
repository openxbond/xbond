//go:build windows

package service

import (
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestMachineCommandRequiresProtectedBinaryAndState(t *testing.T) {
	binary := `C:\Program Files\XBond Machine\xbond.exe`
	good := windows.ComposeCommandLine(append([]string{binary}, machineWindowsArguments(filepath.Join(filepath.Dir(binary), "state"))...))
	for _, tc := range []struct {
		command string
		want    bool
	}{
		{good, true},
		{windows.ComposeCommandLine(append([]string{`C:\Users\sample\Downloads\xbond.exe`}, machineWindowsArguments("state")...)), false},
		{windows.ComposeCommandLine(append([]string{binary}, machineWindowsArguments(`C:\Users\sample\state`)...)), false},
	} {
		got, err := isFixedWindowsMachineCommand(tc.command, binary)
		if err != nil || got != tc.want {
			t.Fatalf("registered command %q: got %v, %v, want %v", tc.command, got, err, tc.want)
		}
	}
}

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
