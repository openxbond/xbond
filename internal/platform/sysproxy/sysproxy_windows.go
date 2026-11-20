//go:build windows

package sysproxy

import (
	"fmt"
	"runtime"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const internetSettingsKey = `Software\Microsoft\Windows\CurrentVersion\Internet Settings`

const (
	internetOptionRefresh             = 37
	internetOptionSettingsChanged     = 39
	internetOptionPerConnectionOption = 75

	internetPerConnFlags       = 1
	internetPerConnProxyServer = 2
	internetPerConnProxyBypass = 3

	proxyTypeDirect = 1
	proxyTypeProxy  = 2
)

var (
	wininet                = windows.NewLazySystemDLL("wininet.dll")
	procInternetSetOptionW = wininet.NewProc("InternetSetOptionW")
)

type internetPerConnOption struct {
	option uint32
	value  uintptr
}

type internetPerConnOptionList struct {
	size        uint32
	connection  *uint16
	optionCount uint32
	optionError uint32
	options     *internetPerConnOption
}

func Get() (Snapshot, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsKey, registry.QUERY_VALUE)
	if err != nil {
		return Snapshot{}, fmt.Errorf("failed to open registry key: %w", err)
	}
	defer k.Close()

	enable, _, err := k.GetIntegerValue("ProxyEnable")
	if err != nil {
		enable = 0
	}

	server, _, err := k.GetStringValue("ProxyServer")
	if err != nil {
		server = ""
	}

	bypass, _, err := k.GetStringValue("ProxyOverride")
	if err != nil {
		bypass = ""
	}

	return Snapshot{
		Enabled:   enable == 1,
		Server:    server,
		Bypass:    bypass,
		Timestamp: time.Now().Unix(),
	}, nil
}

// DefaultBypass is the exception list applied on takeover. ProxyOverride
// matches by wildcard, not CIDR, so the 172.16/12 range has to be spelled
// out per second octet; <local> keeps dotless hostnames off the proxy. The
// client's own control plane — the UI reaching an external controller on
// the LAN — must stay reachable with any rule set.
func DefaultBypass() string {
	entries := []string{"localhost", "127.*", "<local>"}
	for second := 16; second <= 31; second++ {
		entries = append(entries, fmt.Sprintf("172.%d.*", second))
	}
	entries = append(entries, "10.*", "192.168.*")
	return strings.Join(entries, ";")
}

func Set(server string, bypass string) error {
	current, err := Get()
	if err != nil {
		return err
	}
	if err := SaveSnapshot(current); err != nil {
		return err
	}
	if bypass == "" {
		bypass = DefaultBypass()
	}
	return Restore(Snapshot{Enabled: true, Server: server, Bypass: bypass})
}

func Restore(snapshot Snapshot) error {
	if err := applyWinINetPerConnection(snapshot.Enabled, snapshot.Server, snapshot.Bypass); err != nil {
		// Fall back to direct registry writes when WinINet per-connection API rejects,
		// and always enforce exact registry state (preserving disabled server/bypass).
		_ = err
	}

	k, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("failed to open registry key for writing: %w", err)
	}
	defer k.Close()

	if err := k.SetStringValue("ProxyServer", snapshot.Server); err != nil {
		return err
	}
	if err := k.SetStringValue("ProxyOverride", snapshot.Bypass); err != nil {
		return err
	}
	var enabled uint32
	if snapshot.Enabled {
		enabled = 1
	}
	if err := k.SetDWordValue("ProxyEnable", enabled); err != nil {
		return err
	}
	notifyWinINetChanged()
	return nil
}

func Disable() error {
	_ = applyWinINetPerConnection(false, "", "")

	k, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("failed to open registry key for writing: %w", err)
	}
	defer k.Close()

	if err := k.SetDWordValue("ProxyEnable", 0); err != nil {
		return err
	}
	notifyWinINetChanged()
	ClearSnapshot()
	return nil
}

func applyWinINetPerConnection(enabled bool, server, bypass string) error {
	flags := uintptr(proxyTypeDirect)
	if enabled {
		flags = proxyTypeProxy
	}
	options := make([]internetPerConnOption, 0, 3)
	options = append(options, internetPerConnOption{
		option: internetPerConnFlags,
		value:  flags,
	})
	var serverPtr, bypassPtr *uint16
	if server != "" {
		var err error
		serverPtr, err = windows.UTF16PtrFromString(server)
		if err != nil {
			return err
		}
		options = append(options, internetPerConnOption{
			option: internetPerConnProxyServer,
			value:  uintptr(unsafe.Pointer(serverPtr)),
		})
	}
	if bypass != "" {
		var err error
		bypassPtr, err = windows.UTF16PtrFromString(bypass)
		if err != nil {
			return err
		}
		options = append(options, internetPerConnOption{
			option: internetPerConnProxyBypass,
			value:  uintptr(unsafe.Pointer(bypassPtr)),
		})
	}
	list := internetPerConnOptionList{
		size:        uint32(unsafe.Sizeof(internetPerConnOptionList{})),
		optionCount: uint32(len(options)),
		options:     &options[0],
	}
	r1, _, err := procInternetSetOptionW.Call(
		0,
		internetOptionPerConnectionOption,
		uintptr(unsafe.Pointer(&list)),
		uintptr(unsafe.Sizeof(list)),
	)
	runtime.KeepAlive(serverPtr)
	runtime.KeepAlive(bypassPtr)
	runtime.KeepAlive(options)
	if r1 == 0 {
		return fmt.Errorf("InternetSetOptionW per-connection failed: %w", err)
	}
	return nil
}

func notifyWinINetChanged() {
	_, _, _ = procInternetSetOptionW.Call(0, internetOptionSettingsChanged, 0, 0)
	_, _, _ = procInternetSetOptionW.Call(0, internetOptionRefresh, 0, 0)
}
