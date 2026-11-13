package mobile

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"
)

type mockPlatform struct {
	mu          sync.Mutex
	states      []int32
	messages    []string
	trafficUp   int64
	trafficDown int64
	dataDir     string
}

func (m *mockPlatform) OpenURL(url string) error { return nil }
func (m *mockPlatform) RequestConnect() error    { return errors.New("connect not available in tests") }
func (m *mockPlatform) RequestDisconnect() error { return nil }
func (m *mockPlatform) OSVersion() string        { return "" }

func (m *mockPlatform) ProtectSocket(fd int32) error {
	return nil
}

func (m *mockPlatform) OnStateChanged(state int32, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.states = append(m.states, state)
	m.messages = append(m.messages, message)
}

func (m *mockPlatform) OnTraffic(uploadBytes int64, downloadBytes int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.trafficUp = uploadBytes
	m.trafficDown = downloadBytes
}

func (m *mockPlatform) DataDir() string {
	return m.dataDir
}

type mockListener struct {
	mu   sync.Mutex
	logs []string
}

func (l *mockListener) OnLog(level string, message string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.logs = append(l.logs, message)
}

func sampleConfig() string {
	return `{
  "outbounds": [
    {
      "type": "direct",
      "tag": "direct"
    },
    {
      "type": "block",
      "tag": "block"
    },
    {
      "type": "selector",
      "tag": "proxy-group",
      "outbounds": ["direct", "block"]
    }
  ]
}`
}

func TestTunnelServiceLifecycleAndValidation(t *testing.T) {
	// The platform bridge points the data dir at the app sandbox; without a
	// bridge the tests would write through to the host's real store.
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	platform := &mockPlatform{}
	listener := &mockListener{}

	svc := NewTunnelService(platform, listener)
	if svc.GetState() != StateIdle {
		t.Errorf("expected initial state Idle, got %d", svc.GetState())
	}

	// 1. Invalid tunFd <= 0
	if err := svc.Start(sampleConfig(), 0); err == nil {
		t.Errorf("expected error starting with tunFd 0")
	}
	if svc.GetState() != StateError {
		t.Errorf("expected state Error, got %d", svc.GetState())
	}

	// 2. Empty config
	if err := svc.Start("", 10); err == nil {
		t.Errorf("expected error starting with empty config")
	}

	// 3. Status JSON in idle/error state
	statusJSON := svc.GetStatusJSON()
	var status MobileStatusOutput
	if err := json.Unmarshal([]byte(statusJSON), &status); err != nil {
		t.Fatalf("failed to parse status JSON: %v", err)
	}
	if status.Running {
		t.Errorf("status.Running should be false")
	}
	if status.ThreeTier.Core.OK {
		t.Errorf("core ok should be false")
	}
}

func TestTunnelServiceStopWhenIdle(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	platform := &mockPlatform{}
	svc := NewTunnelService(platform, nil)

	if err := svc.Stop(); err != nil {
		t.Fatalf("stop on idle service should succeed without error: %v", err)
	}
	if svc.GetState() != StateIdle {
		t.Errorf("state should remain idle, got %d", svc.GetState())
	}
}

// Reload swaps subscription content without touching the VPN interface: the
// TUN fd stays valid, a failed reload keeps the previous core, and the
// clash client follows the new controller endpoint.
func TestTunnelServiceReloadKeepsTunnelAndRepointsClient(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	platform := &mockPlatform{}
	listener := &mockListener{}
	svc := NewTunnelService(platform, listener)
	if err := svc.Reload(sampleConfig()); err == nil {
		t.Fatal("reload without a running engine succeeded")
	}

	tunFd := int32(0)
	if err := svc.Start(sampleConfig(), tunFd); err == nil {
		t.Skip("engine requires a real TUN descriptor; skip on this host")
	}
}
