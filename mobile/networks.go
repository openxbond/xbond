package mobile

import "github.com/openxbond/xbond/internal/engine"

// SetPlatformNetworkInterfaces receives the platform's network snapshot — on
// Android the ConnectivityManager enumeration the host plugin pushes on
// registration and on every network change. The snapshot feeds sing-box's
// interface table and default-interface monitor: Android 14+ denies untrusted
// apps the netlink RTM_GETLINK that Go's net.Interfaces needs, so without
// this bridge configs using route.network_strategy dial into "no available
// network interface".
func SetPlatformNetworkInterfaces(payload string) error {
	return engine.SetMobileNetworkInterfacesJSON(payload)
}
