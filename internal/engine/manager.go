package engine

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/sagernet/sing-box"
	_ "github.com/sagernet/sing-box/experimental/clashapi"
	"github.com/sagernet/sing-box/option"
	singJson "github.com/sagernet/sing/common/json"
)

type Manager struct {
	mu          sync.RWMutex
	boxInstance *box.Box
	boxCancel   context.CancelFunc
	running     bool
	startedAt   time.Time
	runtimeJSON []byte

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

func (m *Manager) Start(runtimeJSON []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.running {
		return fmt.Errorf("engine is already running")
	}

	return m.startLocked(runtimeJSON)
}

func (m *Manager) startLocked(runtimeJSON []byte) error {
	ctx := NewBoxContext()
	boxCtx, cancel := context.WithCancel(ctx)

	options, err := singJson.UnmarshalExtendedContext[option.Options](boxCtx, runtimeJSON)
	if err != nil {
		cancel()
		return fmt.Errorf("failed to unmarshal runtime config options: %w", err)
	}

	instance, err := box.New(box.Options{
		Context:           boxCtx,
		Options:           options,
		PlatformLogWriter: m.ringLogger,
	})
	if err != nil {
		cancel()
		return fmt.Errorf("failed to create box instance: %w", err)
	}

	if err := instance.Start(); err != nil {
		_ = instance.Close()
		cancel()
		return fmt.Errorf("failed to start box instance: %w", err)
	}

	m.extractMetadata(runtimeJSON)

	m.boxInstance = instance
	m.boxCancel = cancel
	m.running = true
	m.startedAt = time.Now()
	m.runtimeJSON = append([]byte(nil), runtimeJSON...)
	m.client = NewClashClient(m.clashPort, m.clashSecret)

	m.ringLogger.Append(LogLevelInfo, fmt.Sprintf("sing-box v%s started (mixed: %d, clash: %d)", SingBoxVersionFromPackage(), m.mixedPort, m.clashPort))
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
	var closeErr error
	if m.boxInstance != nil {
		closeErr = m.boxInstance.Close()
		m.boxInstance = nil
	}
	if m.boxCancel != nil {
		m.boxCancel()
		m.boxCancel = nil
	}
	m.running = false
	m.client = nil
	m.startedAt = time.Time{}
	m.ringLogger.Append(LogLevelInfo, "sing-box engine stopped")
	return closeErr
}

func (m *Manager) Reload(runtimeJSON []byte, savedSelections map[string]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := Validate(runtimeJSON); err != nil {
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
	previous := append([]byte(nil), m.runtimeJSON...)
	var applyErr error
	if wasRunning {
		if err := m.stopLocked(); err != nil {
			applyErr = fmt.Errorf("stop previous core: %w", err)
		}
	}
	if applyErr == nil {
		applyErr = m.startLocked(runtimeJSON)
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

func (m *Manager) extractMetadata(runtimeJSON []byte) {
	var raw struct {
		Inbounds []struct {
			Type       string `json:"type"`
			Listen     string `json:"listen"`
			ListenPort int    `json:"listen_port"`
		} `json:"inbounds"`
		Experimental struct {
			ClashAPI struct {
				ExternalController string `json:"external_controller"`
				Secret             string `json:"secret"`
				DefaultMode        string `json:"default_mode"`
			} `json:"clash_api"`
		} `json:"experimental"`
	}

	if err := json.Unmarshal(runtimeJSON, &raw); err != nil {
		return
	}

	m.takeoverMode = ModePort
	m.allowLan = false
	for _, in := range raw.Inbounds {
		if in.Type == "tun" {
			m.takeoverMode = ModeTun
		}
		if in.Type == "mixed" && in.ListenPort > 0 {
			m.mixedPort = in.ListenPort
			m.allowLan = in.Listen == "0.0.0.0" || in.Listen == "::"
		}
	}

	if raw.Experimental.ClashAPI.ExternalController != "" {
		host, portStr, err := net.SplitHostPort(raw.Experimental.ClashAPI.ExternalController)
		if err == nil {
			if port, err := strconv.Atoi(portStr); err == nil && port > 0 {
				m.clashPort = port
			}
		}
		_ = host
		m.clashSecret = raw.Experimental.ClashAPI.Secret
		if raw.Experimental.ClashAPI.DefaultMode != "" {
			m.routingMode = RoutingMode(raw.Experimental.ClashAPI.DefaultMode)
		}
	}
}

func SingBoxVersionFromPackage() string {
	return "1.13.21"
}
