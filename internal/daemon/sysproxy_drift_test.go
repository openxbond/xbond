package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/platform/sysproxy"
)

// driftFixture enables system-proxy takeover on the standard fixture with
// recording fakes: `current` mirrors the host state proxySet writes, and the
// counters prove which host operations a path performed.
type driftFixture struct {
	runtimeFixture
	original    sysproxy.Snapshot
	current     sysproxy.Snapshot
	sets        []string
	restores    int
	readErr     error
	mixedPort   int
	oursAddress string
}

func newDriftFixture(t *testing.T) *driftFixture {
	t.Helper()
	f := &driftFixture{
		runtimeFixture: newRuntimeFixture(t),
		original:       sysproxy.Snapshot{Enabled: true, Server: "original-proxy:8080", Bypass: "original.test"},
	}
	f.current = f.original
	f.controller.proxyGet = func() (sysproxy.Snapshot, error) {
		if f.readErr != nil {
			return sysproxy.Snapshot{}, f.readErr
		}
		return f.current, nil
	}
	f.controller.proxySet = func(server, bypass string) error {
		f.sets = append(f.sets, server)
		f.current = sysproxy.Snapshot{Enabled: true, Server: server, Bypass: bypass}
		return nil
	}
	f.controller.proxyRestore = func(snapshot sysproxy.Snapshot) error {
		f.restores++
		f.current = snapshot
		return nil
	}
	if err := f.controller.Configure(context.Background(), runtimeOptions{Mode: engine.ModeSysproxy}); err != nil {
		t.Fatal(err)
	}
	f.mixedPort = f.controller.Preferences().MixedPort
	f.oursAddress = fmt.Sprintf("127.0.0.1:%d", f.mixedPort)
	return f
}

// The drift judgment keeps intent, ownership and the live host state apart:
// only an owned takeover can drift, a failed host read stays "unknown"
// instead of passing as "off", and a host proxy pointing elsewhere is
// reported rather than merged into success.
func TestSystemProxyDriftJudgesOwnershipAgainstHostState(t *testing.T) {
	t.Run("matching host state is not drift", func(t *testing.T) {
		f := newDriftFixture(t)
		f.current = sysproxy.Snapshot{Enabled: true, Server: f.oursAddress}
		drift := f.controller.SystemProxyDrift(f.current, nil)
		if drift.Drifted || drift.ReasonCode != "" {
			t.Fatalf("our own listener reported as drift: %+v", drift)
		}
		if !drift.Known || !drift.ActualEnabled || drift.ActualServer != f.oursAddress {
			t.Fatalf("host facts missing from drift status: %+v", drift)
		}
		if !drift.Intent || !drift.Owned {
			t.Fatalf("intent and ownership lost from drift status: %+v", drift)
		}
	})
	t.Run("externally disabled host proxy drifts", func(t *testing.T) {
		f := newDriftFixture(t)
		f.current = sysproxy.Snapshot{}
		drift := f.controller.SystemProxyDrift(f.current, nil)
		if !drift.Drifted || drift.ReasonCode != DriftExternalOff {
			t.Fatalf("external off not reported: %+v", drift)
		}
	})
	t.Run("host proxy pointing elsewhere drifts", func(t *testing.T) {
		f := newDriftFixture(t)
		f.current = sysproxy.Snapshot{Enabled: true, Server: "127.0.0.1:17890"}
		drift := f.controller.SystemProxyDrift(f.current, nil)
		if !drift.Drifted || drift.ReasonCode != DriftExternalOverride {
			t.Fatalf("external override not reported: %+v", drift)
		}
	})
	t.Run("nested port digits are not ours", func(t *testing.T) {
		f := newDriftFixture(t)
		f.current = sysproxy.Snapshot{Enabled: true, Server: fmt.Sprintf("127.0.0.1:%d0", f.mixedPort)}
		drift := f.controller.SystemProxyDrift(f.current, nil)
		if !drift.Drifted || drift.ReasonCode != DriftExternalOverride {
			t.Fatalf("nested port read as our listener: %+v", drift)
		}
	})
	t.Run("failed host read stays unknown", func(t *testing.T) {
		f := newDriftFixture(t)
		drift := f.controller.SystemProxyDrift(sysproxy.Snapshot{}, errors.New("gsettings unavailable"))
		if !drift.Drifted || drift.ReasonCode != DriftReadError {
			t.Fatalf("read failure while owned not reported: %+v", drift)
		}
		if drift.Known || drift.ActualEnabled || drift.ActualServer != "" {
			t.Fatalf("failed read passed as a known host state: %+v", drift)
		}
	})
	t.Run("host settings without ownership are not ours to judge", func(t *testing.T) {
		f := newDriftFixture(t)
		f.controller.originalProxy = nil
		f.current = sysproxy.Snapshot{}
		drift := f.controller.SystemProxyDrift(f.current, nil)
		if drift.Drifted || drift.Owned || drift.Intent != f.controller.Preferences().SystemProxy {
			t.Fatalf("foreign host settings reported as drift: %+v", drift)
		}
		drift = f.controller.SystemProxyDrift(sysproxy.Snapshot{}, errors.New("gsettings unavailable"))
		if drift.Drifted || drift.Known {
			t.Fatalf("foreign host read failure reported as drift: %+v", drift)
		}
	})
}

