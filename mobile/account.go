package mobile

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"sync"
	"time"

	"github.com/openxbond/xbond/internal/account"
	"github.com/openxbond/xbond/internal/clientapi"
	"github.com/openxbond/xbond/internal/i18n"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/sub"
)

// AccountState mirrors the daemon's account shape: the shared AccountPanel
// reads the same fields on every host. The OAuth token set never leaves the
// process — LocalAPI consumers see login state only.
type AccountState struct {
	Status                  string                   `json:"status"`
	Phase                   string                   `json:"phase,omitempty"`
	Method                  string                   `json:"method,omitempty"`
	AuthURL                 string                   `json:"authUrl,omitempty"`
	VerificationURI         string                   `json:"verificationUri,omitempty"`
	VerificationURIComplete string                   `json:"verificationUriComplete,omitempty"`
	UserCode                string                   `json:"userCode,omitempty"`
	ErrorCode               string                   `json:"errorCode,omitempty"`
	Error                   string                   `json:"error,omitempty"`
	StartedAt               *time.Time               `json:"startedAt,omitempty"`
	Subscription            *sub.SubscriptionMeta    `json:"subscription,omitempty"`
	UpdateError             string                   `json:"updateError,omitempty"`
	Email                   string                   `json:"email,omitempty"`
	Name                    string                   `json:"name,omitempty"`
	ConsoleURL              string                   `json:"consoleUrl,omitempty"`
	Service                 *clientapi.ServiceStatus `json:"service,omitempty"`
	Announcements           []clientapi.Announcement `json:"announcements,omitempty"`
	UnreadCount             int                      `json:"unreadCount,omitempty"`
	OverviewError           string                   `json:"overviewError,omitempty"`
}

// mobileAccount is the VPN host's slice of the daemon account controller:
// login (browser PKCE via the platform bridge, device flow as fallback),
// subscription bind, overview sync and logout. Same evidence rules as the
// daemon — a valid login survives a temporarily unreachable Cloud.
type mobileAccount struct {
	mu         sync.Mutex
	svc        *TunnelService
	manager    *account.Manager
	state      AccountState
	cancel     context.CancelFunc
	syncGen    int
	lang       string
	bindCalled bool
}

func newMobileAccount(svc *TunnelService, lang string) *mobileAccount {
	return &mobileAccount{
		svc:     svc,
		manager: account.NewManager(paths.AccountSessionPath()),
		state:   AccountState{Status: "signed_out"},
		lang:    lang,
	}
}

// hydrate derives initial state from persisted evidence, mirrors the daemon.
func (a *mobileAccount) hydrate() {
	a.mu.Lock()
	a.state = AccountState{Status: "signed_out"}
	if _, err := a.manager.Session(); err == nil {
		a.state.Status = "signed_in"
	}
	if id := a.svc.subMgr.ActiveID(); id != "" {
		if meta, err := a.svc.subMgr.Get(id); err == nil && meta.Type == sub.SubTypeXBond {
			a.state.Status = "signed_in"
			a.state.Subscription = meta
		}
	}
	if a.state.Status == "signed_in" {
		if cached := a.loadOverviewCache(); cached != nil {
			a.applyOverviewLocked(cached, "")
		}
	}
	a.mu.Unlock()
	if a.state.Status == "signed_in" {
		go a.syncOverview()
	}
}

func (a *mobileAccount) snapshot() AccountState {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.state
}

