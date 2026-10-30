package daemon

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/platform/sysproxy"
	"github.com/openxbond/xbond/internal/sub"
)

type testRuntimeCore struct {
	mu          sync.Mutex
	running     bool
	config      []byte
	reloadError error
	stopError   error
	onReload    func()
}

func (c *testRuntimeCore) IsRunning() bool { c.mu.Lock(); defer c.mu.Unlock(); return c.running }
func (c *testRuntimeCore) Reload(config []byte, _ map[string]string) error {
	if c.onReload != nil {
		c.onReload()
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.reloadError != nil {
		err := c.reloadError
		c.reloadError = nil
		return err
	}
	c.running = true
	c.config = append([]byte(nil), config...)
	return nil
}
func (c *testRuntimeCore) Stop() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.stopError != nil {
		return c.stopError
	}
	c.running = false
	return nil
}
func (c *testRuntimeCore) configuration() []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]byte(nil), c.config...)
}

type runtimeFixture struct {
	controller    *runtimeController
	core          *testRuntimeCore
	subs          *sub.Manager
	first, second *sub.SubscriptionMeta
	firstSource   string
}

func newRuntimeFixture(t *testing.T) runtimeFixture {
	t.Helper()
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := sub.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	add := func(name string, active bool) (*sub.SubscriptionMeta, string) {
		source := filepath.Join(paths.DataDir(), name+".json")
		if err := os.WriteFile(source, []byte(fmt.Sprintf(`{"outbounds":[{"type":"direct","tag":%q}]}`, name)), 0o600); err != nil {
			t.Fatal(err)
		}
		meta, err := manager.AddUniversal(source, name, 24, active)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := manager.Update(meta.ID, true, false, 0); err != nil {
			t.Fatal(err)
		}
		return meta, source
	}
	first, source := add("first", true)
	second, _ := add("second", false)
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
	if err := controller.Up(context.Background(), runtimeOptions{}); err != nil {
		t.Fatal(err)
	}
	return runtimeFixture{controller, core, manager, first, second, source}
}
func readRuntimeFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func assertRuntimeUnchanged(t *testing.T, f runtimeFixture, prefs RuntimePreferences, config, preferencesFile []byte) {
	t.Helper()
	if f.controller.Preferences() != prefs {
		t.Fatal("failed operation published new preferences")
	}
	if f.subs.ActiveID() != f.first.ID {
		t.Fatal("failed operation activated the replacement subscription")
	}
	if !f.core.IsRunning() || !bytes.Equal(config, f.core.configuration()) {
		t.Fatal("previous running configuration was not restored")
	}
	if !bytes.Equal(config, readRuntimeFile(t, paths.SubRuntimePath(f.first.ID))) {
		t.Fatal("last working runtime file changed")
	}
	if !bytes.Equal(preferencesFile, readRuntimeFile(t, paths.RuntimeStatePath())) {
		t.Fatal("last working preferences file changed")
	}
}