// The status endpoint carries the drift facts; light=1 skips the host read
// entirely like it skips the network evaluation.
func TestStatusReportsSystemProxyDrift(t *testing.T) {
	f := newDriftFixture(t)
	f.current = sysproxy.Snapshot{}
	server := &Server{
		engineMgr: engine.NewManager(100),
		subMgr:    f.subs,
		runtime:   f.controller,
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/localapi/v0/status", nil)
	server.authMiddleware(server.handleStatus)(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status failed: %d %s", recorder.Code, recorder.Body)
	}
	var payload struct {
		Drift SystemProxyDriftStatus `json:"systemProxyDrift"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Drift.Drifted || payload.Drift.ReasonCode != DriftExternalOff || !payload.Drift.Owned {
		t.Fatalf("status hid the external off: %+v", payload.Drift)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/localapi/v0/status?light=1", nil)
	server.authMiddleware(server.handleStatus)(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("light status failed: %d %s", recorder.Code, recorder.Body)
	}
	payload = struct {
		Drift SystemProxyDriftStatus `json:"systemProxyDrift"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Drift.Drifted || payload.Drift.Known {
		t.Fatalf("light status sampled the host proxy: %+v", payload.Drift)
	}
}

// Reassert rewrites our listener address without bouncing the core and
// keeps the user's restore point; a takeover whose ownership this process
// never established adopts the current host state as the new restore point.
func TestReassertSystemProxyRewritesOursAndKeepsRestorePoint(t *testing.T) {
	t.Run("owned takeover", func(t *testing.T) {
		f := newDriftFixture(t)
		baseline := len(f.sets)
		f.current = sysproxy.Snapshot{Enabled: true, Server: "127.0.0.1:17890"}
		if err := f.controller.ReassertSystemProxy(); err != nil {
			t.Fatal(err)
		}
		if len(f.sets) != baseline+1 || f.sets[baseline] != f.oursAddress {
			t.Fatalf("reassert wrote the wrong address: %v", f.sets)
		}
		if f.current.Server != f.oursAddress {
			t.Fatalf("host proxy not reasserted: %+v", f.current)
		}
		snapshot, err := sysproxy.LoadSnapshot()
		if err != nil || *snapshot != f.original {
			t.Fatalf("user restore point was replaced by the external state: %v", err)
		}
		drift := f.controller.SystemProxyDrift(f.current, nil)
		if drift.Drifted {
			t.Fatalf("reassert left drift behind: %+v", drift)
		}
		if !f.core.IsRunning() {
			t.Fatal("reassert bounced the running core")
		}
	})
	t.Run("ownership after restart is adopted", func(t *testing.T) {
		f := newDriftFixture(t)
		baseline := len(f.sets)
		// A daemon restart restores the snapshot and forgets ownership; the
		// next reassert must capture the live host state before overwriting.
		f.controller.originalProxy = nil
		if err := os.Remove(paths.SysproxySnapshotPath()); err != nil {
			t.Fatal(err)
		}
		f.current = sysproxy.Snapshot{Enabled: true, Server: "user-own-proxy:3128"}
		if err := f.controller.ReassertSystemProxy(); err != nil {
			t.Fatal(err)
		}
		if len(f.sets) != baseline+1 || f.sets[baseline] != f.oursAddress {
			t.Fatalf("reassert wrote the wrong address: %v", f.sets)
		}
		snapshot, err := sysproxy.LoadSnapshot()
		if err != nil || snapshot.Server != "user-own-proxy:3128" {
			t.Fatalf("adopted snapshot is not the pre-reassert host state: %v", err)
		}
	})
	t.Run("unreadable host server refuses to take over", func(t *testing.T) {
		f := newDriftFixture(t)
		baseline := len(f.sets)
		f.controller.originalProxy = nil
		f.current = sysproxy.Snapshot{Enabled: true}
		if err := f.controller.ReassertSystemProxy(); err == nil || !strings.Contains(err.Error(), "capture the current system proxy server") {
			t.Fatalf("enabled host proxy without a server was clobbered: %v", err)
		}
		if len(f.sets) != baseline {
			t.Fatalf("refused reassert still wrote the host proxy: %v", f.sets)
		}
	})
	t.Run("requires intent and a running core", func(t *testing.T) {
		f := newDriftFixture(t)
		baseline := len(f.sets)
		if _, err := f.controller.Down(); err != nil {
			t.Fatal(err)
		}
		if err := f.controller.ReassertSystemProxy(); err == nil || !strings.Contains(err.Error(), "core is not running") {
			t.Fatalf("reassert pointed the host proxy at a dead port: %v", err)
		}
		if len(f.sets) != baseline {
			t.Fatalf("rejected reassert wrote the host proxy: %v", f.sets)
		}
	})
}

// Release drops the claim and the restore point but never writes the host
// settings: whatever the external change left in place stays as its owner
// wrote it, and a later down has nothing left to restore either.
func TestReleaseSystemProxyKeepsHostSettingsAndDropsRestore(t *testing.T) {
	f := newDriftFixture(t)
	external := sysproxy.Snapshot{Enabled: true, Server: "other-client:7891"}
	f.current = external

	if err := f.controller.ReleaseSystemProxy(); err != nil {
		t.Fatal(err)
	}
	if f.current != external {
		t.Fatalf("release rewrote the host proxy: %+v", f.current)
	}
	if f.restores != 0 {
		t.Fatalf("release restored the captured snapshot (%d restores)", f.restores)
	}
	if _, err := sysproxy.LoadSnapshot(); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("release kept the recovery snapshot: %v", err)
	}
	prefs := f.controller.Preferences()
	if prefs.SystemProxy || prefs.TakeoverMode != engine.ModePort {
		t.Fatalf("release kept the takeover intent: %+v", prefs)
	}
	if !f.core.IsRunning() {
		t.Fatal("release stopped the running core")
	}

	// The claim is gone: a later down must not restore either.
	if _, err := f.controller.Down(); err != nil {
		t.Fatal(err)
	}
	if f.restores != 0 || f.current != external {
		t.Fatalf("down after release touched the host proxy: %+v", f.current)
	}

	// Release is idempotent.
	if err := f.controller.ReleaseSystemProxy(); err != nil {
		t.Fatalf("second release failed: %v", err)
	}
}