// login starts the OAuth flow; one at a time, like the daemon.
func (a *mobileAccount) login(origin string, device, noBrowser bool) AccountState {
	a.mu.Lock()
	if a.state.Status == "pending" || a.state.Status == "signed_in" {
		state := a.state
		a.mu.Unlock()
		return state
	}
	loginCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	a.cancel = cancel
	started := time.Now()
	a.state = AccountState{
		Status:    "pending",
		Method:    "pkce",
		StartedAt: &started,
	}
	if device {
		a.state.Method = "device"
	}
	svc := a.svc
	a.mu.Unlock()

	go func() {
		credentials, err := a.manager.Login(
			loginCtx,
			account.LoginOptions{
				Origin:       origin,
				Device:       device,
				NoBrowser:    noBrowser,
				CallbackHTML: i18n.RenderCallbackHTML,
				OpenBrowser: func(target string) error {
					if svc.platform == nil {
						return errors.New("platform bridge unavailable")
					}
					return svc.platform.OpenURL(target)
				},
			},
			func(progress account.Progress) {
				a.mu.Lock()
				a.state.Method = progress.Method
				a.state.Phase = progress.Phase
				a.state.AuthURL = progress.AuthURL
				a.state.VerificationURI = progress.VerificationURI
				a.state.VerificationURIComplete = progress.VerificationURIComplete
				a.state.UserCode = progress.UserCode
				a.mu.Unlock()
			},
		)
		if err != nil {
			a.fail(err)
			return
		}

		// Bind the discovered subscription as the active one and bring it
		// live when the tunnel already runs.
		updateError := ""
		if credentials.LinkError != nil {
			updateError = credentials.LinkError.Error()
		}
		var meta *sub.SubscriptionMeta
		if credentials.SubscriptionToken != "" {
			name := "XBond"
			bound, bindErr := svc.subMgr.AddXBond(
				credentials.SubscriptionToken,
				credentials.Origin,
				credentials.FallbackOrigins,
				"", a.lang, name, 24, true,
			)
			if bindErr != nil {
				updateError = bindErr.Error()
			} else {
				meta = bound
				if useErr := svc.subMgr.Use(bound.ID); useErr != nil {
					updateError = useErr.Error()
				} else if svc.engineManager().IsRunning() {
					if applyErr := svc.runtime.apply(svc.activeTunFd); applyErr != nil {
						updateError = applyErr.Error()
					}
				}
			}
		}

		a.syncOverviewCtx(loginCtx)

		a.mu.Lock()
		a.state.Status = "signed_in"
		a.state.Phase = ""
		a.state.Subscription = meta
		a.state.UpdateError = updateError
		a.state.Error = ""
		a.state.ErrorCode = ""
		a.cancel = nil
		a.mu.Unlock()
	}()
	return a.snapshot()
}

