package daemon

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/openxbond/xbond/internal/diag"
	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/sub"
)

// The shutdown endpoint tears the runtime down before answering, so the CLI
// can distinguish "exit accepted" from "proxy restored, engine down".
func TestShutdownHandlerCleansUpBeforeAnswering(t *testing.T) {
	f := newRuntimeFixture(t)
	server := &Server{subMgr: f.subs, runtime: f.controller, shutdownCh: make(chan struct{})}
	if !f.core.IsRunning() {
		t.Fatal("fixture core should start running")
	}

	response := runtimeRequest(server.handleShutdown, "")
	var result ShutdownResult
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || !result.CleanedUp || result.Error != "" {
		t.Fatalf("shutdown did not report completed cleanup: %d %s", response.Code, response.Body)
	}
	if f.core.IsRunning() {
		t.Fatal("shutdown answered before the core stopped")
	}
}

// light=1 keeps readiness probes and polling loops off the DNS/egress checks.
func TestLightStatusSkipsNetworkEvaluation(t *testing.T) {
	f := newRuntimeFixture(t)
	server := &Server{
		engineMgr: engine.NewManager(100),
		subMgr:    f.subs,
		runtime:   f.controller,
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/localapi/v0/status?light=1", nil)
	server.authMiddleware(server.handleStatus)(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("light status failed: %d %s", recorder.Code, recorder.Body)
	}
	var payload struct {
		ThreeTier diag.ThreeTierStatus `json:"threeTier"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ThreeTier.CoreReachable || payload.ThreeTier.TrafficIntercepted || payload.ThreeTier.EgressVerified {
		t.Fatalf("light status ran the network evaluation: %+v", payload.ThreeTier)
	}
}

// Logout clears XBond credentials only: universal subscriptions survive, and
// the core disconnects only when the active subscription was XBound-owned.
func TestLogoutRemovesOnlyXBondSubsAndStopsActiveCore(t *testing.T) {
	f := newRuntimeFixture(t)
	if _, err := f.subs.AddXBond("sub-logout-test-token", "", nil, "", "", "", 24, true); err != nil {
		t.Fatal(err)
	}
	if f.subs.ActiveID() == f.first.ID || f.subs.ActiveID() == f.second.ID {
		t.Fatal("the added xbond subscription should be active")
	}

	removed, err := f.controller.Logout()
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 || removed[0].Type != sub.SubTypeXBond {
		t.Fatalf("wrong removal set: %+v", removed)
	}
	if f.core.IsRunning() {
		t.Fatal("removing the active xbond subscription must stop the core")
	}
	if len(f.subs.List()) != 2 {
		t.Fatalf("universal subscriptions must survive logout, got %d", len(f.subs.List()))
	}
	if _, err := f.subs.Get(f.first.ID); err != nil {
		t.Fatalf("universal subscription was removed by logout: %v", err)
	}
}

// Repeating `up` with unchanged arguments must not bounce the running core;
// a real configuration change still reloads.
func TestRuntimeRepeatUpIsIdempotentButChangesReload(t *testing.T) {
	f := newRuntimeFixture(t)
	reloads := 0
	f.core.onReload = func() { reloads++ }

	if err := f.controller.Up(context.Background(), runtimeOptions{}); err != nil {
		t.Fatal(err)
	}
	if reloads != 0 {
		t.Fatalf("repeated up with unchanged config reloaded the core %d time(s)", reloads)
	}

	if err := f.controller.Up(context.Background(), runtimeOptions{Routing: engine.RoutingGlobal}); err != nil {
		t.Fatal(err)
	}
	if reloads != 1 {
		t.Fatalf("a real config change must reload once, got %d", reloads)
	}
}

// Exit confirmation probes the instance lock — the OS drops it on process
// death, so a free lock means no daemon is running even when the handshake
// files still exist.
func TestInstanceLockProbeReportsHolderAndRelease(t *testing.T) {
	dir := t.TempDir()

	held, err := InstanceLockHeld(dir)
	if err != nil || held {
		t.Fatalf("free data dir reported held: held=%v err=%v", held, err)
	}

	lock, err := acquireInstanceLock(dir)
	if err != nil {
		t.Fatal(err)
	}
	held, err = InstanceLockHeld(dir)
	if err != nil || !held {
		t.Fatalf("locked data dir reported free: held=%v err=%v", held, err)
	}

	lock.Release()
	held, err = InstanceLockHeld(dir)
	if err != nil || held {
		t.Fatalf("released data dir still held: held=%v err=%v", held, err)
	}
}
