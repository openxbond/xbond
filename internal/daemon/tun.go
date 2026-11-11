package daemon

// TUNCapability reports whether this daemon process can actually run a TUN
// takeover, and why not when it cannot. TUN failures are swallowed by the
// cores just like bind errors, so the daemon gates TUN takeover on this
// before deriving or touching the running core (daemon-runtime spec: 权限
// 不足明确报错，不静默降级).
type TUNCapability struct {
	Tun bool `json:"tun"`
	// ReasonCode is machine-readable for localization: "not_elevated"
	// (Windows), "not_root" (unix), "wintun_missing" or
	// "service_unreachable" (installed but the machine session is down).
	ReasonCode string `json:"tunReasonCode,omitempty"`
	// Reason is the English detail for logs and doctor output.
	Reason string `json:"tunReason,omitempty"`
	// ServiceInstalled reports whether a system-level background service is registered.
	ServiceInstalled bool `json:"serviceInstalled"`
	// Delegated marks the path the takeover would take: true means the
	// machine-scoped daemon runs the adapter, false means this process is
	// elevated enough to run it itself.
	Delegated bool `json:"delegated"`
}
