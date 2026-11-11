package engine

import (
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

func (mobilePlatformInterface) NetworkInterfaces() ([]adapter.NetworkInterface, error) {
	ifaces, _ := getMobileNetworkInterfaces()
	if len(ifaces) == 0 {
		return nil, os.ErrNotExist
	}
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

type mobileInterfaceMonitor struct {
	mu        sync.Mutex
	callbacks list.List[tun.DefaultInterfaceUpdateCallback]
}

func (m *mobileInterfaceMonitor) Start() error {
	_, def := getMobileNetworkInterfaces()
	m.mu.Lock()
	defer m.mu.Unlock()
	for it := m.callbacks.Front(); it != nil; it = it.Next() {
		it.Value(def, 0)
	}
	return nil
}

func (m *mobileInterfaceMonitor) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.callbacks.Init()
	return nil
}

func (m *mobileInterfaceMonitor) DefaultInterface() *control.Interface {
	_, def := getMobileNetworkInterfaces()
	return def
}

func (m *mobileInterfaceMonitor) OverrideAndroidVPN() bool { return false }

func (m *mobileInterfaceMonitor) AndroidVPNEnabled() bool { return false }

func (m *mobileInterfaceMonitor) RegisterCallback(callback tun.DefaultInterfaceUpdateCallback) *list.Element[tun.DefaultInterfaceUpdateCallback] {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.callbacks.PushBack(callback)
}

func (m *mobileInterfaceMonitor) UnregisterCallback(element *list.Element[tun.DefaultInterfaceUpdateCallback]) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.callbacks.Remove(element)
}

func (m *mobileInterfaceMonitor) RegisterMyInterface(string) {}

func (m *mobileInterfaceMonitor) MyInterfaces() []string {
	return []string{"tun0"}
}

func getMobileNetworkInterfaces() ([]adapter.NetworkInterface, *control.Interface) {
	ifaces, err := net.Interfaces()
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
