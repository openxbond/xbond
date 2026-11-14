package engine

import (
	"errors"
	"net"
	"testing"

	C "github.com/sagernet/sing-box/constant"
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
	originalPayload := mobileNetworksJSON.Load()
	defer func() {
		enumerateSystemInterfaces = original
		mobileNetworksJSON.Store(originalPayload)
		if old := originalPayload; old != nil {
			_, def := parseMobileNetworksJSON(*old)
			mobileDefaultInterface.Store(def)
		} else {
			mobileDefaultInterface.Store(nil)
		}
	}()
	mobileNetworksJSON.Store(nil)
	mobileDefaultInterface.Store(nil)

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

// The platform snapshot must feed the interface table, drive the default
// interface the parallel dialer binds against, and reject invalid payloads
// without clobbering the previous snapshot.
func TestMobileNetworkInterfacesSnapshot(t *testing.T) {
	original := enumerateSystemInterfaces
	originalPayload := mobileNetworksJSON.Load()
	defer func() {
		enumerateSystemInterfaces = original
		mobileNetworksJSON.Store(originalPayload)
		if old := originalPayload; old != nil {
			_, def := parseMobileNetworksJSON(*old)
			mobileDefaultInterface.Store(def)
		} else {
			mobileDefaultInterface.Store(nil)
		}
	}()
	enumerateSystemInterfaces = func() ([]net.Interface, error) { return nil, nil }
	mobileNetworksJSON.Store(nil)
	mobileDefaultInterface.Store(nil)

	var platform mobilePlatformInterface

	// No snapshot yet: the net fallback returns an empty table without error.
	ifaces, err := platform.NetworkInterfaces()
	if err != nil || len(ifaces) != 0 {
		t.Fatalf("expected empty table without error, got %d ifaces, err=%v", len(ifaces), err)
	}

	snapshot := `[` +
		`{"name":"wlan0","index":12,"mtu":1500,"addresses":["192.168.1.5/24"],"flags":["up","running"],"default":true,"type":"wifi","dns":["192.168.1.1"],"metered":false},` +
		`{"name":"rmnet_data0","index":33,"mtu":1400,"addresses":["10.20.30.40/30"],"flags":["up","running"],"default":false,"type":"cellular","dns":["10.0.0.1"],"metered":true},` +
		`{"name":"tun0","index":44,"flags":["up"],"default":false,"type":"other"}` +
		`]`
	if err := SetMobileNetworkInterfacesJSON(snapshot); err != nil {
		t.Fatalf("snapshot rejected: %v", err)
	}

	ifaces, err = platform.NetworkInterfaces()
	if err != nil {
		t.Fatalf("unexpected error after snapshot: %v", err)
	}
	if len(ifaces) != 2 {
		t.Fatalf("expected the wlan and cellular entries (tun skipped), got %d: %+v", len(ifaces), ifaces)
	}
	if ifaces[0].Name != "wlan0" {
		t.Fatalf("unexpected first entry: %+v", ifaces[0])
	}
	if ifaces[0].Type != C.InterfaceTypeWIFI {
		t.Fatalf("expected wifi type, got %v", ifaces[0].Type)
	}
	if len(ifaces[0].DNSServers) != 1 || ifaces[0].DNSServers[0] != "192.168.1.1" {
		t.Fatalf("dns servers not carried: %+v", ifaces[0])
	}
	if !ifaces[1].Expensive {
		t.Fatalf("cellular entry should be expensive/metered: %+v", ifaces[1])
	}

	def := monitorDefaultInterface(platform)
	if def == nil || def.Name != "wlan0" || def.Index != 12 {
		t.Fatalf("expected wlan0 as default interface, got %+v", def)
	}

	// A snapshot without a default honestly clears it: the platform said
	// nothing is default right now, and keeping a stale default would point
	// the parallel dialer at a dead interface.
	if err := SetMobileNetworkInterfacesJSON(`[{"name":"wlan0","index":12,"flags":["up"],"default":false,"type":"wifi"}]`); err != nil {
		t.Fatalf("default-less snapshot rejected: %v", err)
	}
	if def := monitorDefaultInterface(platform); def != nil {
		t.Fatalf("default survived a default-less snapshot: %+v", def)
	}

	// An invalid payload is rejected, keeping the last good snapshot.
	if err := SetMobileNetworkInterfacesJSON(`{not-json`); err == nil {
		t.Fatal("expected invalid payload to be rejected")
	}
	ifaces, err = platform.NetworkInterfaces()
	if err != nil || len(ifaces) != 1 {
		t.Fatalf("invalid payload clobbered the table: %d ifaces, err=%v", len(ifaces), err)
	}

	// Callbacks registered on the monitor fire when the default changes.
	var notified *control.Interface
	callback := func(def *control.Interface, _ int) { notified = def }
	monitor := platform.CreateDefaultInterfaceMonitor(nil)
	element := monitor.RegisterCallback(callback)
	defer monitor.UnregisterCallback(element)
	if err := SetMobileNetworkInterfacesJSON(snapshot); err != nil {
		t.Fatalf("snapshot re-push rejected: %v", err)
	}
	if notified == nil || notified.Index != 12 {
		t.Fatalf("default-change callback not fired, got %+v", notified)
	}
}
