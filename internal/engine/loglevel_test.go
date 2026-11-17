package engine

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// stubCoreDriver stands in for a running core so SetLogLevel can be tested
// without a live box or hub.
type stubCoreDriver struct{ format CoreFormat }

func (c *stubCoreDriver) start([]byte, *Manager) error { return nil }
func (c *stubCoreDriver) stop() error                  { return nil }
func (c *stubCoreDriver) kind() CoreFormat             { return c.format }

func runningManagerForTest(t *testing.T, format CoreFormat, port int) *Manager {
	t.Helper()
	m := NewManager(0)
	m.mu.Lock()
	m.running = true
	m.core = &stubCoreDriver{format: format}
	m.client = NewClashClient(port, "")
	m.mu.Unlock()
	return m
}

// sing-box v1.13's clash API PATCH /configs only handles mode: the log-level
// PATCH is silently dropped, and its GET /configs clamps fatal to "error", so
// a read-back would both always report the pre-PATCH level and falsely
// confirm a silent→error switch while the core stays silent. The manager must
// short-circuit to the reload-required error without talking to the core.
func TestSetLogLevelSingBoxRequiresReload(t *testing.T) {
	var requests int
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.WriteHeader(http.StatusNoContent)
	}))
	defer core.Close()

	port := core.Listener.Addr().(*net.TCPAddr).Port
	m := runningManagerForTest(t, FormatSingBox, port)

	err := m.SetLogLevel("debug")
	if !errors.Is(err, errLogLevelReloadRequired) {
		t.Fatalf("expected reload-required error, got %v", err)
	}
	if requests != 0 {
		t.Fatalf("sing-box hot switch must not talk to the core, got %d requests", requests)
	}
}

// mihomo honors the level PATCH live and reports it faithfully on GET; the
// read-back pins that contract and the failure shape when the core keeps its
// level.
func TestSetLogLevelMihomoHotSwitch(t *testing.T) {
	var mu sync.Mutex
	applied := "info"
	honorPatch := true
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPatch && r.URL.Path == "/configs":
			var payload struct {
				LogLevel string `json:"log-level"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			mu.Lock()
			if honorPatch {
				applied = payload.LogLevel
			}
			mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && r.URL.Path == "/configs":
			mu.Lock()
			level := applied
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]string{"log-level": level})
		default:
			http.NotFound(w, r)
		}
	}))
	defer core.Close()

	port := core.Listener.Addr().(*net.TCPAddr).Port
	m := runningManagerForTest(t, FormatClash, port)

	// info→debug applies live; the core reports it back in its own spelling
	// and canonical spellings collapse.
	if err := m.SetLogLevel("debug"); err != nil {
		t.Fatalf("expected hot switch to succeed, got %v", err)
	}
	mu.Lock()
	changed := applied
	mu.Unlock()
	if changed != "debug" {
		t.Fatalf("core did not receive the level PATCH: %q", changed)
	}

	// A core that keeps its old level must fail the switch: callers fall back
	// to a reload instead of reporting success.
	mu.Lock()
	applied = "info"
	honorPatch = false
	mu.Unlock()
	if err := m.SetLogLevel("warn"); err == nil {
		t.Fatal("expected read-back mismatch to fail the hot switch")
	}
}
