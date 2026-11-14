package engine

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"unsafe"

	"github.com/sagernet/sing-box/adapter"
	C "github.com/sagernet/sing-box/constant"
	"github.com/sagernet/sing-box/option"
	"github.com/sagernet/sing-tun"
	"github.com/sagernet/sing/common/control"
	"github.com/sagernet/sing/common/logger"
	"github.com/sagernet/sing/common/x/list"
	"golang.org/x/net/http2"
)

// sing-box v1.13.21's transport/v2rayhttp/force_close.go links against
// golang.org/x/net/http2.(*Transport).connPool via go:linkname. In x/net
// >= v0.61 that two-line helper is inlined into RoundTrip and deadcode-stripped
// by the linker because it has no provider-side go:linkname. Providing the
// symbol here satisfies the relocation without vendoring or overlaying sing-box.
//
//go:linkname http2TransportConnPool golang.org/x/net/http2.(*Transport).connPool
func http2TransportConnPool(t *http2.Transport) http2.ClientConnPool {
	if t != nil {
		if t.ConnPool != nil {
			return t.ConnPool
		}
		v := reflect.ValueOf(t).Elem().FieldByName("connPoolOrDef")
		if v.IsValid() && !v.IsNil() {
			pool, _ := reflect.NewAt(v.Type(), unsafe.Pointer(v.UnsafeAddr())).Elem().Interface().(http2.ClientConnPool)
			if pool != nil {
				return pool
			}
		}
	}
	return &emptyHTTP2ClientConnPool{t: t}
}

type emptyHTTP2ClientConnPool struct {
	t     *http2.Transport
	mu    sync.Mutex
	conns map[string][]*http2.ClientConn
}

func (*emptyHTTP2ClientConnPool) GetClientConn(*http.Request, string) (*http2.ClientConn, error) {
	return nil, os.ErrClosed
}

func (*emptyHTTP2ClientConnPool) MarkDead(*http2.ClientConn) {}

// mobileTunFD carries the platform VPN file descriptor for the sing-box core.
// The desktop TUN path opens its own device, so it stays zero there.
var mobileTunFD atomic.Int32

var mobileSocketProtector atomic.Pointer[func(int) error]

// SetMobileTunFD registers the platform VPN fd the sing-box TUN inbound
// should adopt through adapter.PlatformInterface.OpenInterface. Register
// before starting or reloading the core; clear on stop.
func SetMobileTunFD(fd int32) {
	mobileTunFD.Store(fd)
}

// SetMobileSocketProtector registers the socket protection callback
// (e.g. VpnService.protect on Android).
func SetMobileSocketProtector(fn func(int) error) {
	if fn == nil {
		mobileSocketProtector.Store(nil)
	} else {
		mobileSocketProtector.Store(&fn)
	}
}

func applyMobileTunOptions(options *tun.Options) {
	if fd := mobileTunFD.Load(); fd > 0 && options.FileDescriptor == 0 {
		useMobileTunDescriptor(options, fd)
	}
}

// mobilePlatformInterface is sing-box's sanctioned mobile host adapter:
// OpenInterface adopts the platform VPN descriptor, and
// CreateDefaultInterfaceMonitor supplies an interface monitor so mobile
// builds never open raw netlink sockets or read /data/system/packages.xml
// (both SELinux-denied to untrusted Android apps).
type mobilePlatformInterface struct{}

var _ adapter.PlatformInterface = mobilePlatformInterface{}

func (mobilePlatformInterface) Initialize(nm adapter.NetworkManager) error {
	return nm.UpdateInterfaces()
}

func (mobilePlatformInterface) UsePlatformAutoDetectInterfaceControl() bool { return true }

func (mobilePlatformInterface) AutoDetectInterfaceControl(fd int) error {
	if fn := mobileSocketProtector.Load(); fn != nil {
		return (*fn)(fd)
	}
	return nil
}

func (mobilePlatformInterface) UsePlatformInterface() bool {
	return mobileTunFD.Load() > 0
}

