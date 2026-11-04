package mobile

import (
	"errors"
	"fmt"
	"os"
	"sync"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/sub"
)

// mobileRuntime is the VPN-flavoured twin of the daemon's runtime
// controller: one active subscription, platform TUN fd as the only takeover,
// routing mode as the only user preference. It owns the engine lifecycle the
// same way the daemon one does — apply, restart, down — so the shared web UI
// drives both hosts through one LocalAPI contract.
type mobileRuntime struct {
	mu   sync.Mutex
	svc  *TunnelService
	subs *sub.Manager

	routing engine.RoutingMode
	tunFd   int32

	clashPort   int
	clashSecret string
	appliedSub  string
}

func newMobileRuntime(svc *TunnelService, routing engine.RoutingMode) *mobileRuntime {
	if routing == "" {
		routing = engine.RoutingRule
	}
	return &mobileRuntime{
		svc:     svc,
		subs:    svc.subMgr,
		routing: routing,
	}
}

// engine resolves the shared manager lazily: the runtime exists before the
// first engine start.
func (c *mobileRuntime) engine() *engine.Manager {
	return c.svc.engineManager()
}

// preferences reports the status-contract shape the shared UI reads. Mobile
// has no mixed listener and no LAN exposure; takeover is always the platform
// TUN.
func (c *mobileRuntime) preferences() map[string]any {
	return map[string]any{
		"takeoverMode": string(engine.ModeTun),
		"routingMode":  string(c.routing),
		"mixedPort":    0,
		"allowLan":     false,
		"clashPort":    c.clashPort,
		"clashSecret":  c.clashSecret,
	}
}

// activeSource returns the active subscription's downloaded source, fetching
// it first when the file is missing (fresh import, wiped data dir).
func (c *mobileRuntime) activeSource() (string, []byte, error) {
	id := c.subs.ActiveID()
	if id == "" {
		return "", nil, errors.New("no active subscription; add one first")
	}
	source, err := os.ReadFile(paths.SubSourcePath(id))
	if err != nil {
		if _, updateErr := c.subs.Update(id, true, ""); updateErr != nil {
			return "", nil, fmt.Errorf("active subscription has no downloaded config and refresh failed: %w", updateErr)
		}
		source, err = os.ReadFile(paths.SubSourcePath(id))
		if err != nil {
			return "", nil, err
		}
	}
	return id, source, nil
}

// apply starts (or hot-swaps) the core over the platform fd with the active
// subscription's source. The fd must already be held by the platform VPN.
func (c *mobileRuntime) apply(tunFd int32) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if tunFd <= 0 {
		return errors.New("invalid TUN file descriptor")
	}
	if c.subs == nil || c.svc == nil {
		return errors.New("subscription manager uninitialized")
	}
	id, source, err := c.activeSource()
	if err != nil {
		return err
	}
	port := getFreeLoopbackPort()
	secret := randomSecret()
	derived, err := engine.DeriveMobileRuntimeConfig(source, tunFd, c.routing, port, secret)
	if err != nil {
		return fmt.Errorf("failed to derive mobile runtime config: %w", err)
	}

	engine.SetMobileTunFD(tunFd)
	mgr := c.engine()
	if mgr.IsRunning() {
		err = mgr.Reload(derived, nil)
	} else {
		err = mgr.Start(derived)
	}
	if err != nil {
		return fmt.Errorf("failed to start engine: %w", err)
	}
	c.tunFd = tunFd
	c.clashPort = port
	c.clashSecret = secret
	c.appliedSub = id
	return nil
}

// setRouting switches the routing mode, re-applying when the core runs.
func (c *mobileRuntime) setRouting(routing engine.RoutingMode) error {
	if routing != engine.RoutingRule && routing != engine.RoutingGlobal && routing != engine.RoutingDirect {
		return fmt.Errorf("invalid routing mode %q", routing)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.routing = routing
	if !c.engine().IsRunning() {
		return nil
	}
	id, source, err := c.activeSource()
	if err != nil {
		return err
	}
	port := getFreeLoopbackPort()
	secret := randomSecret()
	derived, err := engine.DeriveMobileRuntimeConfig(source, c.tunFd, routing, port, secret)
	if err != nil {
		return fmt.Errorf("failed to derive mobile runtime config: %w", err)
	}
	if err := c.engine().Reload(derived, nil); err != nil {
		return err
	}
	c.clashPort = port
	c.clashSecret = secret
	c.appliedSub = id
	return nil
}

func (c *mobileRuntime) appliedSubID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.appliedSub
}

// update refreshes a subscription under the same contract as the daemon's
// updateLocked: resolve the subscription's update channel, unpin an edited
// source on a manual update, and hot-apply when content changed on the
// active subscription while the tunnel runs — the shared web UI drives this
// endpoint on every host and expects one set of semantics.
func (c *mobileRuntime) update(id string, force bool) (*sub.UpdateResult, error) {
	if id == "" {
		id = c.subs.ActiveID()
	}
	if id == "" {
		return nil, errors.New("no subscription to update")
	}
	proxyURL, err := resolveMobileUpdateProxy(c.subs, id)
	if err != nil {
		return nil, err
	}
	result, err := c.subs.Update(id, force, proxyURL)
	if err != nil {
		if proxyURL != "" {
			return nil, fmt.Errorf("%w (the update channel used the stored proxy; fix it or switch the subscription's update channel to direct)", err)
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
	// "Update succeeded" must mean "the running core now serves the new
	// nodes" — hot-apply when content changed on the active subscription,
	// mirroring the daemon's updateLocked.
	if result.Meta.ID == c.subs.ActiveID() && result.ContentChanged && c.svc.IsRunning() && c.tunFd > 0 {
		if err := c.apply(c.tunFd); err != nil {
			return result, err
		}
	}
	return result, nil
}

// resolveMobileUpdateProxy turns the subscription's update channel into a
// fetch proxy. Mobile runs no mixed port of its own, so the "self" channel
// is an explicit error — never a silent direct fetch.
func resolveMobileUpdateProxy(subs *sub.Manager, id string) (string, error) {
	meta, err := subs.Get(id)
	if err != nil {
		return "", err
	}
	switch meta.UpdateChannel {
	case "", "direct":
		return "", nil
	case "proxy":
		if meta.UpdateProxy == "" {
			return "", errors.New("update channel is set to a specific proxy but no proxy URL is saved; set it or switch back to direct")
		}
		return meta.UpdateProxy, nil
	case "self":
		return "", errors.New("the self update channel rides the core's mixed port, which mobile does not run; switch the update channel to direct or proxy")
	}
	return "", fmt.Errorf("unknown update channel %q", meta.UpdateChannel)
}

func (c *mobileRuntime) endpoint() (int, string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.clashPort, c.clashSecret
}

func (c *mobileRuntime) stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.engine().Stop()
	c.appliedSub = ""
}