func TestRuntimeInvalidConfigurationAndReloadFailureKeepLastWorkingState(t *testing.T) {
	for _, failure := range []string{"invalid-source", "reload", "invalid-mode"} {
		t.Run(failure, func(t *testing.T) {
			f := newRuntimeFixture(t)
			before := f.controller.Preferences()
			config := f.core.configuration()
			preferencesFile := readRuntimeFile(t, paths.RuntimeStatePath())
			options := runtimeOptions{SubID: f.second.ID, Routing: engine.RoutingGlobal, Port: 17891}
			switch failure {
			case "invalid-source":
				if err := os.WriteFile(paths.SubSourcePath(f.second.ID), []byte("{"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "reload":
				f.core.reloadError = errors.New("injected core start failure")
			case "invalid-mode":
				options.Mode = "unsupported"
			}
			if err := f.controller.Up(context.Background(), options); err == nil {
				t.Fatal("expected apply to fail")
			}
			assertRuntimeUnchanged(t, f, before, config, preferencesFile)
			if _, err := os.Stat(paths.SubRuntimePath(f.second.ID)); !errors.Is(err, fs.ErrNotExist) {
				t.Fatal("failed apply left a replacement runtime file")
			}
		})
	}
}

func TestRuntimePersistenceFailureRollsBackCoreFilesAndActiveSubscription(t *testing.T) {
	for _, failure := range []string{"runtime-file", "preferences-file", "active-subscription"} {
		t.Run(failure, func(t *testing.T) {
			f := newRuntimeFixture(t)
			before := f.controller.Preferences()
			config := f.core.configuration()
			preferencesFile := readRuntimeFile(t, paths.RuntimeStatePath())
			target := paths.SubRuntimePath(f.second.ID)
			if failure == "active-subscription" {
				if err := os.Remove(paths.SubListPath()); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(paths.SubListPath(), 0o700); err != nil {
					t.Fatal(err)
				}
			} else {
				failedPath := target
				if failure == "preferences-file" {
					failedPath = paths.RuntimeStatePath()
				}
				failOnce := true
				f.controller.write = func(name string, data []byte, mode fs.FileMode) error {
					if name == failedPath && failOnce {
						failOnce = false
						return errors.New("injected write failure")
					}
					return atomicfile.Write(name, data, mode)
				}
			}
			if err := f.controller.Use(context.Background(), f.second.ID); err == nil {
				t.Fatal("expected persistence failure")
			}
			assertRuntimeUnchanged(t, f, before, config, preferencesFile)
			if _, err := os.Stat(target); !errors.Is(err, fs.ErrNotExist) {
				t.Fatal("failed apply left the new subscription runtime file")
			}
		})
	}
}

func TestRuntimeProxyFailureRestoresActualProxyAndReportsRecoveryFailure(t *testing.T) {
	for _, recoveryFails := range []bool{false, true} {
		t.Run(fmt.Sprint(recoveryFails), func(t *testing.T) {
			f := newRuntimeFixture(t)
			before := f.controller.Preferences()
			config := f.core.configuration()
			preferencesFile := readRuntimeFile(t, paths.RuntimeStatePath())
			original := sysproxy.Snapshot{Enabled: true, Server: "existing-proxy:8080", Bypass: "example.test"}
			current := original
			f.controller.proxyGet = func() (sysproxy.Snapshot, error) { return current, nil }
			f.controller.proxySet = func(server, bypass string) error {
				current = sysproxy.Snapshot{Enabled: true, Server: server, Bypass: bypass}
				return errors.New("injected partial proxy failure")
			}
			f.controller.proxyRestore = func(snapshot sysproxy.Snapshot) error {
				if recoveryFails {
					return errors.New("injected proxy recovery failure")
				}
				current = snapshot
				return nil
			}
			err := f.controller.Configure(context.Background(), runtimeOptions{Mode: engine.ModeSysproxy, Routing: engine.RoutingGlobal})
			if err == nil || !strings.Contains(err.Error(), "partial proxy failure") {
				t.Fatalf("missing apply failure: %v", err)
			}
			if recoveryFails {
				if !strings.Contains(err.Error(), "proxy recovery failure") {
					t.Fatal("recovery failure was hidden")
				}
			} else if current != original {
				t.Fatal("original system proxy was not restored")
			}
			assertRuntimeUnchanged(t, f, before, config, preferencesFile)
		})
	}
}

func TestRuntimeOwnsProxyUntilReleasedAndDoesNotClaimFailedStopSucceeded(t *testing.T) {
	f := newRuntimeFixture(t)
	original := sysproxy.Snapshot{Enabled: true, Server: "original-proxy:8080", Bypass: "original.test"}
	current := original
	f.controller.proxyGet = func() (sysproxy.Snapshot, error) { return current, nil }
	f.controller.proxySet = func(server, bypass string) error {
		current = sysproxy.Snapshot{Enabled: true, Server: server, Bypass: bypass}
		return nil
	}
	f.controller.proxyRestore = func(snapshot sysproxy.Snapshot) error { current = snapshot; return nil }
	if err := f.controller.Configure(context.Background(), runtimeOptions{Mode: engine.ModeSysproxy}); err != nil {
		t.Fatal(err)
	}
	if err := f.controller.Configure(context.Background(), runtimeOptions{Port: 17892}); err != nil {
		t.Fatal(err)
	}
	snapshot, err := sysproxy.LoadSnapshot()
	if err != nil || *snapshot != original {
		t.Fatalf("original recovery snapshot was overwritten: %v", err)
	}
	f.core.stopError = errors.New("injected stop failure")
	if _, err := f.controller.Down(); err == nil {
		t.Fatal("stop failure was reported as success")
	}
	if current != original {
		t.Fatal("system proxy was not released")
	}
	f.core.stopError = nil
	stopped, err := f.controller.Down()
	if err != nil || !stopped {
		t.Fatalf("expected a real stop on the second down: stopped=%v err=%v", stopped, err)
	}
	if f.core.IsRunning() {
		t.Fatal("core remains running after successful stop")
	}
}

func TestRuntimeUpdateFailureRetriesCachedConfigurationOnManualOrScheduledUpdate(t *testing.T) {
	for _, retry := range []string{"manual", "scheduled"} {
		t.Run(retry, func(t *testing.T) {
			f := newRuntimeFixture(t)
			before := f.core.configuration()
			updated := []byte(`{"outbounds":[{"type":"direct","tag":"updated"}]}`)
			if err := os.WriteFile(f.firstSource, updated, 0o600); err != nil {
				t.Fatal(err)
			}
			f.core.reloadError = errors.New("injected update reload failure")
			if _, err := f.controller.Update(context.Background(), f.first.ID, true, false); err == nil {
				t.Fatal("update reload failure was hidden")
			}
			if !bytes.Equal(before, f.core.configuration()) {
				t.Fatal("failed update replaced the running core")
			}
			if retry == "scheduled" {
				if err := os.WriteFile(f.firstSource, []byte("{"), 0o600); err != nil {
					t.Fatal(err)
				}
				if err := f.controller.UpdateDue(context.Background(), time.Now()); err != nil {
					t.Fatal(err)
				}
			} else {
				result, err := f.controller.Update(context.Background(), f.first.ID, false, false)
				if err != nil {
					t.Fatal(err)
				}
				if result.ContentChanged {
					t.Fatal("expected unchanged downloaded content on retry")
				}
			}
			if !bytes.Contains(f.core.configuration(), []byte("updated")) {
				t.Fatal("cached candidate was not applied after retry")
			}
			if !bytes.Equal(f.core.configuration(), readRuntimeFile(t, paths.SubRuntimePath(f.first.ID))) {
				t.Fatal("applied runtime file differs from running core")
			}
		})
	}
}

func TestRuntimeCancellationAfterCoreReloadRestoresPreviousState(t *testing.T) {
	f := newRuntimeFixture(t)
	before := f.controller.Preferences()
	config := f.core.configuration()
	preferencesFile := readRuntimeFile(t, paths.RuntimeStatePath())
	ctx, cancel := context.WithCancel(context.Background())
	f.core.onReload = cancel
	err := f.controller.Configure(ctx, runtimeOptions{Routing: engine.RoutingGlobal})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation: %v", err)
	}
	assertRuntimeUnchanged(t, f, before, config, preferencesFile)
}

func TestRuntimeConcurrentApplyAndStopAreSerialized(t *testing.T) {
	f := newRuntimeFixture(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	f.core.onReload = func() { once.Do(func() { close(entered); <-release }) }
	applied := make(chan error, 1)
	go func() {
		applied <- f.controller.Configure(context.Background(), runtimeOptions{Routing: engine.RoutingGlobal})
	}()
	<-entered
	stopped := make(chan error, 1)
	go func() { _, err := f.controller.Down(); stopped <- err }()
	select {
	case <-stopped:
		close(release)
		t.Fatal("stop raced an in-flight apply")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	if err := <-applied; err != nil {
		t.Fatal(err)
	}
	if err := <-stopped; err != nil {
		t.Fatal(err)
	}
	if f.core.IsRunning() {
		t.Fatal("serialized stop did not take effect")
	}
}

func TestRuntimeRemovalStopsActiveCoreAndPreservesSubscriptionWhenStopFails(t *testing.T) {
	f := newRuntimeFixture(t)
	f.core.stopError = errors.New("injected stop failure")
	if err := f.controller.Remove(f.first.ID); err == nil {
		t.Fatal("removal hid the failed stop")
	}
	if _, err := f.subs.Get(f.first.ID); err != nil {
		t.Fatal("subscription was removed before the core stopped")
	}
	f.core.stopError = nil
	if err := f.controller.Remove(f.first.ID); err != nil {
		t.Fatal(err)
	}
	if f.core.IsRunning() || f.subs.ActiveID() != f.second.ID {
		t.Fatal("removal did not leave a stopped core and the remaining subscription")
	}
	if _, err := os.Stat(paths.SubDir(f.first.ID)); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("removed subscription data still exists")
	}
}

func TestRuntimeFileFailureIncludesCoreRecoveryFailure(t *testing.T) {
	f := newRuntimeFixture(t)
	f.controller.write = func(name string, data []byte, mode fs.FileMode) error {
		if name == paths.RuntimeStatePath() {
			f.core.reloadError = errors.New("injected core recovery failure")
			return errors.New("injected preferences write failure")
		}
		return atomicfile.Write(name, data, mode)
	}
	err := f.controller.Configure(context.Background(), runtimeOptions{Routing: engine.RoutingGlobal})
	if err == nil || !strings.Contains(err.Error(), "preferences write failure") || !strings.Contains(err.Error(), "core recovery failure") {
		t.Fatalf("apply or recovery error was hidden: %v", err)
	}
}
