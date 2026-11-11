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
	"strings"
	"sync"
	"time"

	"github.com/metacubex/mihomo/common/observable"
	"github.com/metacubex/mihomo/component/geodata"
	"github.com/metacubex/mihomo/component/profile/cachefile"
	C "github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/hub/executor"
	mihomoLog "github.com/metacubex/mihomo/log"
	"github.com/sagernet/sing-box"
	_ "github.com/sagernet/sing-box/experimental/clashapi" // registers the clash API server
	slog "github.com/sagernet/sing-box/log"
	"github.com/sagernet/sing-box/option"
	singJson "github.com/sagernet/sing/common/json"

	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/version"
)

// coreDriver isolates the lifecycle of one embedded core. Exactly one core
// runs at a time; the active subscription's format picks which one, and a
// format switch on Reload restarts onto the other core.
type coreDriver interface {
	start(config []byte, m *Manager) error
	stop() error
	kind() CoreFormat
}

// mihomoCore drives the Clash-format core.
type mihomoCore struct {
	logSub observable.Subscription[mihomoLog.Event]
}

func (c *mihomoCore) kind() CoreFormat { return FormatClash }

func (c *mihomoCore) start(config []byte, m *Manager) error {
	if err := initCoreHome(); err != nil {
		return err
	}
	c.logSub = mihomoLog.Subscribe()
	go m.pumpMihomoLogs(c.logSub)
	if err := startMihomo(config); err != nil {
		mihomoLog.UnSubscribe(c.logSub)
		c.logSub = nil
		return fmt.Errorf("failed to start mihomo core: %w", err)
	}
	return nil
}

func (c *mihomoCore) stop() error {
	// mihomo 的日志源是包级全局 observable，executor.Shutdown() 不会关闭
	// 它：不退订则每次 reload 泄漏一个 pump goroutine，且每个泄漏的泵把
	// 同一行日志重复写进 ring 一次。
	if c.logSub != nil {
		mihomoLog.UnSubscribe(c.logSub)
		c.logSub = nil
	}
	executor.Shutdown()
	// Release mihomo's cache.db file lock: the bbolt singleton would
	// otherwise stay open for the process lifetime and block data-dir
	// deletion on Windows. In-session selection memory is covered by the
	// daemon's own SavedSelections mechanism.
	if cache := cachefile.Cache(); cache != nil && cache.DB != nil {
		_ = cache.DB.Close()
	}
	return nil
}

// singBoxCore drives the sing-box-format core.
type singBoxCore struct {
	instance *box.Box
	cancel   context.CancelFunc
}

func (c *singBoxCore) kind() CoreFormat { return FormatSingBox }

func (c *singBoxCore) start(config []byte, m *Manager) error {
	boxCtx, cancel := context.WithCancel(NewBoxContext())
	options, err := singJson.UnmarshalExtendedContext[option.Options](boxCtx, config)
	if err != nil {
		cancel()
		return fmt.Errorf("failed to unmarshal runtime config options: %w", err)
	}
	// Do not pass PlatformLogWriter on box.Options: sing-box treats a
	// non-nil PlatformLogWriter as a libbox signal to force the bbolt
	// cache-file service on even when cache_file.enabled is false (which
	// breaks reload on Android with funlock EBADF). Because clash_api is
	// always configured, instance.LogFactory() is an ObservableFactory and
	// streams the same entries without that side effect.
	instance, err := box.New(box.Options{
		Context: boxCtx,
		Options: options,
	})
	if err != nil {
		cancel()
		return fmt.Errorf("failed to create box instance: %w", err)
	}
	if obs, ok := instance.LogFactory().(slog.ObservableFactory); ok {
		if sub, done, subErr := obs.Subscribe(); subErr == nil {
			go m.pumpSingBoxLogs(sub, done)
		}
	}
	releaseDescriptor, err := prepareSingBoxDescriptor()
	if err != nil {
		_ = instance.Close()
		cancel()
		return err
	}
	defer releaseDescriptor()
	if err := instance.Start(); err != nil {
		_ = instance.Close()
		cancel()
		return fmt.Errorf("failed to start box instance: %w", err)
	}
	c.instance = instance
	c.cancel = cancel
	return nil
}

func (c *singBoxCore) stop() error {
	var closeErr error
	if c.instance != nil {
		closeErr = c.instance.Close()
		c.instance = nil
	}
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
	return closeErr
}

type Manager struct {
	mu            sync.RWMutex
	core          coreDriver
	running       bool
	startedAt     time.Time
	runtimeConfig []byte

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
	var core CoreFormat
	if m.core != nil {
		core = m.core.kind()
	}

	return EngineStatus{
		Running:       m.running,
		Core:          core,
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

func (m *Manager) Start(runtimeConfig []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		return fmt.Errorf("engine is already running")
	}

	return m.startLocked(runtimeConfig)
}

// isBindInUseError reports whether a core start failed because a takeover
// port is still held by the just-stopped previous owner (Go's loopback
// message on unix, the socket-address one on Windows).
func isBindInUseError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "address already in use") ||
		strings.Contains(msg, "only one usage of each socket address")
}

