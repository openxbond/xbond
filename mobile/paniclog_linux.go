//go:build linux

package mobile

import (
	"os"
	"path/filepath"
	"syscall"

	"github.com/openxbond/xbond/internal/platform/paths"
)

// redirectPanicLog points fd 2 at a file in the data dir: the Go runtime's
// crash trace would otherwise ride gomobile's logcat pipe, which dies with
// the aborting process and loses the stack. Truncated per start. No-op when
// the data dir is unavailable.
func redirectPanicLog() {
	f, err := os.OpenFile(
		filepath.Join(paths.DataDir(), "go-panic.log"),
		os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600,
	)
	if err != nil {
		return
	}
	syscall.Syscall(syscall.SYS_DUP3, uintptr(f.Fd()), 2, 0)
}
