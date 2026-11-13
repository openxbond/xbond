package engine

import (
	"errors"
	"net"
	"testing"

	"github.com/sagernet/sing-tun"
	"github.com/sagernet/sing/common/control"
)

// The mobile platform interface is the fd carrier for the sing-box mobile
// core: the platform handover must be adopted by fd-less inbound configs,
// ignored when nothing is registered (desktop) and never override an explicit fd.
func TestMobileTunFDHook(t *testing.T) {
	var platform mobilePlatformInterface

	SetMobileTunFD(43)
	if !platform.UsePlatformInterface() {
		t.Fatal("expected platform interface active when mobile tun fd is registered")
	}
	var adopted tun.Options
	applyMobileTunOptions(&adopted)
	if adopted.FileDescriptor != 43 {
		t.Fatalf("did not adopt the registered fd: %d", adopted.FileDescriptor)
	}

	SetMobileTunFD(0)
	if platform.UsePlatformInterface() {
		t.Fatal("expected platform interface inactive when no mobile tun fd is registered")
	}
	var idle tun.Options
	applyMobileTunOptions(&idle)
	if idle.FileDescriptor != 0 {
		t.Fatalf("adopted fd with none registered: %d", idle.FileDescriptor)
	}

	SetMobileTunFD(99)
	owned := tun.Options{FileDescriptor: 7}
	applyMobileTunOptions(&owned)
	if owned.FileDescriptor != 7 {
		t.Fatalf("overrode an explicit fd: %d", owned.FileDescriptor)
	}
	SetMobileTunFD(0)
}

func TestMobilePlatformInterface(t *testing.T) {
	var platform mobilePlatformInterface

	if !platform.UsePlatformAutoDetectInterfaceControl() {
		t.Fatal("expected UsePlatformAutoDetectInterfaceControl to be true")
	}

	var protectedFd int
	SetMobileSocketProtector(func(fd int) error {
		protectedFd = fd
		return nil
	})
	if err := platform.AutoDetectInterfaceControl(123); err != nil {
		t.Fatalf("unexpected error calling AutoDetectInterfaceControl: %v", err)
	}
	if protectedFd != 123 {
		t.Fatalf("expected protected fd 123, got %d", protectedFd)
	}
	SetMobileSocketProtector(nil)

	if !platform.UsePlatformNetworkInterfaces() {
		t.Fatal("expected UsePlatformNetworkInterfaces to be true")
	}

	monitor := platform.CreateDefaultInterfaceMonitor(nil)
	if monitor == nil {
		t.Fatal("expected non-nil default interface monitor")
	}
	myIfs := monitor.MyInterfaces()
	if len(myIfs) != 1 || myIfs[0] != "tun0" {
		t.Fatalf("expected [tun0], got %v", myIfs)
	}
}

// Android 14+ restricts netlink RTM_GETLINK, so net.Interfaces comes back
// empty or fails on real devices. The platform interface must report an
// empty table without an error there — os.ErrNotExist bubbled through
// sing-box as "initialize platform interface: file does not exist" and
// killed both the connection and the subscription validation gate
// (real-device report against v1.0.0; Waydroid's Android 13 never showed it).
func TestMobileNetworkInterfacesTolerateEmptyEnumeration(t *testing.T) {
	var platform mobilePlatformInterface

	original := enumerateSystemInterfaces
	defer func() { enumerateSystemInterfaces = original }()

	for name, stub := range map[string]func() ([]net.Interface, error){
		"restricted netlink": func() ([]net.Interface, error) { return nil, nil },
		"enumeration error":  func() ([]net.Interface, error) { return nil, errors.New("netlink read failed") },
	} {
		t.Run(name, func(t *testing.T) {
			enumerateSystemInterfaces = stub
			ifaces, err := platform.NetworkInterfaces()
			if err != nil {
				t.Fatalf("empty enumeration must not fail the platform interface: %v", err)
			}
			if len(ifaces) != 0 {
				t.Fatalf("expected no interfaces, got %d", len(ifaces))
			}
			if def := monitorDefaultInterface(platform); def != nil {
				t.Fatalf("expected nil default interface, got %+v", def)
			}
		})
	}
}

func monitorDefaultInterface(platform mobilePlatformInterface) *control.Interface {
	monitor := platform.CreateDefaultInterfaceMonitor(nil)
	type defaultGetter interface {
		DefaultInterface() *control.Interface
	}
	getter, ok := monitor.(defaultGetter)
	if !ok {
		return nil
	}
	return getter.DefaultInterface()
}
