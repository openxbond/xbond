package daemon

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/platform/sysproxy"
	"github.com/openxbond/xbond/internal/sub"
)

// The intent record is the only signal that separates "the user connected"
// from "the user disconnected" from "the process died while connected".
func TestTakeoverIntentRoundTrip(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())

	if _, err := loadTakeoverIntent(); !os.IsNotExist(err) {
		t.Fatalf("absent record should read back as not-exist, got %v", err)
	}
	if lastTakeoverIntentDisconnected() {
		t.Fatal("absent record counted as an explicit disconnect")
	}

	if err := recordTakeoverIntent(takeoverIntentConnected); err != nil {
		t.Fatal(err)
	}
	if intent, err := loadTakeoverIntent(); err != nil || intent != takeoverIntentConnected {
		t.Fatalf("connected record lost: %s %v", intent, err)
	}
	if lastTakeoverIntentDisconnected() {
		t.Fatal("connected record counted as a disconnect")
	}

	// A later explicit disconnect overwrites the earlier connection.
	if err := recordTakeoverIntent(takeoverIntentDisconnected); err != nil {
		t.Fatal(err)
	}
	if !lastTakeoverIntentDisconnected() {
		t.Fatal("disconnect record not read back")
	}

	if err := os.WriteFile(paths.TakeoverIntentPath(), []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadTakeoverIntent(); err == nil {
		t.Fatal("corrupt record read back without error")
	}
	// Corrupt is unreadable, not a disconnect: auto-connect treats it as no
	// recorded objection instead of silently overriding the preference.
	if lastTakeoverIntentDisconnected() {
		t.Fatal("corrupt record counted as a disconnect")
	}
}

