//go:build !ios && !windows

package engine

import (
	"testing"

	"github.com/sagernet/sing-tun"
	"golang.org/x/sys/unix"
)

// pipePlatformFD returns a real open descriptor standing in for the platform
// VPN fd, plus a closer for the test's own handle.
func pipePlatformFD(t *testing.T) (int32, func()) {
	t.Helper()
	var fds [2]int
	if err := unix.Pipe(fds[:]); err != nil {
		t.Fatalf("pipe: %v", err)
	}
	return int32(fds[0]), func() { _ = unix.Close(fds[0]) }
}

func fdOpen(fd int) bool {
	_, err := unix.FcntlInt(uintptr(fd), unix.F_GETFD, 0)
	return err == nil
}

// A core stop closes the descriptor it adopted (sing-tun wraps the number in
// an os.File); the platform fd must survive that so the next start — reload,
// rollback, restart after failure — still receives a live copy. Handing the
// raw platform fd to the core is exactly what turned a log-level reload into
// "SetNonblock(165) failed: bad file descriptor" on Android, killing the core
// behind a still-connected VPN interface.
func TestMobileTunFDAdoptionDuplicatesPlatformDescriptor(t *testing.T) {
	platformFD, closePlatform := pipePlatformFD(t)
	defer closePlatform()

	SetMobileTunFD(platformFD)
	defer SetMobileTunFD(0)

	release, err := prepareSingBoxDescriptor()
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	defer release()

	var adopted tun.Options
	applyMobileTunOptions(&adopted)
	if adopted.FileDescriptor == 0 {
		t.Fatal("did not adopt a descriptor")
	}
	if int32(adopted.FileDescriptor) == platformFD {
		t.Fatalf("adopted the raw platform fd %d; a core stop would close it", platformFD)
	}
	if !fdOpen(adopted.FileDescriptor) {
		t.Fatalf("adopted fd %d is not open", adopted.FileDescriptor)
	}

	// What a core stop does to its copy must not touch the platform fd.
	_ = unix.Close(adopted.FileDescriptor)
	if !fdOpen(int(platformFD)) {
		t.Fatalf("core-stop close killed the platform fd %d", platformFD)
	}
}

// Without a prepared copy nothing is adopted: falling back to the raw
// platform fd would silently reintroduce the stop-closes-fd bug on every
// start that forgets to prepare.
func TestMobileTunFDUnpreparedAdoptionRefused(t *testing.T) {
	platformFD, closePlatform := pipePlatformFD(t)
	defer closePlatform()

	SetMobileTunFD(platformFD)
	defer SetMobileTunFD(0)

	var adopted tun.Options
	applyMobileTunOptions(&adopted)
	if adopted.FileDescriptor != 0 {
		t.Fatalf("adopted the raw platform fd %d without prepare", adopted.FileDescriptor)
	}
}

// Releasing a prepared-but-unconsumed copy closes the dup and leaves the
// platform fd untouched.
func TestMobileTunFDDescriptorReleaseClosesUnusedCopy(t *testing.T) {
	platformFD, closePlatform := pipePlatformFD(t)
	defer closePlatform()

	SetMobileTunFD(platformFD)
	defer SetMobileTunFD(0)

	release, err := prepareSingBoxDescriptor()
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	release()

	var adopted tun.Options
	applyMobileTunOptions(&adopted)
	if adopted.FileDescriptor != 0 {
		t.Fatalf("released copy still pending: %d", adopted.FileDescriptor)
	}
	if !fdOpen(int(platformFD)) {
		t.Fatalf("release closed the platform fd %d", platformFD)
	}
}
