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

// Windows keeps SE_*_AUTO_INHERITED on staged files even after a protected
// rewrite, so the machine-file validation must compare without it.
func TestStripAutoInheritControls(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"O:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;BU)", "O:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;BU)"},
		{"O:BAD:PAI(A;;FA;;;SY)", "O:BAD:P(A;;FA;;;SY)"},
		{"O:BAD:PAR(A;;FA;;;SY)", "O:BAD:P(A;;FA;;;SY)"},
		{"O:BAD:PAI", "O:BAD:P"},
		{"O:BAD:P", "O:BAD:P"},
		{"O:BAD:PAIS:SAI", "O:BAD:PS:S"},
		{"O:BAG:S-1-5-32-544D:P(A;OICI;FA;;;SY)", "O:BAG:S-1-5-32-544D:P(A;OICI;FA;;;SY)"},
	} {
		if got := stripAutoInheritControls(tc.in); got != tc.want {
			t.Errorf("stripAutoInheritControls(%q): got %q, want %q", tc.in, got, tc.want)
		}
	}
}
