package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"sync"
	"time"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/platform/sysproxy"
	"github.com/openxbond/xbond/internal/sub"
)

type runtimeEngine interface {
	IsRunning() bool
	Reload([]byte, map[string]string) error
	Stop() error
}

type runtimeInputError struct{ cause error }

func (e *runtimeInputError) Error() string { return e.cause.Error() }
func (e *runtimeInputError) Unwrap() error { return e.cause }

type runtimeOptions struct {
	Mode     engine.TakeoverMode `json:"mode"`
	Routing  engine.RoutingMode  `json:"routing"`
	Port     int                 `json:"port"`
	AllowLan *bool               `json:"allowLan"`
	SubID    string              `json:"subId"`
}

type runtimeController struct {
	mu            sync.Mutex
	stateMu       sync.RWMutex
	prefs         RuntimePreferences
	engine        runtimeEngine
	subs          *sub.Manager
	applied       []byte
	appliedSubID  string
	pendingApply  bool
	originalProxy *sysproxy.Snapshot
	write         func(string, []byte, fs.FileMode) error
	proxyGet      func() (sysproxy.Snapshot, error)
	proxySet      func(string, string) error
	proxyRestore  func(sysproxy.Snapshot) error
}

func newRuntimeController(core runtimeEngine, subs *sub.Manager, prefs RuntimePreferences) *runtimeController {
	return &runtimeController{
		engine: core, subs: subs, prefs: prefs, write: atomicfile.Write,
		proxyGet: sysproxy.Get, proxySet: sysproxy.Set, proxyRestore: sysproxy.Restore,
	}
}

func validatePreferences(prefs RuntimePreferences) error {
	switch prefs.TakeoverMode {
	case engine.ModeSysproxy, engine.ModeTun, engine.ModePort:
	default:
		return errors.New("invalid takeover mode")
	}
	switch prefs.RoutingMode {
	case engine.RoutingRule, engine.RoutingGlobal, engine.RoutingDirect:
	default:
		return errors.New("invalid routing mode")
	}
	if prefs.MixedPort < 1 || prefs.MixedPort > 65535 || prefs.ClashPort < 1 || prefs.ClashPort > 65535 {
		return errors.New("listener ports must be between 1 and 65535")
	}
	if prefs.MixedPort == prefs.ClashPort {
		return errors.New("proxy and controller ports must differ")
	}
	if prefs.ClashSecret == "" {
		return errors.New("controller secret must not be empty")
	}
	return nil
}

func (c *runtimeController) Preferences() RuntimePreferences {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	return c.prefs
}

func (c *runtimeController) Up(ctx context.Context, options runtimeOptions) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.applyLocked(ctx, options, true)
}

func (c *runtimeController) Configure(ctx context.Context, options runtimeOptions) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.applyLocked(ctx, options, c.engine.IsRunning())
}

