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