// The startup decision matrix: only a user-scope daemon with the preference
// on, an active subscription, and no recorded disconnect connects.
func TestShouldAutoConnectDecision(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	prefs := DefaultPreferences()
	if !prefs.AutoConnect {
		t.Fatal("auto-connect must default on")
	}

	if !shouldAutoConnect(false, prefs, true) {
		t.Fatal("fresh install with an active subscription and no record must connect")
	}
	if shouldAutoConnect(true, prefs, true) {
		t.Fatal("the machine-scoped daemon must not connect for itself")
	}
	off := prefs
	off.AutoConnect = false
	if shouldAutoConnect(false, off, true) {
		t.Fatal("an explicit preference off must stay off")
	}
	if shouldAutoConnect(false, prefs, false) {
		t.Fatal("nothing to connect without an active subscription")
	}

	if err := recordTakeoverIntent(takeoverIntentDisconnected); err != nil {
		t.Fatal(err)
	}
	if shouldAutoConnect(false, prefs, true) {
		t.Fatal("an explicit disconnect must stay down across boots")
	}
	if err := recordTakeoverIntent(takeoverIntentConnected); err != nil {
		t.Fatal(err)
	}
	if !shouldAutoConnect(false, prefs, true) {
		t.Fatal("a recorded connection must restore on boot")
	}

	if err := os.WriteFile(paths.TakeoverIntentPath(), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !shouldAutoConnect(false, prefs, true) {
		t.Fatal("an unreadable record carries no objection")
	}
}

// The LocalAPI endpoints are the only writers of the intent: shutdown and
// stop tear the runtime down without expressing a disconnect, which is what
// lets a reboot restore the connection.
func TestUpDownEndpointsRecordExplicitIntentButShutdownDoesNot(t *testing.T) {
	f := newRuntimeFixture(t)
	server := &Server{subMgr: f.subs, runtime: f.controller, engineMgr: engine.NewManager(100)}

	if response := runtimeRequest(server.handleDown, ""); response.Code != http.StatusOK {
		t.Fatalf("down failed: %d %s", response.Code, response.Body)
	}
	if intent, err := loadTakeoverIntent(); err != nil || intent != takeoverIntentDisconnected {
		t.Fatalf("explicit down did not record the disconnect: %s %v", intent, err)
	}

	if response := runtimeRequest(server.handleUp, ""); response.Code != http.StatusOK {
		t.Fatalf("up failed: %d %s", response.Code, response.Body)
	}
	if intent, err := loadTakeoverIntent(); err != nil || intent != takeoverIntentConnected {
		t.Fatalf("explicit up did not record the connection: %s %v", intent, err)
	}

	shutdown := &Server{
		subMgr:          f.subs,
		runtime:         f.controller,
		engineMgr:       engine.NewManager(100),
		shutdownCh:      make(chan struct{}),
		cancelLifecycle: func() {},
	}
	if response := runtimeRequest(shutdown.handleShutdown, ""); response.Code != http.StatusOK {
		t.Fatalf("shutdown failed: %d %s", response.Code, response.Body)
	}
	if intent, err := loadTakeoverIntent(); err != nil || intent != takeoverIntentConnected {
		t.Fatalf("shutdown cleanup overwrote the explicit intent: %s %v", intent, err)
	}
}

// A fresh idle fixture: manager with one active subscription, a stopped
// fake core, and takeover mode that never touches host proxy settings.
func newIdleAutoConnectFixture(t *testing.T) (*Server, *testRuntimeCore) {
	t.Helper()
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := sub.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(paths.DataDir(), "active.yaml")
	fixture := "proxies:\n  - name: active\n    type: trojan\n    server: example.invalid\n    port: 443\n    password: fixture-only\n"
	if err := os.WriteFile(source, []byte(fixture), 0o600); err != nil {
		t.Fatal(err)
	}
	meta, err := manager.AddUniversal(source, "active", 24, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Update(t.Context(), meta.ID, true, ""); err != nil {
		t.Fatal(err)
	}
	core := &testRuntimeCore{}
	prefs := DefaultPreferences()
	prefs.TakeoverMode = engine.ModePort
	controller := newRuntimeController(core, manager, prefs)
	controller.proxyGet = func() (sysproxy.Snapshot, error) {
		t.Fatal("unexpected host proxy read")
		return sysproxy.Snapshot{}, nil
	}
	controller.proxySet = func(string, string) error { t.Fatal("unexpected host proxy change"); return nil }
	controller.proxyRestore = func(sysproxy.Snapshot) error { t.Fatal("unexpected host proxy restore"); return nil }
	server := &Server{
		engineMgr: engine.NewManager(100),
		subMgr:    manager,
		runtime:   controller,
	}
	return server, core
}

// shortenAutoConnectRetries collapses the retry wait to run the loop fast
// and deterministically; tests that assert exact attempt counts override the
// bound through the returned setter. Cleanup always restores the originals.
func shortenAutoConnectRetries(t *testing.T) (setAttempts func(int)) {
	t.Helper()
	attempts, delay := autoConnectAttempts, autoConnectRetryDelay
	autoConnectRetryDelay = time.Millisecond
	t.Cleanup(func() {
		autoConnectAttempts, autoConnectRetryDelay = attempts, delay
	})
	return func(n int) { autoConnectAttempts = n }
}

// A transient startup failure retries and restores; the retry bound keeps a
// persistent failure from looping forever, leaving the daemon honestly down.
func TestAutoConnectRetriesThenRestoresOrGivesUp(t *testing.T) {
	setAttempts := shortenAutoConnectRetries(t)

	server, core := newIdleAutoConnectFixture(t)
	core.failReloads = 1
	server.autoConnectActive(t.Context())
	if !core.IsRunning() {
		t.Fatal("auto-connect gave up after one transient failure")
	}
	if core.reloads != 2 {
		t.Fatalf("expected a failed attempt plus a successful retry, got %d reloads", core.reloads)
	}

	server, core = newIdleAutoConnectFixture(t)
	core.failReloads = 100
	setAttempts(2)
	server.autoConnectActive(t.Context())
	if core.IsRunning() {
		t.Fatal("persistent failure must not report a running core")
	}
	if core.reloads != 2 {
		t.Fatalf("expected the retry bound to hold, got %d reloads", core.reloads)
	}
}

// The retry loop must never fight an explicit disconnect recorded while it
// is pending, and a disconnect before startup blocks the loop entirely.
func TestAutoConnectRespectsExplicitDisconnect(t *testing.T) {
	setAttempts := shortenAutoConnectRetries(t)

	server, core := newIdleAutoConnectFixture(t)
	if err := recordTakeoverIntent(takeoverIntentDisconnected); err != nil {
		t.Fatal(err)
	}
	server.autoConnectActive(t.Context())
	if core.IsRunning() || core.reloads != 0 {
		t.Fatal("auto-connect ran despite an explicit disconnect")
	}

	// A retry pending after a failed attempt aborts as soon as the record
	// says the user disconnected. The bound (50) outlasts the sleep, so an
	// early return can only be the recorded disconnect.
	server, core = newIdleAutoConnectFixture(t)
	core.failReloads = 100
	setAttempts(50)
	done := make(chan struct{})
	go func() {
		defer close(done)
		server.autoConnectActive(t.Context())
	}()
	time.Sleep(20 * time.Millisecond)
	if err := recordTakeoverIntent(takeoverIntentDisconnected); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("a recorded disconnect did not stop the retry loop")
	}
	if core.IsRunning() || core.reloads >= 50 {
		t.Fatal("the recorded disconnect did not abort the retry loop")
	}
}