func (c *runtimeController) Use(ctx context.Context, id string) error {
	if id == "" {
		return &runtimeInputError{errors.New("missing subscription id")}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.applyLocked(ctx, runtimeOptions{SubID: id}, c.engine.IsRunning())
}

type runtimeFile struct {
	name   string
	data   []byte
	exists bool
}

func captureRuntimeFile(name string) (runtimeFile, error) {
	data, err := os.ReadFile(name)
	if errors.Is(err, fs.ErrNotExist) {
		return runtimeFile{name: name}, nil
	}
	if err != nil {
		return runtimeFile{}, err
	}
	return runtimeFile{name: name, data: data, exists: true}, nil
}

func (c *runtimeController) restoreFile(file runtimeFile) error {
	if file.exists {
		return c.write(file.name, file.data, 0o600)
	}
	if err := os.Remove(file.name); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

func (c *runtimeController) applyLocked(ctx context.Context, options runtimeOptions, run bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	previousPrefs := c.Preferences()
	next := previousPrefs
	if options.Mode != "" {
		next.TakeoverMode = options.Mode
	}
	if options.Routing != "" {
		next.RoutingMode = options.Routing
	}
	if options.Port != 0 {
		next.MixedPort = options.Port
	}
	if options.AllowLan != nil {
		next.AllowLan = *options.AllowLan
	}
	if err := validatePreferences(next); err != nil {
		return &runtimeInputError{err}
	}
	targetID := c.subs.ActiveID()
	var selected *sub.SubscriptionMeta
	if options.SubID != "" {
		meta, err := c.subs.Get(options.SubID)
		if err != nil {
			return &runtimeInputError{err}
		}
		selected, targetID = meta, meta.ID
	}

	var runtimeJSON []byte
	if run {
		if targetID == "" {
			return &runtimeInputError{errors.New("no active subscription; please login or add a subscription first")}
		}
		if selected == nil {
			var err error
			selected, err = c.subs.Get(targetID)
			if err != nil {
				return err
			}
		}
		source, err := os.ReadFile(paths.SubSourcePath(targetID))
		if errors.Is(err, fs.ErrNotExist) {
			if _, updateErr := c.subs.Update(targetID, true, false, 0); updateErr != nil {
				return fmt.Errorf("active subscription has no downloaded config and refresh failed: %w", updateErr)
			}
			source, err = os.ReadFile(paths.SubSourcePath(targetID))
		}
		if err != nil {
			return fmt.Errorf("read source configuration: %w", err)
		}
		runtimeJSON, err = engine.DeriveRuntimeConfig(source, next.TakeoverMode, next.RoutingMode, next.MixedPort, next.AllowLan, next.ClashPort, next.ClashSecret)
		if err != nil {
			return fmt.Errorf("derive runtime configuration: %w", err)
		}
		if err := engine.Validate(runtimeJSON); err != nil {
			return fmt.Errorf("validate runtime configuration: %w", err)
		}
	}
	prefsJSON, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	prefsFile, err := captureRuntimeFile(paths.RuntimeStatePath())
	if err != nil {
		return fmt.Errorf("read previous preferences: %w", err)
	}
	var runtimeFileBefore runtimeFile
	if run {
		runtimeFileBefore, err = captureRuntimeFile(paths.SubRuntimePath(targetID))
		if err != nil {
			return fmt.Errorf("read previous runtime configuration: %w", err)
		}
	}

	proxyTouched := run && (next.TakeoverMode == engine.ModeSysproxy || c.originalProxy != nil)
	var beforeProxy sysproxy.Snapshot
	var proxyFile runtimeFile
	if proxyTouched {
		beforeProxy, err = c.proxyGet()
		if err != nil {
			return fmt.Errorf("read system proxy: %w", err)
		}
		if beforeProxy.Enabled && beforeProxy.Server == "" {
			return errors.New("cannot capture the current system proxy server")
		}
		proxyFile, err = captureRuntimeFile(paths.SysproxySnapshotPath())
		if err != nil {
			return fmt.Errorf("read previous system proxy recovery state: %w", err)
		}
	}

	wasRunning := c.engine.IsRunning()
	previousRuntime := append([]byte(nil), c.applied...)
	previousID := c.appliedSubID
	var previousSelections map[string]string
	if wasRunning && previousID != "" {
		if meta, err := c.subs.Get(previousID); err == nil {
			previousSelections = meta.SavedSelections
		}
	}
	var written []runtimeFile
	rollback := func(cause error) error {
		problems := []error{cause}
		if proxyTouched {
			if err := c.proxyRestore(beforeProxy); err != nil {
				problems = append(problems, fmt.Errorf("restore system proxy: %w", err))
			}
		}
		if run {
			var restoreErr error
			if wasRunning {
				restoreErr = c.engine.Reload(previousRuntime, previousSelections)
			} else {
				restoreErr = c.engine.Stop()
			}
			if restoreErr != nil {
				problems = append(problems, fmt.Errorf("restore previous core: %w", restoreErr))
			}
		}
		for i := len(written) - 1; i >= 0; i-- {
			if err := c.restoreFile(written[i]); err != nil {
				problems = append(problems, fmt.Errorf("restore previous file: %w", err))
			}
		}
		if proxyTouched {
			if err := c.restoreFile(proxyFile); err != nil {
				problems = append(problems, fmt.Errorf("restore system proxy recovery state: %w", err))
			}
		}
		return errors.Join(problems...)
	}

	if run {
		if err := c.engine.Reload(runtimeJSON, selected.SavedSelections); err != nil {
			return fmt.Errorf("apply runtime configuration: %w", err)
		}
	}
	originalProxy := c.originalProxy
	if proxyTouched {
		if next.TakeoverMode == engine.ModeSysproxy {
			if originalProxy == nil {
				snapshot := beforeProxy
				originalProxy = &snapshot
			}
			if err := c.proxySet(fmt.Sprintf("127.0.0.1:%d", next.MixedPort), ""); err != nil {
				return rollback(fmt.Errorf("apply system proxy: %w", err))
			}
			snapshotJSON, err := json.Marshal(originalProxy)
			if err != nil {
				return rollback(err)
			}
			if err := c.write(paths.SysproxySnapshotPath(), snapshotJSON, 0o600); err != nil {
				return rollback(fmt.Errorf("save system proxy recovery state: %w", err))
			}
		} else {
			if err := c.proxyRestore(*originalProxy); err != nil {
				return rollback(fmt.Errorf("release system proxy: %w", err))
			}
			if err := os.Remove(paths.SysproxySnapshotPath()); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return rollback(err)
			}
			originalProxy = nil
		}
	}
	if err := ctx.Err(); err != nil {
		return rollback(err)
	}
	if run {
		if err := c.write(paths.SubRuntimePath(targetID), runtimeJSON, 0o600); err != nil {
			return rollback(fmt.Errorf("save runtime configuration: %w", err))
		}
		written = append(written, runtimeFileBefore)
	}
	if err := c.write(paths.RuntimeStatePath(), prefsJSON, 0o600); err != nil {
		return rollback(fmt.Errorf("save runtime preferences: %w", err))
	}
	written = append(written, prefsFile)
	if targetID != "" && targetID != c.subs.ActiveID() {
		if err := c.subs.Use(targetID); err != nil {
			return rollback(fmt.Errorf("activate subscription: %w", err))
		}
	}
	c.stateMu.Lock()
	c.prefs = next
	c.stateMu.Unlock()
	if run {
		c.applied = append([]byte(nil), runtimeJSON...)
		c.appliedSubID = targetID
		c.originalProxy = originalProxy
		c.pendingApply = false
	}
	return nil
}

func (c *runtimeController) Down() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.stopLocked()
}