func (m *Manager) startLocked(runtimeConfig []byte) error {
	format, err := DetectFormat(runtimeConfig)
	if err != nil {
		return fmt.Errorf("detect core: %w", err)
	}
	var driver coreDriver
	switch format {
	case FormatClash:
		driver = &mihomoCore{}
	case FormatSingBox:
		driver = &singBoxCore{}
	default:
		return fmt.Errorf("unsupported core format %q", format)
	}

	// A takeover handover can leave the previous owner's listeners a beat
	// behind its stop reply: the kernel hands the takeover ports back just
	// after the stop returns, and the fresh bind then fails with "address
	// already in use". Give the release a bounded retry window instead of
	// failing the whole apply into rollback.
	const bindRetryBudget = 8 * time.Second
	deadline := time.Now().Add(bindRetryBudget)
	var startErr error
	for {
		startErr = driver.start(runtimeConfig, m)
		if startErr == nil || !isBindInUseError(startErr) || time.Now().After(deadline) {
			break
		}
		_ = driver.stop()
		time.Sleep(300 * time.Millisecond)
	}
	if startErr != nil {
		return startErr
	}

	m.extractMetadata(runtimeConfig)

	// mihomo applies config without failing on bind errors (listeners start
	// asynchronously and only log a conflict); probing both cores makes a
	// port conflict a start failure that triggers rollback.
	if err := m.awaitCoreReady(); err != nil {
		_ = driver.stop()
		return fmt.Errorf("core did not become ready: %w", err)
	}

	m.core = driver
	m.running = true
	m.startedAt = time.Now()
	m.runtimeConfig = append([]byte(nil), runtimeConfig...)
	m.client = NewClashClient(m.clashPort, m.clashSecret)

	m.ringLogger.Append(LogLevelInfo, fmt.Sprintf("%s v%s core started (mixed: %d, clash: %d)",
		coreDisplayName(format), versionForCore(format), m.mixedPort, m.clashPort))
	return nil
}

func versionForCore(format CoreFormat) string {
	if format == FormatSingBox {
		return version.SingBoxVersion
	}
	return version.CoreVersion
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
	var stopErr error
	if m.core != nil {
		stopErr = m.core.stop()
	}
	m.core = nil
	m.running = false
	m.client = nil
	m.startedAt = time.Time{}
	m.ringLogger.Append(LogLevelInfo, "core stopped")
	return stopErr
}

func (m *Manager) Reload(runtimeConfig []byte, savedSelections map[string]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := Validate(runtimeConfig); err != nil {
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
	previous := append([]byte(nil), m.runtimeConfig...)
	var applyErr error
	if wasRunning {
		if err := m.stopLocked(); err != nil {
			applyErr = fmt.Errorf("stop previous core: %w", err)
		}
	}
	if applyErr == nil {
		applyErr = m.startLocked(runtimeConfig)
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

// SetRoutingMode switches the routing mode of the running core in place and
// records runtimeConfig (the derived config carrying the new mode) so a later
// failed Reload rolls back to the right mode. sing-box silently ignores a mode
// outside its mode list, so the result is read back instead of trusting the
// PATCH; any error leaves the caller to fall back to a full Reload.
func (m *Manager) SetRoutingMode(mode RoutingMode, runtimeConfig []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.running || m.client == nil {
		return errors.New("core is not running")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := m.client.SetMode(ctx, mode); err != nil {
		return err
	}
	applied, err := m.client.GetMode(ctx)
	if err != nil {
		return err
	}
	if applied != mode {
		return fmt.Errorf("core kept routing mode %q instead of %q", applied, mode)
	}
	// Established connections keep the routing decision made under the old
	// mode; closing them makes the switch take effect immediately.
	if err := m.client.CloseAllConnections(ctx); err != nil {
		return fmt.Errorf("close connections after mode switch: %w", err)
	}
	m.routingMode = mode
	m.runtimeConfig = append([]byte(nil), runtimeConfig...)
	return nil
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

	geodata.SetMmdbUrl(defaultMmdbCDN)
	geodata.SetGeoIpUrl(defaultGeoIpCDN)
	geodata.SetGeoSiteUrl(defaultGeoSiteCDN)
	geodata.SetASNUrl(defaultASNCDN)

	return nil
}

func (m *Manager) extractMetadata(runtimeConfig []byte) {
	// Mobile derivations explicitly set mixed-port to 0 (no local listener):
	// the value must override the construction default so the readiness
	// probe skips the listener check instead of probing port 7890 forever.
	meta, err := InspectConfig(runtimeConfig)
	if err != nil {
		return
	}
	m.takeoverMode = meta.TakeoverMode
	m.routingMode = meta.RoutingMode
	m.mixedPort = meta.MixedPort
	m.allowLan = meta.AllowLan
	m.clashPort = meta.ClashPort
	m.clashSecret = meta.ClashSecret
}

// awaitCoreReady confirms the controller answers and the mixed listener is
// bound. Retries absorb the async listener startup inside mihomo; a foreign
// passive listener on a port never answers the probe request, so a conflict
// still fails startup.
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

func (m *Manager) pumpMihomoLogs(sub observable.Subscription[mihomoLog.Event]) {
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

func (m *Manager) pumpSingBoxLogs(sub <-chan slog.Entry, done <-chan struct{}) {
	for {
		select {
		case <-done:
			return
		case entry := <-sub:
			m.ringLogger.WriteMessage(entry.Level, entry.Message)
		}
	}
}