func (mobilePlatformInterface) OpenInterface(options *tun.Options, _ option.TunPlatformOptions) (tun.Tun, error) {
	applyMobileTunOptions(options)
	return tun.New(*options)
}

func (mobilePlatformInterface) UsePlatformDefaultInterfaceMonitor() bool { return true }

func (mobilePlatformInterface) CreateDefaultInterfaceMonitor(logger.Logger) tun.DefaultInterfaceMonitor {
	return &mobileInterfaceMonitor{}
}

func (mobilePlatformInterface) UsePlatformNetworkInterfaces() bool { return true }

// enumerateSystemInterfaces is the seam the regression test overrides; the
// Android 14+ netlink RTM_GETLINK restriction makes net.Interfaces come back
// empty or fail on real devices, which Waydroid (Android 13) never shows.
var enumerateSystemInterfaces = net.Interfaces

// The platform network snapshot (Android ConnectivityManager, pushed by the
// mobile host through SetMobileNetworkInterfacesJSON) and the shared default
// interface registry behind every mobileInterfaceMonitor instance. When the
// snapshot is absent — iOS, desktop, or before the first push — enumeration
// falls back to net.Interfaces.
var (
	mobileNetworksJSON     atomic.Pointer[string]
	mobileDefaultInterface atomic.Pointer[control.Interface]
	mobileMonitorMu        sync.Mutex
	mobileMonitorCallbacks list.List[tun.DefaultInterfaceUpdateCallback]
)

func sameInterface(a, b *control.Interface) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Index == b.Index && a.Name == b.Name
}

// SetMobileNetworkInterfacesJSON installs a platform network snapshot: a JSON
// array of {name,index,mtu,addresses,flags,default,type,dns,metered} objects.
// The payload must parse; an invalid one is rejected so a bad host push can
// never blank the interface table mid-run. The default-interface monitor
// fires whenever the stored default changes.
func SetMobileNetworkInterfacesJSON(payload string) error {
	def, err := defaultFromMobileNetworksJSON(payload)
	if err != nil {
		return err
	}
	mobileNetworksJSON.Store(&payload)
	if old := mobileDefaultInterface.Swap(def); !sameInterface(old, def) {
		notifyMobileDefaultInterface(def)
	}
	return nil
}

func notifyMobileDefaultInterface(def *control.Interface) {
	mobileMonitorMu.Lock()
	defer mobileMonitorMu.Unlock()
	for it := mobileMonitorCallbacks.Front(); it != nil; it = it.Next() {
		it.Value(def, 0)
	}
}

func (mobilePlatformInterface) NetworkInterfaces() ([]adapter.NetworkInterface, error) {
	// An empty table must not fail the core: socket binding on Android goes
	// through AutoDetectInterfaceControl (the platform socket protector), not
	// the interface table, and the subscription validation gate only builds
	// the instance before closing it. Failing here surfaced to users as
	// "initialize platform interface: file does not exist" on real devices.
	ifaces, _ := getMobileNetworkInterfaces()
	return ifaces, nil
}

func (mobilePlatformInterface) UnderNetworkExtension() bool { return false }

func (mobilePlatformInterface) NetworkExtensionIncludeAllNetworks() bool { return false }

func (mobilePlatformInterface) ClearDNSCache() {}

func (mobilePlatformInterface) RequestPermissionForWIFIState() error { return nil }

func (mobilePlatformInterface) ReadWIFIState() adapter.WIFIState { return adapter.WIFIState{} }

func (mobilePlatformInterface) SystemCertificates() []string { return nil }

func (mobilePlatformInterface) UsePlatformConnectionOwnerFinder() bool { return false }

func (mobilePlatformInterface) FindConnectionOwner(*adapter.FindConnectionOwnerRequest) (*adapter.ConnectionOwner, error) {
	return nil, os.ErrInvalid
}

func (mobilePlatformInterface) UsePlatformWIFIMonitor() bool { return false }

func (mobilePlatformInterface) UsePlatformNotification() bool { return false }

