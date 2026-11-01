package mobile

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/sub"
)

type TunnelService struct {
	mu           sync.RWMutex
	platform     PlatformBridge
	listener     StatusListener
	state        int32
	manager      *engine.Manager
	clashClient  *engine.ClashClient
	clashPort    int
	clashSecret  string
	subMgr       *sub.Manager
	stopTicker   chan struct{}
	lastUpload   int64
	lastDownload int64
	// activeTunFd is the descriptor the platform handed over at Start. It
	// stays valid across Reloads — only Stop returns it to the platform.
	activeTunFd int32
}

func NewTunnelService(platform PlatformBridge, listener StatusListener) *TunnelService {
	if platform != nil {
		if dir := platform.DataDir(); dir != "" {
			// Must precede any paths/sub call: everything resolves through
			// this. Android processes have no HOME/XDG env.
			_ = os.Setenv("XBOND_DATA_DIR", dir)
		}
	}
	initErr := paths.EnsureDirs()
	subMgr, mgrErr := sub.NewManager()
	if subMgr != nil && initErr == nil && mgrErr == nil {
		subMgr.MigrateLegacySources()
	}
	// A failed store init leaves subMgr nil; UpdateSubscription surfaces it
	// and the tunnel itself (config-driven) still works.
	return &TunnelService{
		platform: platform,
		listener: listener,
		state:    StateIdle,
		subMgr:   subMgr,
	}
}

func (s *TunnelService) GetState() int32 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state
}

func (s *TunnelService) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state == StateConnected && s.manager != nil && s.manager.IsRunning()
}

func (s *TunnelService) setState(state int32, message string) {
	s.mu.Lock()
	s.state = state
	platform := s.platform
	s.mu.Unlock()

	if platform != nil {
		platform.OnStateChanged(state, message)
	}
	if s.listener != nil && message != "" {
		s.listener.OnLog("info", message)
	}
}

func getFreeLoopbackPort() int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 19090
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func randomSecret() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *TunnelService) Start(configJSON string, tunFd int32) error {
	s.mu.Lock()
	if s.state == StateConnected || s.state == StateConnecting {
		s.mu.Unlock()
		return errors.New("VPN service is already running")
	}
	s.mu.Unlock()

	if tunFd <= 0 {
		s.setState(StateError, "invalid TUN file descriptor")
		return fmt.Errorf("invalid TUN file descriptor: %d", tunFd)
	}

	if len(configJSON) == 0 {
		s.setState(StateError, "empty configuration")
		return errors.New("empty configuration")
	}

	// Capture the Go runtime's crash output in a file: gomobile's logcat
	// forwarder loses the stack when the abort kills the pipe reader, which
	// made emulator crashes undebuggable. Truncated per start (linux only).
	redirectPanicLog()

	s.setState(StateConnecting, "Starting VPN tunnel...")

	clashPort := getFreeLoopbackPort()
	clashSecret := randomSecret()

	// The sing-box core adopts the VPN fd through the vendored tun hook at
	// device-open time; the clash core takes it from the derived config.
	// Cleared on Stop so a stale fd is never adopted after VPN restarts.
	engine.SetMobileTunFD(tunFd)

	derivedConfig, err := engine.DeriveMobileRuntimeConfig(
		[]byte(configJSON),
		tunFd,
		engine.RoutingRule,
		clashPort,
		clashSecret,
	)
	if err != nil {
		s.setState(StateError, err.Error())
		return fmt.Errorf("failed to derive mobile runtime config: %w", err)
	}

	mgr := engine.NewManager(1000)
	if err := guardCorePanic(func() error { return mgr.Start(derivedConfig) }); err != nil {
		s.setState(StateError, err.Error())
		return fmt.Errorf("failed to start engine: %w", err)
	}

	clashClient := engine.NewClashClient(clashPort, clashSecret)

	s.mu.Lock()
	s.manager = mgr
	s.clashClient = clashClient
	s.clashPort = clashPort
	s.clashSecret = clashSecret
	s.activeTunFd = tunFd
	s.stopTicker = make(chan struct{})
	s.mu.Unlock()

	s.setState(StateConnected, "VPN tunnel established")

	// Start traffic polling loop
	go s.trafficLoop()

	return nil
}

// guardCorePanic keeps a core panic from aborting the whole app (gomobile
// turns Go panics into process kills): it converts the panic to an error and,
// while the stack is still unwound-to-here, dumps the full frame list to the
// panic file — the runtime's own trace is lost with the aborted process.
func guardCorePanic(work func() error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			buf := make([]byte, 1<<16)
			buf = buf[:runtime.Stack(buf, false)]
			fmt.Fprintf(os.Stderr, "recovered core panic: %v\n%s", r, buf)
			err = fmt.Errorf("core panic: %v", r)
		}
	}()
	return work()
}

func (s *TunnelService) Stop() error {
	s.mu.Lock()
	if s.state == StateIdle || s.state == StateDisconnecting {
		s.mu.Unlock()
		return nil
	}
	s.state = StateDisconnecting
	stopTicker := s.stopTicker
	mgr := s.manager
	s.manager = nil
	s.clashClient = nil
	s.mu.Unlock()

	if stopTicker != nil {
		close(stopTicker)
	}

	if s.platform != nil {
		s.platform.OnStateChanged(StateDisconnecting, "Stopping VPN tunnel...")
	}

	var err error
	if mgr != nil {
		err = mgr.Stop()
	}
	engine.SetMobileTunFD(0)

	s.setState(StateIdle, "VPN tunnel stopped")
	return err
}

