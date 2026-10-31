package engine

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"maps"
	"net"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/metacubex/mihomo/common/observable"
	"github.com/metacubex/mihomo/component/profile/cachefile"
	"github.com/metacubex/mihomo/config"
	C "github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/hub"
	"github.com/metacubex/mihomo/hub/executor"
	mihomoLog "github.com/metacubex/mihomo/log"

	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/version"
)

type Manager struct {
	mu sync.RWMutex
	// logSub is closed by UnSubscribe on stop, which also ends pumpLogs.
	logSub      observable.Subscription[mihomoLog.Event]
	running     bool
	startedAt   time.Time
	runtimeYAML []byte

	takeoverMode TakeoverMode
	routingMode  RoutingMode
	mixedPort    int
	allowLan     bool
	clashPort    int
	clashSecret  string

	client     *ClashClient
	ringLogger *RingLogger
}

func NewManager(ringCap int) *Manager {
	if ringCap <= 0 {
		ringCap = 1000
	}
	return &Manager{
		ringLogger:   NewRingLogger(ringCap),
		takeoverMode: ModeSysproxy,
		routingMode:  RoutingRule,
		mixedPort:    7890,
		clashPort:    9090,
	}
}

func GenerateSecret() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (m *Manager) IsRunning() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.running
}

func (m *Manager) Status() EngineStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var uptime int64
	if m.running && !m.startedAt.IsZero() {
		uptime = int64(time.Since(m.startedAt).Seconds())
	}

	return EngineStatus{
		Running:       m.running,
		TakeoverMode:  m.takeoverMode,
		RoutingMode:   m.routingMode,
		MixedPort:     m.mixedPort,
		AllowLan:      m.allowLan,
		ClashPort:     m.clashPort,
		ClashSecret:   m.clashSecret,
		StartedAt:     m.startedAt,
		UptimeSeconds: uptime,
	}
}

func (m *Manager) Client() *ClashClient {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.client
}

func (m *Manager) RingLog() *RingLogger {
	return m.ringLogger
}

func (m *Manager) Start(runtimeYAML []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		return fmt.Errorf("engine is already running")
	}

	return m.startLocked(runtimeYAML)
}

// initCoreHome points mihomo's home dir (cache.db, geodata) at the xbond
// data dir before ANY core interaction. It must run before Validate too:
// config parsing touches the cachefile singleton, and with the default home
// (~/.config/mihomo, usually nonexistent) a failed open would poison the
// singleton with a nil DB for the whole process lifetime.
func initCoreHome() error {
	homeDir := paths.DataDir()
	if err := os.MkdirAll(homeDir, 0o700); err != nil {
		return fmt.Errorf("prepare core data dir: %w", err)
	}
	C.SetHomeDir(homeDir)
	// The module's ldflags version stamp is absent when embedded; report the
	// pinned core version the binary was actually built against.
	C.Version = version.CoreVersion
	return nil
}

func (m *Manager) startLocked(runtimeYAML []byte) error {
	if err := initCoreHome(); err != nil {
		return err
	}

	logSub := mihomoLog.Subscribe()
	go m.pumpLogs(logSub)

	if err := hub.Parse(runtimeYAML); err != nil {
		mihomoLog.UnSubscribe(logSub)
		return fmt.Errorf("failed to start mihomo core: %w", err)
	}

	m.extractMetadata(runtimeYAML)

	// mihomo applies config without failing on bind errors: the external
	// controller and proxy listeners start asynchronously and only log a
	// conflict. Probe both so a port conflict is a start failure that
	// triggers rollback, not a half-running core.
	if err := m.awaitCoreReady(); err != nil {
		executor.Shutdown()
		closeCoreCache()
		mihomoLog.UnSubscribe(logSub)
		return fmt.Errorf("mihomo core did not become ready: %w", err)
	}

	m.logSub = logSub
	m.running = true
	m.startedAt = time.Now()
	m.runtimeYAML = append([]byte(nil), runtimeYAML...)
	m.client = NewClashClient(m.clashPort, m.clashSecret)

	m.ringLogger.Append(LogLevelInfo, fmt.Sprintf("mihomo v%s started (mixed: %d, clash: %d)", version.CoreVersion, m.mixedPort, m.clashPort))
	return nil
}

func (m *Manager) Stop() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.running {
		return nil
	}

	return m.stopLocked()
}

func (m *Manager) stopLocked() error {
	if m.logSub != nil {
		mihomoLog.UnSubscribe(m.logSub)
		m.logSub = nil
	}
	executor.Shutdown()
	closeCoreCache()
	m.running = false
	m.client = nil
	m.startedAt = time.Time{}
	m.ringLogger.Append(LogLevelInfo, "mihomo core stopped")
	return nil
}

// closeCoreCache releases mihomo's cache.db file lock. mihomo keeps the
// bbolt singleton open for the process lifetime, which would block data-dir
// deletion on Windows; closing it means in-session restarts lose only the
// cache-based convenience persistence (selections restore through the
// daemon's own SavedSelections mechanism instead).
func closeCoreCache() {
	if cache := cachefile.Cache(); cache != nil && cache.DB != nil {
		_ = cache.DB.Close()
	}
}

