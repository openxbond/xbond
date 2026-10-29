package engine

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	if m.boxInstance != nil {
		_ = m.boxInstance.Close()
		m.boxInstance = nil
	}
	if m.boxCancel != nil {
		m.boxCancel()
		m.boxCancel = nil
	}
	m.running = false
	m.startedAt = time.Time{}
	m.ringLogger.Append(LogLevelInfo, "sing-box engine stopped")
	return nil
}

func (m *Manager) Reload(runtimeJSON []byte, savedSelections map[string]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := Validate(runtimeJSON); err != nil {
		return fmt.Errorf("new runtime config failed validation: %w", err)
	}

	// Capture current selections if not explicitly provided
	if m.running && m.client != nil && len(savedSelections) == 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		if proxies, err := m.client.GetProxies(ctx); err == nil {
			savedSelections = make(map[string]string)
			for name, item := range proxies {
				if item.Type == "Selector" && item.Now != "" {
					savedSelections[name] = item.Now
				}
			}
		}
		cancel()
	}

	if m.running {
		_ = m.stopLocked()
	}

	if err := m.startLocked(runtimeJSON); err != nil {
		return err
	}

	// Replay saved selections
	if len(savedSelections) > 0 && m.client != nil {
		go func(selections map[string]string) {
			time.Sleep(100 * time.Millisecond)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			proxies, err := m.client.GetProxies(ctx)
			if err != nil {
				return
			}

			for group, targetNode := range selections {
				item, exists := proxies[group]
				if !exists || item.Type != "Selector" {
					continue
				}

				for _, candidate := range item.All {
					if candidate == targetNode {
						_ = m.client.SelectNode(ctx, group, targetNode)
						break
					}
				}
			}
		}(savedSelections)
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

	for _, in := range raw.Inbounds {
		if in.Type == "mixed" && in.ListenPort > 0 {
			m.mixedPort = in.ListenPort
			if in.Listen == "0.0.0.0" {
				m.allowLan = true
			}
			break
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