func (mobilePlatformInterface) SendNotification(*adapter.Notification) error { return nil }

func (mobilePlatformInterface) MyInterfaceAddress() []netip.Addr { return nil }

type mobileInterfaceMonitor struct{}

func (m *mobileInterfaceMonitor) Start() error {
	def := mobileDefaultInterface.Load()
	mobileMonitorMu.Lock()
	defer mobileMonitorMu.Unlock()
	for it := mobileMonitorCallbacks.Front(); it != nil; it = it.Next() {
		it.Value(def, 0)
	}
	return nil
}

func (m *mobileInterfaceMonitor) Close() error { return nil }

func (m *mobileInterfaceMonitor) DefaultInterface() *control.Interface {
	return mobileDefaultInterface.Load()
}

func (m *mobileInterfaceMonitor) OverrideAndroidVPN() bool { return false }

func (m *mobileInterfaceMonitor) AndroidVPNEnabled() bool { return false }

func (m *mobileInterfaceMonitor) RegisterCallback(callback tun.DefaultInterfaceUpdateCallback) *list.Element[tun.DefaultInterfaceUpdateCallback] {
	mobileMonitorMu.Lock()
	defer mobileMonitorMu.Unlock()
	return mobileMonitorCallbacks.PushBack(callback)
}

func (m *mobileInterfaceMonitor) UnregisterCallback(element *list.Element[tun.DefaultInterfaceUpdateCallback]) {
	mobileMonitorMu.Lock()
	defer mobileMonitorMu.Unlock()
	mobileMonitorCallbacks.Remove(element)
}

func (m *mobileInterfaceMonitor) RegisterMyInterface(string) {}

func (m *mobileInterfaceMonitor) MyInterfaces() []string {
	return []string{"tun0"}
}

func getMobileNetworkInterfaces() ([]adapter.NetworkInterface, *control.Interface) {
	if payload := mobileNetworksJSON.Load(); payload != nil {
		return parseMobileNetworksJSON(*payload)
	}
	return enumerateFallbackInterfaces()
}

func enumerateFallbackInterfaces() ([]adapter.NetworkInterface, *control.Interface) {
	ifaces, err := enumerateSystemInterfaces()
	if err != nil {
		return nil, nil
	}
	var (
		res       []adapter.NetworkInterface
		defaultIf *control.Interface
	)
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		name := iface.Name
		if strings.HasPrefix(name, "tun") || strings.HasPrefix(name, "dummy") {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		var prefixes []netip.Prefix
		for _, addr := range addrs {
			var ip net.IP
			var mask net.IPMask
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
				mask = v.Mask
			case *net.IPAddr:
				ip = v.IP
				mask = ip.DefaultMask()
			}
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			ones, bits := mask.Size()
			if bits == 0 {
				continue
			}
			addrIP, ok := netip.AddrFromSlice(ip)
			if !ok {
				continue
			}
			addrIP = addrIP.Unmap()
			prefixes = append(prefixes, netip.PrefixFrom(addrIP, ones))
		}
		if len(prefixes) == 0 {
			continue
		}

		cIf := control.Interface{
			Index:        iface.Index,
			MTU:          iface.MTU,
			Name:         iface.Name,
			HardwareAddr: iface.HardwareAddr,
			Flags:        iface.Flags,
			Addresses:    prefixes,
		}

		ifType := C.InterfaceTypeEthernet
		lower := strings.ToLower(iface.Name)
		if strings.HasPrefix(lower, "wl") || strings.Contains(lower, "wifi") {
			ifType = C.InterfaceTypeWIFI
		} else if strings.HasPrefix(lower, "rmnet") || strings.HasPrefix(lower, "ccmni") || strings.HasPrefix(lower, "pdp") {
			ifType = C.InterfaceTypeCellular
		}

		netIf := adapter.NetworkInterface{
			Interface: cIf,
			Type:      ifType,
		}
		res = append(res, netIf)

		if defaultIf == nil || (ifType == C.InterfaceTypeWIFI && defaultIf.Name != iface.Name) {
			cp := cIf
			defaultIf = &cp
		}
	}
	return res, defaultIf
}

