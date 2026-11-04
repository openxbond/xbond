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
	// hotRouting makes SetRoutingMode succeed; otherwise it reports failure
	// so the controller falls back to a full Reload.
	hotRouting bool
	reloads    int
	hotModes   []engine.RoutingMode
}

func (c *testRuntimeCore) IsRunning() bool { c.mu.Lock(); defer c.mu.Unlock(); return c.running }
func (c *testRuntimeCore) SetRoutingMode(mode engine.RoutingMode, config []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.hotRouting {
		return errors.New("hot routing unsupported")
	}
	c.hotModes = append(c.hotModes, mode)
	c.config = append([]byte(nil), config...)
	return nil
}
func (c *testRuntimeCore) Reload(config []byte, _ map[string]string) error {
	if c.onReload != nil {
		c.onReload()
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reloads++
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
		source := filepath.Join(paths.DataDir(), name+".yaml")
		fixture := fmt.Sprintf("proxies:\n  - name: %s\n    type: trojan\n    server: example.invalid\n    port: 443\n    password: fixture-only\n", name)
		if err := os.WriteFile(source, []byte(fixture), 0o600); err != nil {
			t.Fatal(err)
		}
		meta, err := manager.AddUniversal(source, name, 24, active)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := manager.Update(meta.ID, true, ""); err != nil {
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

func intPtr(v int) *int { return &v }

func TestUseStoppedCoreRejectsInvalidConfiguration(t *testing.T) {
	f := newRuntimeFixture(t)
	if _, err := f.controller.Down(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.SubSourcePath(f.second.ID), []byte("invalid configuration"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := f.controller.Use(context.Background(), f.second.ID); err == nil {
		t.Fatal("using an invalid configuration reported success while the core was stopped")
	}
	if f.subs.ActiveID() != f.first.ID || f.core.IsRunning() {
		t.Fatal("failed selection changed the active configuration or started the core")
	}
}

// The mixed port follows the subscription's own port unless the user fixed
// it locally: the subscription port beats the daemon default, an explicit
// override beats both, clearing the override returns to following, and a
// subscription port colliding with the controller port fails loudly.
func TestRuntimeMixedPortFollowsSubscriptionAndOverrideWins(t *testing.T) {
	f := newRuntimeFixture(t)
	portAndSource := func() (int, PortSource) {
		prefs := f.controller.Preferences()
		return prefs.MixedPort, prefs.PortSource
	}
	writeSource := func(port int) {
		t.Helper()
		content := fmt.Sprintf("mixed-port: %d\nproxies:\n  - name: %s\n    type: trojan\n    server: example.invalid\n    port: 443\n    password: fixture-only\n", port, f.first.Name)
		if err := os.WriteFile(paths.SubSourcePath(f.first.ID), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	// The fixture source names no port: the daemon default applies.
	if err := f.controller.Up(context.Background(), runtimeOptions{}); err != nil {
		t.Fatal(err)
	}
	if port, source := portAndSource(); port != defaultMixedPort || source != PortSourceDefault {
		t.Fatalf("expected default port %d (default), got %d (%s)", defaultMixedPort, port, source)
	}

	// The subscription's own mixed-port wins while following.
	writeSource(17897)
	if err := f.controller.Up(context.Background(), runtimeOptions{}); err != nil {
		t.Fatal(err)
	}
	if port, source := portAndSource(); port != 17897 || source != PortSourceSubscription {
		t.Fatalf("expected subscription port 17897, got %d (%s)", port, source)
	}

	// An explicit local override wins over the subscription port.
	if err := f.controller.Configure(context.Background(), runtimeOptions{Port: intPtr(18080)}); err != nil {
		t.Fatal(err)
	}
	if port, source := portAndSource(); port != 18080 || source != PortSourceOverride {
		t.Fatalf("expected override port 18080, got %d (%s)", port, source)
	}
	if prefs := f.controller.Preferences(); prefs.PortOverride != 18080 {
		t.Fatalf("override not persisted: %+v", prefs)
	}

	// Clearing the override returns to following the subscription.
	if err := f.controller.Configure(context.Background(), runtimeOptions{Port: intPtr(0)}); err != nil {
		t.Fatal(err)
	}
	if prefs := f.controller.Preferences(); prefs.PortOverride != 0 {
		t.Fatalf("override not cleared: %+v", prefs)
	}
	if err := f.controller.Up(context.Background(), runtimeOptions{}); err != nil {
		t.Fatal(err)
	}
	if port, source := portAndSource(); port != 17897 || source != PortSourceSubscription {
		t.Fatalf("expected to follow subscription port 17897 again, got %d (%s)", port, source)
	}

	// A subscription port colliding with the controller port fails before
	// the core is touched and keeps the previous working state.
	writeSource(f.controller.Preferences().ClashPort)
	config := f.core.configuration()
	if err := f.controller.Up(context.Background(), runtimeOptions{}); err == nil {
		t.Fatal("a source port colliding with the controller port must fail loudly")
	}
	if port, source := portAndSource(); port != 17897 || source != PortSourceSubscription {
		t.Fatalf("failed apply changed the effective port: %d (%s)", port, source)
	}
	if !f.core.IsRunning() || !bytes.Equal(config, f.core.configuration()) {
		t.Fatal("failed apply touched the running core")
	}
}

func TestRuntimeInvalidConfigurationAndReloadFailureKeepLastWorkingState(t *testing.T) {
	for _, failure := range []string{"invalid-source", "reload", "invalid-mode"} {
		t.Run(failure, func(t *testing.T) {
			f := newRuntimeFixture(t)
			before := f.controller.Preferences()
			config := f.core.configuration()
			preferencesFile := readRuntimeFile(t, paths.RuntimeStatePath())
			options := runtimeOptions{SubID: f.second.ID, Routing: engine.RoutingGlobal, Port: intPtr(17891)}
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
	if err := f.controller.Configure(context.Background(), runtimeOptions{Port: intPtr(17892)}); err != nil {
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
			updated := []byte("proxies:\n  - name: updated\n    type: trojan\n    server: example.invalid\n    port: 443\n    password: fixture-only\n")
			if err := os.WriteFile(f.firstSource, updated, 0o600); err != nil {
				t.Fatal(err)
			}
			f.core.reloadError = errors.New("injected update reload failure")
			if _, err := f.controller.Update(context.Background(), f.first.ID, true, nil); err == nil {
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
				result, err := f.controller.Update(context.Background(), f.first.ID, false, nil)
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

// The local override rides derivation: a saved override lands in the running
// config, and a conflict against a changed upstream fails before the core is
// touched, keeping the previous runtime intact.
func TestRuntimeAppliesOverrideAndConflictKeepsPreviousCore(t *testing.T) {
	f := newRuntimeFixture(t)
	if err := f.controller.Up(context.Background(), runtimeOptions{}); err != nil {
		t.Fatal(err)
	}

	// A valid override lands in the derived config on the next apply.
	if err := f.subs.SetOverride(f.first.ID, &engine.SubscriptionOverride{
		RulesAppend: []string{"DOMAIN,kept.example.invalid," + f.first.Name},
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.controller.Configure(context.Background(), runtimeOptions{}); err != nil {
		t.Fatal(err)
	}
	if config := string(f.core.configuration()); !strings.Contains(config, "DOMAIN,kept.example.invalid,"+f.first.Name) {
		t.Fatalf("override did not reach the running config: %s", config)
	}

	// The upstream drops the referenced node: apply fails before the core is
	// touched and the previous runtime stays intact.
	source := "proxies:\n  - name: other\n    type: trojan\n    server: example.invalid\n    port: 443\n    password: fixture-only\nrules:\n  - MATCH,DIRECT\n"
	if err := os.WriteFile(paths.SubSourcePath(f.first.ID), []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	config := f.core.configuration()
	prefs := f.controller.Preferences()
	if err := f.controller.Up(context.Background(), runtimeOptions{}); err == nil {
		t.Fatal("conflicting override applied successfully")
	}
	if !f.core.IsRunning() || !bytes.Equal(config, f.core.configuration()) || f.controller.Preferences() != prefs {
		t.Fatal("failed apply disturbed the running core or preferences")
	}

	// Clearing the override restores a clean apply.
	if err := f.subs.SetOverride(f.first.ID, &engine.SubscriptionOverride{}); err != nil {
		t.Fatal(err)
	}
	if err := f.controller.Up(context.Background(), runtimeOptions{}); err != nil {
		t.Fatal(err)
	}
	if config := string(f.core.configuration()); strings.Contains(config, "kept.example.invalid") {
		t.Fatal("cleared override still affects the runtime config")
	}
}

func TestRoutingModeSwitchesHotWithoutReload(t *testing.T) {
	f := newRuntimeFixture(t)
	f.core.hotRouting = true
	reloadsBefore := f.core.reloads
	if err := f.controller.Configure(context.Background(), runtimeOptions{Routing: engine.RoutingGlobal}); err != nil {
		t.Fatal(err)
	}
	if f.core.reloads != reloadsBefore {
		t.Fatalf("core reloaded %d times for a routing-only change", f.core.reloads-reloadsBefore)
	}
	if len(f.core.hotModes) != 1 || f.core.hotModes[0] != engine.RoutingGlobal {
		t.Fatalf("hot modes = %v", f.core.hotModes)
	}
	if f.controller.Preferences().RoutingMode != engine.RoutingGlobal {
		t.Fatal("preferences did not record the new routing mode")
	}
	if !bytes.Equal(f.controller.applied, f.core.configuration()) {
		t.Fatal("applied config out of sync with the core")
	}
	// Re-applying the same mode is now a byte-identical no-op.
	if err := f.controller.Up(context.Background(), runtimeOptions{}); err != nil {
		t.Fatal(err)
	}
	if f.core.reloads != reloadsBefore || len(f.core.hotModes) != 1 {
		t.Fatal("repeat apply touched the core")
	}
}

func TestRoutingModeFallsBackToReloadWhenHotSwitchFails(t *testing.T) {
	f := newRuntimeFixture(t)
	reloadsBefore := f.core.reloads
	if err := f.controller.Configure(context.Background(), runtimeOptions{Routing: engine.RoutingDirect}); err != nil {
		t.Fatal(err)
	}
	if f.core.reloads != reloadsBefore+1 {
		t.Fatalf("expected one fallback reload, got %d", f.core.reloads-reloadsBefore)
	}
}