func (m *Manager) Reload(runtimeYAML []byte, savedSelections map[string]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := Validate(runtimeYAML); err != nil {
		return fmt.Errorf("new runtime config failed validation: %w", err)
	}

	var previousSelections map[string]string
	if m.running && m.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		proxies, err := m.client.GetProxies(ctx)
		cancel()
		if err != nil {
			return fmt.Errorf("capture current node selections: %w", err)
		}
		previousSelections = make(map[string]string)
		for name, item := range proxies {
			if item.Type == "Selector" && item.Now != "" {
				previousSelections[name] = item.Now
			}
		}
	}
	if len(savedSelections) == 0 {
		savedSelections = previousSelections
	} else {
		savedSelections = maps.Clone(savedSelections)
	}
	wasRunning := m.running
	previous := append([]byte(nil), m.runtimeYAML...)
	var applyErr error
	if wasRunning {
		if err := m.stopLocked(); err != nil {
			applyErr = fmt.Errorf("stop previous core: %w", err)
		}
	}
	if applyErr == nil {
		applyErr = m.startLocked(runtimeYAML)
	}
	if applyErr == nil {
		applyErr = m.restoreSelectionsLocked(savedSelections)
	}
	if applyErr == nil {
		return nil
	}

	problems := []error{applyErr}
	if m.running {
		if err := m.stopLocked(); err != nil {
			problems = append(problems, fmt.Errorf("stop rejected core: %w", err))
		}
	}
	if wasRunning {
		if err := m.startLocked(previous); err != nil {
			problems = append(problems, fmt.Errorf("restore previous core: %w", err))
		} else if err := m.restoreSelectionsLocked(previousSelections); err != nil {
			problems = append(problems, fmt.Errorf("restore previous node selections: %w", err))
		}
	}
	return errors.Join(problems...)
}

func (m *Manager) restoreSelectionsLocked(selections map[string]string) error {
	if len(selections) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	proxies, err := m.client.GetProxies(ctx)
	if err != nil {
		return fmt.Errorf("read node selections: %w", err)
	}
	for group, target := range selections {
		item, exists := proxies[group]
		if !exists || item.Type != "Selector" {
			continue
		}
		for _, candidate := range item.All {
			if candidate == target {
				if err := m.client.SelectNode(ctx, group, target); err != nil {
					return fmt.Errorf("restore saved node selection: %w", err)
				}
				break
			}
		}
	}
	return nil
}

// awaitCoreReady confirms the controller answers and the mixed listener is
// bound. Retries absorb the async listener startup inside mihomo.
func (m *Manager) awaitCoreReady() error {
	client := NewClashClient(m.clashPort, m.clashSecret)
	deadline := time.Now().Add(3 * time.Second)
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		_, err := client.GetVersion(ctx)
		cancel()
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("clash controller on port %d: %w", m.clashPort, err)
		}
		time.Sleep(25 * time.Millisecond)
	}

	if m.mixedPort > 0 {
		deadline := time.Now().Add(3 * time.Second)
		for {
			if err := probeMixedListener(m.mixedPort); err == nil {
				break
			}
			if time.Now().After(deadline) {
				return fmt.Errorf("mixed listener on port %d did not answer", m.mixedPort)
			}
			time.Sleep(25 * time.Millisecond)
		}
	}
	return nil
}

// probeMixedListener sends an HTTP request that any real proxy inbound
// answers (a proxy rejects a non-proxy GET). A foreign passive listener
// accepts but never responds, so a port conflict still fails startup.
func probeMixedListener(port int) error {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 500*time.Millisecond)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(500 * time.Millisecond))
	request := "GET / HTTP/1.1\r\nHost: xbond.probe\r\nConnection: close\r\n\r\n"
	if _, err := conn.Write([]byte(request)); err != nil {
		return err
	}
	buf := make([]byte, 16)
	if _, err := conn.Read(buf); err != nil {
		return err
	}
	return nil
}

func (m *Manager) extractMetadata(runtimeYAML []byte) {
	raw, err := config.UnmarshalRawConfig(runtimeYAML)
	if err != nil {
		return
	}

	if raw.Tun.Enable {
		m.takeoverMode = ModeTun
	} else {
		m.takeoverMode = ModePort
	}
	m.allowLan = raw.AllowLan && (raw.BindAddress == "*" || raw.BindAddress == "0.0.0.0" || raw.BindAddress == "::")
	if raw.MixedPort > 0 {
		m.mixedPort = raw.MixedPort
	}
	switch raw.Mode.String() {
	case "rule":
		m.routingMode = RoutingRule
	case "global":
		m.routingMode = RoutingGlobal
	case "direct":
		m.routingMode = RoutingDirect
	}

	if raw.ExternalController != "" {
		if _, portStr, err := net.SplitHostPort(raw.ExternalController); err == nil {
			if port, err := strconv.Atoi(portStr); err == nil && port > 0 {
				m.clashPort = port
			}
		}
		m.clashSecret = raw.Secret
	}
}

func (m *Manager) pumpLogs(sub observable.Subscription[mihomoLog.Event]) {
	for event := range sub {
		// Subscribers receive every event regardless of the configured
		// console level; mirror the console filter so the ring matches what
		// mihomo itself would print.
		if event.LogLevel < mihomoLog.Level() {
			continue
		}
		var level LogLevel
		switch event.LogLevel {
		case mihomoLog.DEBUG:
			level = LogLevelDebug
		case mihomoLog.WARNING:
			level = LogLevelWarn
		case mihomoLog.ERROR:
			level = LogLevelError
		default:
			level = LogLevelInfo
		}
		m.ringLogger.Append(level, event.Payload)
	}
}
