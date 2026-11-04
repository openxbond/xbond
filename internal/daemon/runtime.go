package daemon

import (
	"bytes"
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
	SystemProxy *bool               `json:"systemProxy"`
	Tun         *bool               `json:"tun"`
	Mode        engine.TakeoverMode `json:"mode"`
	Routing     engine.RoutingMode  `json:"routing"`
	// Port is tri-state: nil leaves the override unchanged, 0 clears it back
	// to following the subscription, a positive value fixes the local port.
	Port     *int   `json:"port"`
	AllowLan *bool  `json:"allowLan"`
	SubID    string `json:"subId"`
}

// defaultMixedPort applies when neither the subscription nor an explicit
// local override names a mixed port.
const defaultMixedPort = 7890

// resolveMixedPort picks the effective mixed port: an explicit local override
// wins over the subscription's own port; without either the daemon default
// applies.
func resolveMixedPort(override, sourcePort int) (int, PortSource) {
	if override > 0 {
		return override, PortSourceOverride
	}
	if sourcePort > 0 {
		return sourcePort, PortSourceSubscription
	}
	return defaultMixedPort, PortSourceDefault
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
	// delegate hands TUN takeover to the machine-scoped daemon when the
	// user-session process cannot open the adapter itself; nil on platforms
	// and tests without delegation.
	delegate     *delegateManager
	write        func(string, []byte, fs.FileMode) error
	proxyGet     func() (sysproxy.Snapshot, error)
	proxySet     func(string, string) error
	proxyRestore func(sysproxy.Snapshot) error
}

func newRuntimeController(core runtimeEngine, subs *sub.Manager, prefs RuntimePreferences) *runtimeController {
	if prefs.TakeoverMode == engine.ModePort {
		prefs.SystemProxy = false
		prefs.Tun = false
	}
	return &runtimeController{
		engine: core, subs: subs, prefs: prefs, write: atomicfile.Write,
		proxyGet: sysproxy.Get, proxySet: sysproxy.Set, proxyRestore: sysproxy.Restore,
	}
}

