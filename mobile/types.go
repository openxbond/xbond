package mobile

import "runtime"

const iosWebOrigin = runtime.GOOS == "ios"

const (
	StateIdle          int32 = 0
	StateConnecting    int32 = 1
	StateConnected     int32 = 2
	StateDisconnecting int32 = 3
	StateError         int32 = 4
)

// PlatformBridge represents native callbacks provided by Android VpnService or iOS NEPacketTunnelProvider.
// Restricted to gomobile-compatible types (basic types, error).
type PlatformBridge interface {
	ProtectSocket(fd int32) error
	OnStateChanged(state int32, message string)
	OnTraffic(uploadBytes int64, downloadBytes int64)
	// DataDir is the app-private writable directory (Android filesDir, iOS
	// container). Android processes have no HOME/XDG env, so the desktop
	// DataDir resolution lands on an unwritable path — the platform owns
	// this answer.
	DataDir() string
	// OpenURL opens a URL in the platform browser (account OAuth). Error
	// when no browser/handler is available.
	OpenURL(url string) error
	// RequestConnect establishes the platform VPN and hands the fd to
	// StartActive — the LocalAPI /up path. Synchronous: returns after the
	// tunnel is up, or with an error (consent required counts as one).
	RequestConnect() error
	// RequestDisconnect tears the platform VPN down; the core stops on the
	// way. Synchronous: returns after the tunnel is down.
	RequestDisconnect() error
}

// StatusListener receives log stream and diagnosis messages.
type StatusListener interface {
	OnLog(level string, message string)
}