// mobileNetworksJSONEntry mirrors the snapshot the mobile host pushes — see
// XbondPlugin.kt's ConnectivityManager enumerator.
type mobileNetworksJSONEntry struct {
	Name      string   `json:"name"`
	Index     int      `json:"index"`
	MTU       int      `json:"mtu"`
	Addresses []string `json:"addresses"`
	Flags     []string `json:"flags"`
	Default   bool     `json:"default"`
	Type      string   `json:"type"`
	DNS       []string `json:"dns"`
	Metered   bool     `json:"metered"`
}

func mobileInterfaceFlags(names []string) net.Flags {
	var flags net.Flags
	for _, name := range names {
		switch strings.ToLower(name) {
		case "up":
			flags |= net.FlagUp
		case "broadcast":
			flags |= net.FlagBroadcast
		case "loopback":
			flags |= net.FlagLoopback
		case "pointtopoint":
			flags |= net.FlagPointToPoint
		case "multicast":
			flags |= net.FlagMulticast
		case "running":
			flags |= net.FlagRunning
		}
	}
	return flags
}

func mobileInterfaceType(name string) C.InterfaceType {
	switch strings.ToLower(name) {
	case "wifi":
		return C.InterfaceTypeWIFI
	case "cellular":
		return C.InterfaceTypeCellular
	case "ethernet":
		return C.InterfaceTypeEthernet
	default:
		return C.InterfaceTypeOther
	}
}

// parseMobileNetworksJSON converts a platform snapshot into sing-box's
// interface table plus the default interface. Malformed entries are skipped;
// only a structurally invalid payload is an error, so Set... can reject it
// without clobbering the previous snapshot.
func parseMobileNetworksJSON(payload string) ([]adapter.NetworkInterface, *control.Interface) {
	var entries []mobileNetworksJSONEntry
	if err := json.Unmarshal([]byte(payload), &entries); err != nil {
		return nil, nil
	}
	var (
		res       []adapter.NetworkInterface
		defaultIf *control.Interface
	)
	for _, entry := range entries {
		if entry.Name == "" || entry.Index <= 0 {
			continue
		}
		// The host must exclude its own VPN, but skip tun-named entries here
		// as defense in depth: a fed-back tun default would loop the tunnel.
		if strings.HasPrefix(entry.Name, "tun") || strings.HasPrefix(entry.Name, "dummy") {
			continue
		}
		flags := mobileInterfaceFlags(entry.Flags)
		if flags&net.FlagUp == 0 {
			continue
		}
		var prefixes []netip.Prefix
		for _, addr := range entry.Addresses {
			prefix, err := netip.ParsePrefix(addr)
			if err != nil {
				continue
			}
			prefixes = append(prefixes, netip.PrefixFrom(prefix.Addr().Unmap(), prefix.Bits()))
		}
		cIf := control.Interface{
			Index:     entry.Index,
			MTU:       entry.MTU,
			Name:      entry.Name,
			Flags:     flags,
			Addresses: prefixes,
		}
		netIf := adapter.NetworkInterface{
			Interface:  cIf,
			Type:       mobileInterfaceType(entry.Type),
			DNSServers: entry.DNS,
			Expensive:  entry.Metered,
		}
		res = append(res, netIf)
		if entry.Default && defaultIf == nil {
			cp := cIf
			defaultIf = &cp
		}
	}
	return res, defaultIf
}

func defaultFromMobileNetworksJSON(payload string) (*control.Interface, error) {
	var entries []mobileNetworksJSONEntry
	if err := json.Unmarshal([]byte(payload), &entries); err != nil {
		return nil, fmt.Errorf("invalid platform network snapshot: %w", err)
	}
	for _, entry := range entries {
		if entry.Default && entry.Name != "" && entry.Index > 0 {
			return &control.Interface{Index: entry.Index, Name: entry.Name}, nil
		}
	}
	return nil, nil
}