func validatePreferences(prefs RuntimePreferences) error {
	if prefs.TakeoverMode != "" {
		switch prefs.TakeoverMode {
		case engine.ModeSysproxy, engine.ModeTun, engine.ModePort:
		default:
			return errors.New("invalid takeover mode")
		}
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
	if prefs.PortOverride < 0 || prefs.PortOverride > 65535 {
		return errors.New("port override must be between 1 and 65535, or 0 to follow the subscription")
	}
	if prefs.PortOverride > 0 && prefs.PortOverride == prefs.ClashPort {
		return errors.New("port override collides with the daemon controller port")
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

// Restart disconnects and reconnects the core from the active subscription
// and current preferences — a fresh core process state, unlike Up, which
// applies changes in place and skips work when nothing changed.
func (c *runtimeController) Restart(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, err := c.stopLocked(); err != nil {
		return fmt.Errorf("stop current core: %w", err)
	}
	return c.applyLocked(ctx, runtimeOptions{}, true)
}

func (c *runtimeController) Configure(ctx context.Context, options runtimeOptions) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.applyLocked(ctx, options, c.connectedLocked())
}

func (c *runtimeController) Use(ctx context.Context, id string) error {
	if id == "" {
		return &runtimeInputError{errors.New("missing subscription id")}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.applyLocked(ctx, runtimeOptions{SubID: id}, c.connectedLocked())
}

// connectedLocked reports whether a takeover is up anywhere — the local core
// or the delegated machine session. It is the "running" of the delegation
// era: the local engine idles while the system service routes TUN traffic.
func (c *runtimeController) connectedLocked() bool {
	return c.engine.IsRunning() || c.delegatedActive()
}

func (c *runtimeController) delegatedActive() bool {
	return c.delegate != nil && c.delegate.Active()
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
	if options.SystemProxy != nil {
		next.SystemProxy = *options.SystemProxy
	}
	if options.Tun != nil {
		next.Tun = *options.Tun
	}
	if options.SystemProxy == nil && options.Tun == nil {
		if options.Mode != "" {
			next.TakeoverMode = options.Mode
		}
		switch next.TakeoverMode {
		case engine.ModePort:
			next.SystemProxy = false
			next.Tun = false
		case engine.ModeSysproxy:
			next.SystemProxy = true
			next.Tun = false
		case engine.ModeTun:
			next.SystemProxy = false
			next.Tun = true
		}
	} else {
		if next.Tun {
			next.TakeoverMode = engine.ModeTun
		} else if next.SystemProxy {
			next.TakeoverMode = engine.ModeSysproxy
		} else {
			next.TakeoverMode = engine.ModePort
		}
	}
	if options.Routing != "" {
		next.RoutingMode = options.Routing
	}
	if options.Port != nil {
		next.PortOverride = *options.Port
		if *options.Port > 0 {
			// An explicit override decides the port regardless of any
			// subscription content, so even a stopped apply can report the
			// effective port immediately; a running apply re-resolves below.
			next.MixedPort = *options.Port
			next.PortSource = PortSourceOverride
		}
		// Clearing the override (0) keeps the last applied port until the
		// next apply resolves the source port again.
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
	// Choosing a source must not publish an unusable active ID just because
	// the core is stopped. Running switches validate the derived config below.
	if !run && selected != nil {
		source, err := os.ReadFile(paths.SubSourcePath(targetID))
		if err != nil {
			return fmt.Errorf("configuration is not ready; update it before use: %w", err)
		}
		override, err := c.subs.Override(targetID)
		if err != nil {
			return fmt.Errorf("read local override: %w", err)
		}
		mixin, err := c.subs.GlobalMixin()
		if err != nil {
			return fmt.Errorf("read global mixin: %w", err)
		}
		if (!override.IsZero()) || (!mixin.IsZero()) {
			source, err = engine.ApplyLayers(source, override, mixin)
			if err != nil {
				return &runtimeInputError{fmt.Errorf("apply layers: %w", err)}
			}
		}
		if err := engine.Validate(source); err != nil {
			return fmt.Errorf("configuration is not usable: %w", err)
		}
	}

	var runtimeJSON []byte
	prefsJSON, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
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
			if _, updateErr := c.subs.Update(targetID, true, ""); updateErr != nil {
				return fmt.Errorf("active subscription has no downloaded config and refresh failed: %w", updateErr)
			}
			source, err = os.ReadFile(paths.SubSourcePath(targetID))
		}
		if err != nil {
			return fmt.Errorf("read source configuration: %w", err)
		}
		// The local override is the layer between the source and derivation:
		// a conflict fails before the core is touched, keeping the previous
		// runtime intact.
		override, err := c.subs.Override(targetID)
		if err != nil {
			return fmt.Errorf("read local override: %w", err)
		}
		mixin, err := c.subs.GlobalMixin()
		if err != nil {
			return fmt.Errorf("read global mixin: %w", err)
		}
		if (!override.IsZero()) || (!mixin.IsZero()) {
			source, err = engine.ApplyLayers(source, override, mixin)
			if err != nil {
				return &runtimeInputError{fmt.Errorf("apply layers: %w", err)}
			}
		}
		// The effective port follows the source unless the user fixed it
		// locally; the resolved value is what gets persisted and reported.
		sourcePort, err := engine.SourcePort(source)
		if err != nil {
			return fmt.Errorf("read source port: %w", err)
		}
		next.MixedPort, next.PortSource = resolveMixedPort(next.PortOverride, sourcePort)
		if next.MixedPort == next.ClashPort {
			return &runtimeInputError{fmt.Errorf("proxy port %d collides with the daemon-owned controller port; set a fixed port instead", next.MixedPort)}
		}
		// TUN failures are swallowed by the cores just like bind errors: a
		// missing privilege would silently leave the core running mixed-only
		// while the UI reports TUN. Gate on the real capability before any
		// state is touched (daemon-runtime spec: 不静默降级). The capability
		// is honest about how it would run: this process elevated, or the
		// machine-scoped daemon reachable for delegation — never "installed"
		// alone.
		if next.Tun {
			if capability := tunCapability(c.delegate); !capability.Tun {
				return &runtimeInputError{fmt.Errorf("TUN takeover unavailable: %s", capability.Reason)}
			}
		}
		prefsJSON, err = json.MarshalIndent(next, "", "  ")
		if err != nil {
			return err
		}
		deriveMode := engine.ModePort
		if next.Tun {
			deriveMode = engine.ModeTun
		}
		runtimeJSON, err = engine.DeriveRuntimeConfig(source, deriveMode, next.RoutingMode, next.MixedPort, next.AllowLan, next.ClashPort, next.ClashSecret)
		if err != nil {
			return fmt.Errorf("derive runtime configuration: %w", err)
		}
		if err := engine.Validate(runtimeJSON); err != nil {
			return fmt.Errorf("validate runtime configuration: %w", err)
		}
		// Re-applying a byte-identical configuration to the running core is
		// a no-op: repeating `up` must not bounce the core or churn the
		// system proxy. The proxy-ownership check keeps mode switches honest
		// — sysproxy and port can derive the same core JSON while the
		// takeover side effect differs. Preferences still get persisted in
		// case the file drifted from memory.
		proxyOwnershipMatches := (next.SystemProxy == (c.originalProxy != nil))
		if c.connectedLocked() && c.appliedSubID == targetID && bytes.Equal(runtimeJSON, c.applied) && proxyOwnershipMatches {
			if err := c.write(paths.RuntimeStatePath(), prefsJSON, 0o600); err != nil {
				return fmt.Errorf("save runtime preferences: %w", err)
			}
			c.stateMu.Lock()
			c.prefs = next
			c.stateMu.Unlock()
			return nil
		}
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

	proxyTouched := run && (next.SystemProxy || c.originalProxy != nil)
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
	wasDelegated := c.delegatedActive()
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
			switch {
			case wasDelegated:
				// The previous takeover ran in the machine session; put it
				// back there, not as a local mixed-only look-alike.
				if len(previousRuntime) > 0 {
					_, restoreErr = c.delegate.Apply(previousRuntime)
				}
			case wasRunning:
				restoreErr = c.engine.Reload(previousRuntime, previousSelections)
			default:
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

	// The takeover executor follows the capability: this process can open
	// the adapter itself only when elevated; otherwise the gate's approval
	// came from the machine-scoped daemon, and the core runs there.
	delegateTakeover := run && next.Tun && !localTunCapable()
	if run {
		if delegateTakeover {
			// Free the loopback ports first: the delegated core binds the
			// same mixed and controller ports in the machine session.
			if err := c.engine.Stop(); err != nil {
				return fmt.Errorf("stop local core before delegating: %w", err)
			}
			if _, err := c.delegate.Apply(runtimeJSON); err != nil {
				return rollback(err)
			}
		} else {
			if wasDelegated {
				// Leaving the machine session: stop the delegated core so it
				// releases the ports the local core is about to bind.
				if err := c.delegate.Stop(); err != nil {
					return rollback(fmt.Errorf("stop delegated takeover: %w", err))
				}
			}
			if err := c.engine.Reload(runtimeJSON, selected.SavedSelections); err != nil {
				return fmt.Errorf("apply runtime configuration: %w", err)
			}
		}
	}
	originalProxy := c.originalProxy
	if proxyTouched {
		if next.SystemProxy {
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
			if originalProxy != nil {
				if err := c.proxyRestore(*originalProxy); err != nil {
					return rollback(fmt.Errorf("release system proxy: %w", err))
				}
				if err := os.Remove(paths.SysproxySnapshotPath()); err != nil && !errors.Is(err, fs.ErrNotExist) {
					return rollback(err)
				}
				originalProxy = nil
			}
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

func (c *runtimeController) Down() (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.stopLocked()
}

// stopLocked tears down whatever the daemon owns. The bool reports whether
// there was anything to tear down, so `down` can distinguish "stopped" from
// "was already stopped" instead of printing the same success for both.
func (c *runtimeController) stopLocked() (bool, error) {
	if c.originalProxy == nil && !c.connectedLocked() {
		return false, nil
	}
	if c.originalProxy != nil {
		if err := c.proxyRestore(*c.originalProxy); err != nil {
			return true, fmt.Errorf("release system proxy: %w", err)
		}
		if err := os.Remove(paths.SysproxySnapshotPath()); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return true, err
		}
	}
	if c.delegatedActive() {
		// The machine session must release the ports and the TUN adapter
		// before this function claims the takeover is gone.
		if err := c.delegate.Stop(); err != nil {
			return true, fmt.Errorf("stop delegated takeover: %w", err)
		}
	}
	if err := c.engine.Stop(); err != nil {
		return true, fmt.Errorf("stop core: %w", err)
	}
	c.originalProxy = nil
	c.pendingApply = false
	return true, nil
}

func (c *runtimeController) ChangeSourceURL(id, source string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.subs.ChangeSourceURL(id, source)
}

func (c *runtimeController) Remove(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	meta, err := c.subs.Get(id)
	if err != nil {
		return &runtimeInputError{err}
	}
	if meta.ID == c.subs.ActiveID() {
		if _, err := c.stopLocked(); err != nil {
			return err
		}
	}
	return c.subs.Remove(meta.ID)
}

// Logout removes the local XBond credentials: every xbond-type subscription.
// The core disconnects only when the active subscription is one of them, and
// universal subscriptions are never touched — removing those is `sub remove`.
// Remote authorization is not revoked; that is a dashboard action.
func (c *runtimeController) Logout() ([]sub.SubscriptionMeta, error) {
	return c.logout(false)
}

func (c *runtimeController) LogoutAccount() ([]sub.SubscriptionMeta, error) {
	return c.logout(true)
}

func (c *runtimeController) logout(accountOnly bool) ([]sub.SubscriptionMeta, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	active := c.subs.ActiveID()
	var removed []sub.SubscriptionMeta
	for _, item := range c.subs.List() {
		if item.Type != sub.SubTypeXBond || (accountOnly && item.AccountIssuer == "") {
			continue
		}
		if item.ID == active {
			if _, err := c.stopLocked(); err != nil {
				return removed, err
			}
		}
		if err := c.subs.Remove(item.ID); err != nil {
			return removed, err
		}
		removed = append(removed, item)
	}
	return removed, nil
}

// Update refreshes one subscription. viaProxy is a per-call override: nil
// follows the subscription's update channel, true forces the local proxy,
// false forces direct.
func (c *runtimeController) Update(ctx context.Context, id string, force bool, viaProxy *bool) (*sub.UpdateResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.updateLocked(ctx, id, force, viaProxy)
}

func (c *runtimeController) updateLocked(ctx context.Context, id string, force bool, viaProxy *bool) (*sub.UpdateResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if id == "" {
		id = c.subs.ActiveID()
	}
	if id == "" {
		return nil, errors.New("no subscription to update")
	}
	proxyURL, err := c.resolveUpdateProxy(id, viaProxy)
	if err != nil {
		return nil, err
	}
	result, err := c.subs.Update(id, force, proxyURL)
	if err != nil {
		if proxyURL != "" {
			return nil, fmt.Errorf("%w (the update channel used the local proxy; fix it or switch the subscription's update channel to direct)", err)
		}
		return nil, err
	}
	// A manual update is an explicit ask for fresh content: it removes the
	// pin an edited source carries.
	if result.Meta != nil && result.Meta.SourcePinned {
		if _, pinErr := c.subs.SetSourcePinned(id, false); pinErr != nil {
			return result, pinErr
		}
		result.Meta.SourcePinned = false
	}
	if result.Meta.ID == c.subs.ActiveID() && c.connectedLocked() && (result.ContentChanged || c.pendingApply) {
		c.pendingApply = true
		if err := c.applyLocked(ctx, runtimeOptions{}, true); err != nil {
			return result, err
		}
	}
	return result, nil
}

// resolveUpdateProxy turns the subscription's update channel into a fetch
// proxy URL. "self" rides the takeover's own mixed port only while the core
// runs (locally or delegated — the delegated core binds the same loopback
// port) — a first configuration can never bootstrap through itself. "proxy"
// rides the stored proxy URL. The channel never silently switches: failures
// return actionable errors.
func (c *runtimeController) resolveUpdateProxy(id string, override *bool) (string, error) {
	meta, err := c.subs.Get(id)
	if err != nil {
		return "", err
	}
	if override != nil {
		if !*override {
			return "", nil
		}
		return fmt.Sprintf("http://127.0.0.1:%d", c.Preferences().MixedPort), nil
	}
	switch meta.UpdateChannel {
	case "", "direct":
		return "", nil
	case "self":
		if !c.connectedLocked() {
			return "", nil
		}
		return fmt.Sprintf("http://127.0.0.1:%d", c.Preferences().MixedPort), nil
	case "proxy":
		if meta.UpdateProxy == "" {
			return "", errors.New("update channel is set to a specific proxy but no proxy URL is saved; set it or switch back to direct")
		}
		return meta.UpdateProxy, nil
	default:
		return "", fmt.Errorf("unknown update channel %q", meta.UpdateChannel)
	}
}

func (c *runtimeController) UpdateDue(ctx context.Context, now time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pendingApply && c.connectedLocked() {
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
	// A pinned source is an edited local copy: automatic updates never
	// overwrite it (client-rethink §四.2). A manual update removes the pin.
	if meta.SourcePinned {
		return nil
	}
	interval := time.Duration(meta.UpdateIntervalHours) * time.Hour
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	if now.Sub(meta.LastCheckedAt) < interval {
		return nil
	}
	_, err = c.updateLocked(ctx, id, false, nil)
	return err
}

// Delegated reports whether takeover currently rides the machine-scoped
// daemon; the status surface reads the remote engine state when it does.
func (c *runtimeController) Delegated() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.delegatedActive()
}

// ReconcileDelegation aligns the delegated takeover with the user's intent
// beside the synchronous apply paths: adopt a takeover this process did not
// start (the user daemon restarted while the machine session kept routing),
// re-apply the delegated config after the system service restarts, and stop
// when intent flipped while delegation was active. It deliberately never
// establishes a fresh takeover from a stored intent — connecting stays an
// explicit act, same as the local core.
func (c *runtimeController) ReconcileDelegation() {
	if c.delegate == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Preferences().Tun {
		if c.engine.IsRunning() {
			// A locally elevated core owns TUN; the machine session must
			// stay idle so it never fights the local takeover for ports.
			return
		}
		status, alive := c.delegate.Status()
		if !alive {
			return // the failed transport was logged at the transition
		}
		if status.Running {
			if !c.delegatedActive() {
				c.delegate.Adopt(status)
				c.appliedSubID = c.subs.ActiveID()
				c.logDelegated("delegated TUN takeover adopted from the system service")
			}
			return
		}
		if !c.delegatedActive() {
			// Service up and idle, no delegation in this process: connecting
			// stays explicit (no auto-connect from stored intent).
			return
		}
		config := c.delegate.LastConfig()
		if config == nil {
			// Adopted earlier — the config bytes were never known here.
			// The persisted runtime file of the active subscription is the
			// same derivation the previous process delegated.
			id := c.subs.ActiveID()
			if id == "" {
				return
			}
			data, err := os.ReadFile(paths.SubRuntimePath(id))
			if err != nil {
				c.logDelegated(fmt.Sprintf("delegated config unavailable after service restart: %v", err))
				return
			}
			config = data
		}
		if _, err := c.delegate.Apply(config); err != nil {
			return // logged at the transition
		}
	} else if c.delegatedActive() {
		if err := c.delegate.Stop(); err != nil {
			return // logged
		}
	}
}

func (c *runtimeController) logDelegated(message string) {
	if c.delegate != nil {
		c.delegate.LogRuntime(message)
	}
}
