package mobile

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"strings"
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
	// Deep-link scheme flow: the browser hands the authorization code to the
	// OS, the Activity forwards it through LocalAPI /account/callback, and
	// the pending login picks it up here (daemon-identical semantics).
	schemeState string
	codeCh      chan string
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

// login starts the OAuth flow; one at a time, like the daemon. With a
// callback scheme the browser redirects through xbond://callback and the OS
// deep link jumps back into the app; without one the loopback listener path
// applies (the browser page tells the user to return manually).
func (a *mobileAccount) login(origin string, device, noBrowser bool, callbackScheme string) AccountState {
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
	opts := account.LoginOptions{
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
	}
	if !device {
		if scheme := strings.ToLower(strings.TrimSpace(callbackScheme)); scheme != "" {
			if !validCallbackScheme(scheme) {
				a.mu.Unlock()
				return AccountState{Status: "error", ErrorCode: "input", Error: "invalid callback scheme"}
			}
			opts.RedirectURI = scheme + "://callback"
			a.state.Method = "scheme"
			a.codeCh = make(chan string, 1)
			a.schemeState = ""
			opts.WaitCode = a.waitSchemeCode
		}
	}
	a.mu.Unlock()

	go func() {
		credentials, err := a.manager.Login(loginCtx, opts, func(progress account.Progress) {
			a.mu.Lock()
			a.state.Method = progress.Method
			a.state.Phase = progress.Phase
			a.state.AuthURL = progress.AuthURL
			a.state.VerificationURI = progress.VerificationURI
			a.state.VerificationURIComplete = progress.VerificationURIComplete
			a.state.UserCode = progress.UserCode
			a.mu.Unlock()
		})
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
			// 與桌面 bindCredentials 一致：登入即賬號綁定（issuer + kind=cloud），
			// 讓登出刪除、更新走賬號重綁的語義在三端一致。
			issuer := credentials.Issuer
			if issuer == "" {
				issuer = credentials.Origin
			}
			bound, bindErr := svc.subMgr.BindAccount(
				credentials.SubscriptionToken,
				issuer,
				credentials.Origin,
				credentials.FallbackOrigins,
				"", a.lang, "",
			)
			if bindErr != nil {
				updateError = bindErr.Error()
			} else {
				// 與桌面 bindCredentials 一致：綁定後立即拉取訂閱內容——
				// 「登入成功」必須意味著「配置可用」，而不是讓用戶回到
				// App 後再手動補一次更新。
				if _, updErr := svc.runtime.update(bound.ID, true); updErr != nil {
					updateError = updErr.Error()
				}
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
	a.schemeState = ""
	a.codeCh = nil
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// waitSchemeCode is the account package's code channel for the deep-link
// flow: it records the flow's state so deliverCallback can match the
// browser's answer, then blocks until the Activity delivers the code or the
// login context is cancelled (daemon-identical semantics).
func (a *mobileAccount) waitSchemeCode(ctx context.Context, state string) (string, error) {
	a.mu.Lock()
	if a.state.Status != "pending" || a.codeCh == nil {
		a.mu.Unlock()
		return "", errors.New("no pending scheme login")
	}
	a.schemeState = state
	ch := a.codeCh
	a.mu.Unlock()

	select {
	case code := <-ch:
		return code, nil
	case <-ctx.Done():
		a.mu.Lock()
		if a.schemeState == state {
			a.schemeState = ""
		}
		a.mu.Unlock()
		return "", ctx.Err()
	}
}

// deliverCallback hands the browser's authorization code to the in-flight
// scheme flow. The state must match the flow that opened the browser; a
// stale or replayed link is rejected instead of guessing.
func (a *mobileAccount) deliverCallback(code, state string) error {
	a.mu.Lock()
	if a.state.Status != "pending" || a.codeCh == nil || state == "" || state != a.schemeState {
		a.mu.Unlock()
		return errors.New("no matching pending authorization")
	}
	a.schemeState = ""
	ch := a.codeCh
	a.mu.Unlock()

	select {
	case ch <- code:
	default:
	}
	return nil
}

// validCallbackScheme matches RFC 3986 scheme syntax; the Activity only
// registers known schemes, so anything exotic is refused here.
func validCallbackScheme(scheme string) bool {
	if scheme == "" || scheme[0] < 'a' || scheme[0] > 'z' {
		return false
	}
	for _, r := range scheme {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '+', r == '-', r == '.':
		default:
			return false
		}
	}
	return true
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
		if account.IsSessionExpired(err) {
			a.state.Status = "error"
			a.state.ErrorCode = "session_expired"
			a.state.Error = "Account session expired. Sign in again."
			_ = a.manager.Logout(ctx)
		}
		state := a.state
		a.mu.Unlock()
		return state
	}
	meta, updateError := a.bindLink(ctx, link)
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

func (a *mobileAccount) bindLink(ctx context.Context, link *clientapi.SubscriptionLink) (*sub.SubscriptionMeta, string) {
	if link.SubscriptionToken == "" {
		return nil, ""
	}
	// 恢復鏈接來自控制台，第一個回退域名即賬號來源，用作 issuer。
	fallback := ""
	if len(link.FallbackDomains) > 0 {
		fallback = link.FallbackDomains[0]
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
		// Token rotation is the exact scenario this recovery path exists
		// for: the server rotated the credential, so persist the fresh
		// token BEFORE updating — updating with the stored old token fails
		// with the same 401 it was recovering from, and the rotation
		// recovery dies exactly when it is needed.
		if _, err := a.svc.subMgr.RetokenXBond(link.SubscriptionToken); err != nil {
			updateError = err.Error()
		} else if fallback != "" {
			// 恢復的訂閱補上賬號綁定（issuer + kind=cloud），與登入產出一致；
			// 綁定後再更新，讓抓取使用新憑據與綁定的來源。
			if _, err := a.svc.subMgr.BindAccount(link.SubscriptionToken, fallback, fallback, nil, "", a.lang, ""); err != nil {
				updateError = err.Error()
			} else if res, err := a.svc.subMgr.Update(ctx, existing, true, ""); err != nil {
				updateError = err.Error()
			} else if res != nil && res.Meta != nil {
				meta = res.Meta
			}
		} else if res, err := a.svc.subMgr.Update(ctx, existing, true, ""); err != nil {
			updateError = err.Error()
		} else if res != nil && res.Meta != nil {
			meta = res.Meta
		}
	} else if fallback != "" {
		bound, err := a.svc.subMgr.BindAccount(link.SubscriptionToken, fallback, fallback, nil, "", a.lang, "")
		if err != nil {
			updateError = err.Error()
		} else {
			// 同登入路徑：恢復成功即拉取內容，不留「有訂閱無配置」的半態。
			if _, updErr := a.svc.runtime.update(bound.ID, true); updErr != nil {
				updateError = updErr.Error()
			}
			meta = bound
			if useErr := a.svc.subMgr.Use(bound.ID); useErr != nil {
				updateError = useErr.Error()
			}
		}
	} else {
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
			if account.IsSessionExpired(err) {
				a.state.Status = "error"
				a.state.ErrorCode = "session_expired"
				a.state.Error = "Account session expired. Sign in again."
				_ = a.manager.Logout(ctx)
			}
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
