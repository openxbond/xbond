package daemon

// TUNCapability reports whether this daemon process can actually create a
// TUN adapter, and why not when it cannot. TUN failures are swallowed by the
// cores just like bind errors, so the daemon gates TUN takeover on this
// before deriving or touching the running core (daemon-runtime spec: 权限
// 不足明确报错，不静默降级).
type TUNCapability struct {
	Tun      bool   `json:"tun"`
	// ReasonCode is machine-readable for localization: "not_elevated"
	// (Windows), "not_root" (unix) or "wintun_missing".
	ReasonCode string `json:"tunReasonCode,omitempty"`
	// Reason is the English detail for logs and doctor output.
	Reason string `json:"tunReason,omitempty"`
}
