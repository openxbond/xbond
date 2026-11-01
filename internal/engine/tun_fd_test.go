package engine

import (
	"testing"

	boxtun "github.com/sagernet/sing-box/protocol/tun"
	"github.com/sagernet/sing-tun"
)

// The vendored tun hook is the fd carrier for the sing-box mobile core: the
// platform handover must be adopted by fd-less inbound configs, ignored when
// nothing is registered (desktop) and never override an explicit fd.
func TestMobileTunFDHook(t *testing.T) {
	if boxtun.HookBeforeCreatePlatformInterface == nil {
		t.Fatal("tun hook not installed")
	}

	SetMobileTunFD(43)
	var adopted tun.Options
	boxtun.HookBeforeCreatePlatformInterface(&adopted)
	if adopted.FileDescriptor != 43 {
		t.Fatalf("hook did not adopt the registered fd: %d", adopted.FileDescriptor)
	}

	SetMobileTunFD(0)
	var idle tun.Options
	boxtun.HookBeforeCreatePlatformInterface(&idle)
	if idle.FileDescriptor != 0 {
		t.Fatalf("hook fired with no fd registered: %d", idle.FileDescriptor)
	}

	SetMobileTunFD(99)
	owned := tun.Options{FileDescriptor: 7}
	boxtun.HookBeforeCreatePlatformInterface(&owned)
	if owned.FileDescriptor != 7 {
		t.Fatalf("hook overrode an explicit fd: %d", owned.FileDescriptor)
	}
	SetMobileTunFD(0)
}