func (c *runtimeController) stopLocked() error {
	if c.originalProxy != nil {
		if err := c.proxyRestore(*c.originalProxy); err != nil {
			return fmt.Errorf("release system proxy: %w", err)
		}
		if err := os.Remove(paths.SysproxySnapshotPath()); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	if err := c.engine.Stop(); err != nil {
		return fmt.Errorf("stop core: %w", err)
	}
	c.originalProxy = nil
	c.pendingApply = false
	return nil
}

func (c *runtimeController) Remove(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	meta, err := c.subs.Get(id)
	if err != nil {
		return &runtimeInputError{err}
	}
	if meta.ID == c.subs.ActiveID() {
		if err := c.stopLocked(); err != nil {
			return err
		}
	}
	return c.subs.Remove(meta.ID)
}

func (c *runtimeController) Logout(purge bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.stopLocked(); err != nil {
		return err
	}
	if id := c.subs.ActiveID(); purge && id != "" {
		return c.subs.Remove(id)
	}
	return nil
}

func (c *runtimeController) Update(ctx context.Context, id string, force, viaProxy bool) (*sub.UpdateResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.updateLocked(ctx, id, force, viaProxy)
}

func (c *runtimeController) updateLocked(ctx context.Context, id string, force, viaProxy bool) (*sub.UpdateResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if id == "" {
		id = c.subs.ActiveID()
	}
	if id == "" {
		return nil, errors.New("no subscription to update")
	}
	result, err := c.subs.Update(id, force, viaProxy, c.Preferences().MixedPort)
	if err != nil {
		return nil, err
	}
	if result.Meta.ID == c.subs.ActiveID() && c.engine.IsRunning() && (result.ContentChanged || c.pendingApply) {
		c.pendingApply = true
		if err := c.applyLocked(ctx, runtimeOptions{}, true); err != nil {
			return result, err
		}
	}
	return result, nil
}

func (c *runtimeController) UpdateDue(ctx context.Context, now time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pendingApply && c.engine.IsRunning() {
		return c.applyLocked(ctx, runtimeOptions{}, true)
	}
	id := c.subs.ActiveID()
	if id == "" {
		return nil
	}
	meta, err := c.subs.Get(id)
	if err != nil {
		return err
	}
	if !meta.AutoUpdate {
		return nil
	}
	interval := time.Duration(meta.UpdateIntervalHours) * time.Hour
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	if now.Sub(meta.LastCheckedAt) < interval {
		return nil
	}
	_, err = c.updateLocked(ctx, id, false, false)
	return err
}