// Reload swaps the running core over to new subscription content without
// tearing down the Android VPN interface: the TUN file descriptor stays
// open and owned by the platform, so only the core restarts. Selections are
// preserved and a failed reload rolls the previous core back (manager
// guarantee), leaving the tunnel on the last known-good configuration.
func (s *TunnelService) Reload(configJSON string) error {
	s.mu.RLock()
	mgr := s.manager
	s.mu.RUnlock()

	if mgr == nil {
		return errors.New("VPN engine is not running")
	}
	if len(configJSON) == 0 {
		return errors.New("empty configuration")
	}

	clashPort, clashSecret := s.currentClashEndpoint()
	derivedConfig, err := engine.DeriveMobileRuntimeConfig(
		[]byte(configJSON),
		s.activeTunFd,
		engine.RoutingRule,
		clashPort,
		clashSecret,
	)
	if err != nil {
		return fmt.Errorf("failed to derive mobile runtime config: %w", err)
	}
	if err := guardCorePanic(func() error { return mgr.Reload(derivedConfig, nil) }); err != nil {
		return err
	}
	// The old controller endpoint died with the old core: repoint the
	// client so traffic polling and node selection follow the new one.
	s.mu.Lock()
	s.clashPort = clashPort
	s.clashSecret = clashSecret
	s.clashClient = engine.NewClashClient(clashPort, clashSecret)
	s.mu.Unlock()
	return nil
}

// currentClashEndpoint re-picks a fresh loopback endpoint for a reload: the
// old listener is being torn down with the old core.
func (s *TunnelService) currentClashEndpoint() (int, string) {
	return getFreeLoopbackPort(), randomSecret()
}

func (s *TunnelService) trafficLoop() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		s.mu.RLock()
		stopCh := s.stopTicker
		clashClient := s.clashClient
		platform := s.platform
		s.mu.RUnlock()

		if stopCh == nil {
			return
		}

		select {
		case <-stopCh:
			return
		case <-ticker.C:
			if clashClient == nil || platform == nil {
				continue
			}

			ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
			conns, err := clashClient.GetConnections(ctx)
			cancel()

			if err == nil {
				s.mu.Lock()
				s.lastUpload = conns.UploadTotal
				s.lastDownload = conns.DownloadTotal
				s.mu.Unlock()

				platform.OnTraffic(conns.UploadTotal, conns.DownloadTotal)
			}
		}
	}
}

func (s *TunnelService) SelectOutbound(group string, outbound string) error {
	s.mu.RLock()
	client := s.clashClient
	s.mu.RUnlock()

	if client == nil {
		return errors.New("VPN engine is not running")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	return client.SelectNode(ctx, group, outbound)
}

func (s *TunnelService) ProtectSocket(fd int32) error {
	s.mu.RLock()
	platform := s.platform
	s.mu.RUnlock()

	if platform != nil {
		return platform.ProtectSocket(fd)
	}
	return nil
}

type MobileThreeTier struct {
	Core     TierItem `json:"core"`
	Takeover TierItem `json:"takeover"`
	Egress   TierItem `json:"egress"`
	Ready    bool     `json:"ready"`
}

type TierItem struct {
	OK     bool   `json:"ok"`
	Label  string `json:"label"`
	Detail string `json:"detail"`
}

type MobileStatusOutput struct {
	State     int32           `json:"state"`
	Running   bool            `json:"running"`
	ThreeTier MobileThreeTier `json:"threeTier"`
	Upload    int64           `json:"uploadTotal"`
	Download  int64           `json:"downloadTotal"`
}

func (s *TunnelService) GetStatusJSON() string {
	s.mu.RLock()
	state := s.state
	running := state == StateConnected && s.manager != nil && s.manager.IsRunning()
	up := s.lastUpload
	down := s.lastDownload
	s.mu.RUnlock()

	out := MobileStatusOutput{
		State:    state,
		Running:  running,
		Upload:   up,
		Download: down,
		ThreeTier: MobileThreeTier{
			Core: TierItem{
				OK:     running,
				Label:  "核心可達",
				Detail: "mihomo 行動 VPN 擴展",
			},
			Takeover: TierItem{
				OK:     running,
				Label:  "流量接管",
				Detail: "系統 TUN 檔案描述符已注入",
			},
			Egress: TierItem{
				OK:     running,
				Label:  "出口驗證",
				Detail: "用戶態協議棧已就緒",
			},
			Ready: running,
		},
	}

	bytes, _ := json.Marshal(out)
	return string(bytes)
}

func (s *TunnelService) UpdateSubscription(tokenOrURL string) (string, error) {
	if s.subMgr == nil {
		return "", errors.New("subscription manager uninitialized")
	}

	var meta *sub.SubscriptionMeta
	var err error

	if strings.HasPrefix(tokenOrURL, "sub-") {
		meta, err = s.subMgr.AddXBond(tokenOrURL, "", nil, "", "zh-HK", "Mobile Sub", 24, true)
	} else {
		meta, err = s.subMgr.AddUniversal(tokenOrURL, "Mobile Sub", 24, true)
	}

	if err != nil {
		return "", err
	}

	bytes, _ := json.Marshal(meta)
	return string(bytes), nil
}