func (a *mobileAccount) fail(err error) {
	code := "oauth"
	var accountErr *account.Error
	if errors.As(err, &accountErr) {
		code = accountErr.Code
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.state.Status == "signed_out" && a.cancel == nil {
		return // superseded by a logout
	}
	a.state.Status = "error"
	a.state.Phase = ""
	a.state.ErrorCode = code
	a.state.Error = err.Error()
	a.cancel = nil
}

// cancelPending aborts an in-flight login and resets to signed_out.
func (a *mobileAccount) cancelPending() {
	a.mu.Lock()
	cancel := a.cancel
	a.cancel = nil
	a.syncGen++
	a.state = AccountState{Status: "signed_out"}
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// logout revokes the refresh chain (best effort), removes session, overview
// cache and xbond subscriptions; the active tunnel goes down with them.
func (a *mobileAccount) logout() []sub.SubscriptionMeta {
	a.cancelPending()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	_ = a.manager.Logout(ctx)
	cancel()
	a.removeOverviewCache()
	removed := make([]sub.SubscriptionMeta, 0)
	wasActive := false
	for _, item := range a.svc.subMgr.List() {
		if item.Type != sub.SubTypeXBond {
			continue
		}
		if item.ID == a.svc.subMgr.ActiveID() {
			wasActive = true
		}
		if err := a.svc.subMgr.Remove(item.ID); err == nil {
			removed = append(removed, item)
		}
	}
	if wasActive && a.svc.engineManager().IsRunning() && a.svc.platform != nil {
		_ = a.svc.platform.RequestDisconnect()
	}
	return removed
}

// refresh re-resolves the subscription link with the saved session and
// re-binds — the recovery path after a purchase or a Cloud hiccup.
func (a *mobileAccount) refresh(ctx context.Context) AccountState {
	link, err := a.manager.RefreshLink(ctx)
	if err != nil {
		a.mu.Lock()
		a.state.UpdateError = err.Error()
		state := a.state
		a.mu.Unlock()
		return state
	}
	meta, updateError := a.bindLink(link)
	a.syncOverviewCtx(ctx)
	a.mu.Lock()
	a.state.Status = "signed_in"
	if meta != nil {
		a.state.Subscription = meta
	}
	a.state.UpdateError = updateError
	a.state.Error = ""
	a.state.ErrorCode = ""
	state := a.state
	a.mu.Unlock()
	return state
}

func (a *mobileAccount) bindLink(link *clientapi.SubscriptionLink) (*sub.SubscriptionMeta, string) {
	if link.SubscriptionToken == "" {
		return nil, ""
	}
	existing := ""
	for _, item := range a.svc.subMgr.List() {
		if item.Type == sub.SubTypeXBond {
			existing = item.ID
			break
		}
	}
	var meta *sub.SubscriptionMeta
	updateError := ""
	if existing != "" {
		res, err := a.svc.subMgr.Update(existing, true, "")
		if err != nil {
			updateError = err.Error()
		} else if res != nil && res.Meta != nil {
			meta = res.Meta
		}
	} else {
		fallback := ""
		if len(link.FallbackDomains) > 0 {
			fallback = link.FallbackDomains[0]
		}
		bound, err := a.svc.subMgr.AddXBond(link.SubscriptionToken, fallback, nil, "", a.lang, "XBond", 24, true)
		if err != nil {
			updateError = err.Error()
		} else {
			meta = bound
		}
	}
	if a.svc.engineManager().IsRunning() {
		if err := a.svc.runtime.apply(a.svc.activeTunFd); err != nil {
			updateError = err.Error()
		}
	}
	return meta, updateError
}

func (a *mobileAccount) syncOverview() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	a.syncOverviewCtx(ctx)
}

func (a *mobileAccount) syncOverviewCtx(ctx context.Context) {
	a.mu.Lock()
	if a.state.Status == "signed_out" {
		a.mu.Unlock()
		return
	}
	generation := a.syncGen
	a.mu.Unlock()
	overview, err := a.manager.Overview(ctx)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return
		}
		a.mu.Lock()
		if a.syncGen == generation {
			a.state.OverviewError = err.Error()
		}
		a.mu.Unlock()
		return
	}
	degraded := ""
	if overview.Service == nil {
		degraded = "service status unavailable"
	}
	if overview.Announcements == nil {
		if degraded != "" {
			degraded += "; "
		}
		degraded += "notifications unavailable"
	}
	a.mu.Lock()
	if a.syncGen != generation {
		a.mu.Unlock()
		return
	}
	a.applyOverviewLocked(overview, degraded)
	a.mu.Unlock()
}

func (a *mobileAccount) applyOverviewLocked(overview *clientapi.AccountOverview, degraded string) {
	a.state.Email = overview.Profile.Email
	a.state.Name = overview.Profile.Name
	a.state.Service = overview.Service
	a.state.Announcements = overview.Announcements
	a.state.UnreadCount = overview.UnreadCount
	a.state.ConsoleURL = a.consoleURLLocked()
	a.state.OverviewError = degraded
	if degraded == "" && overview.Profile.Email != "" {
		a.saveOverviewCache(overview)
	}
}

func (a *mobileAccount) consoleURLLocked() string {
	session, err := a.manager.Session()
	if err != nil || session.Origin == "" {
		return ""
	}
	return session.Origin + "/dash"
}

func (a *mobileAccount) loadOverviewCache() *clientapi.AccountOverview {
	data, err := os.ReadFile(paths.AccountOverviewPath())
	if err != nil {
		return nil
	}
	var overview clientapi.AccountOverview
	if err := json.Unmarshal(data, &overview); err != nil {
		return nil
	}
	return &overview
}

func (a *mobileAccount) saveOverviewCache(overview *clientapi.AccountOverview) {
	data, err := json.MarshalIndent(overview, "", "  ")
	if err != nil {
		return
	}
	_ = atomicfile.Write(paths.AccountOverviewPath(), data, 0o600)
}

func (a *mobileAccount) removeOverviewCache() {
	_ = os.Remove(paths.AccountOverviewPath())
}
