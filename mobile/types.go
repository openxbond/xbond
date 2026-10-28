package mobile

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
}

// StatusListener receives log stream and diagnosis messages.
type StatusListener interface {
	OnLog(level string, message string)
}
