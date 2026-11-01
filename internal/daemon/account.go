package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/openxbond/xbond/internal/account"
	"github.com/openxbond/xbond/internal/clientapi"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/browser"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/sub"
)

// AccountState is the only account shape LocalAPI consumers see. The OAuth
// token set never leaves the daemon. Identity, service status and
// announcements come from the last successful overview sync (identity/service
// via OAuth Bearer; the console link derives from the session's own origin,
// the issuer the tokens actually came from).
type AccountState struct {
	Status                  string                   `json:"status"`
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

type accountBindOptions struct {
	Name     string
	Lang     string
	Protocol string
}

type accountLoginManager interface {
	Login(context.Context, account.LoginOptions, func(account.Progress)) (*account.Credentials, error)
	Session() (*account.Session, error)
	RefreshLink(context.Context) (*clientapi.SubscriptionLink, error)
	Overview(context.Context) (*clientapi.AccountOverview, error)
	Logout(context.Context) error
}

type accountController struct {
	mu         sync.Mutex
	manager    accountLoginManager
	state      AccountState
	cancel     context.CancelFunc
	syncGen    int
	bind       func(context.Context, *account.Credentials, accountBindOptions) (*sub.SubscriptionMeta, string, error)
	logoutSubs func() ([]sub.SubscriptionMeta, error)
	listXBond  func() *sub.SubscriptionMeta
	// overview is the overview fetch seam; defaults to manager.Overview.
	overview func(context.Context) (*clientapi.AccountOverview, error)
}

func newAccountController(
	manager accountLoginManager,
	bind func(context.Context, *account.Credentials, accountBindOptions) (*sub.SubscriptionMeta, string, error),
	logoutSubs func() ([]sub.SubscriptionMeta, error),
	listXBond func() *sub.SubscriptionMeta,
) *accountController {
	controller := &accountController{
		manager:    manager,
		bind:       bind,
		logoutSubs: logoutSubs,
		listXBond:  listXBond,
	}
	controller.overview = manager.Overview
	controller.hydrate()
	return controller
}

// hydrate derives the initial state from persisted evidence. An XBond
// subscription created by the CLI also counts as signed in: the subscription
// token is the durable credential the daemon already owns. The cached
// overview shows immediately; a signed-in session then refreshes it in the
// background.
func (c *accountController) hydrate() {
	c.mu.Lock()
	c.state = AccountState{Status: "signed_out"}
	if _, err := c.manager.Session(); err == nil {
		c.state.Status = "signed_in"
	}
	if meta := c.listXBond(); meta != nil {
		c.state.Status = "signed_in"
		c.state.Subscription = meta
	}
	if c.state.Status == "signed_in" {
		if cached := loadOverviewCache(); cached != nil {
			c.applyOverviewLocked(cached, "")
		}
	}
	c.mu.Unlock()
	if c.state.Status == "signed_in" {
		go c.syncOverview()
	}
}

func (c *accountController) snapshot() AccountState {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state
}

func (c *accountController) start(
	login account.LoginOptions,
	bindOptions accountBindOptions,
) AccountState {
	c.mu.Lock()
	if c.state.Status == "pending" || c.state.Status == "signed_in" {
		state := c.state
		c.mu.Unlock()
		return state
	}
	loginCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	c.cancel = cancel
	started := time.Now()
	c.state = AccountState{
		Status:    "pending",
		Method:    "pkce",
		StartedAt: &started,
	}
	if login.Device {
		c.state.Method = "device"
	}
	c.mu.Unlock()

	go c.run(loginCtx, login, bindOptions)
	return c.snapshot()
}

func (c *accountController) run(
	ctx context.Context,
	login account.LoginOptions,
	bindOptions accountBindOptions,
) {
	credentials, err := c.manager.Login(ctx, login, func(progress account.Progress) {
		c.mu.Lock()
		c.state.Method = progress.Method
		c.state.AuthURL = progress.AuthURL
		c.state.VerificationURI = progress.VerificationURI
		c.state.VerificationURIComplete = progress.VerificationURIComplete
		c.state.UserCode = progress.UserCode
		c.mu.Unlock()
	})
	if err != nil {
		c.fail(err)
		return
	}

	updateError := ""
	if credentials.LinkError != nil {
		updateError = credentials.LinkError.Error()
	}
	var meta *sub.SubscriptionMeta
	if credentials.SubscriptionToken != "" {
		bound, bindError, err := c.bind(ctx, credentials, bindOptions)
		if err != nil {
			updateError = err.Error()
		} else {
			meta = bound
			if bindError != "" {
				updateError = bindError
			}
		}
	}

	// The overview sync rides the login context before the state flips to
	// signed_in: the UI stops polling once signed in, so identity must be
	// present in that flip.
	c.syncOverviewCtx(ctx)

	c.mu.Lock()
	c.state.Status = "signed_in"
	c.state.Subscription = meta
	c.state.UpdateError = updateError
	c.state.Error = ""
	c.state.ErrorCode = ""
	c.cancel = nil
	c.mu.Unlock()
}

func (c *accountController) fail(err error) {
	code := "oauth"
	var accountErr *account.Error
	if errors.As(err, &accountErr) {
		code = accountErr.Code
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.state.Status == "signed_out" && c.cancel == nil {
		// A logout or reset already cleared the flow; do not resurrect an
		// error state over it.
		return
	}
	c.state.Status = "error"
	c.state.ErrorCode = code
	c.state.Error = err.Error()
	c.cancel = nil
}

func (c *accountController) cancelPending() {
	c.mu.Lock()
	cancel := c.cancel
	c.cancel = nil
	// Invalidate any in-flight overview sync so it cannot resurrect state
	// over the reset below.
	c.syncGen++
	c.state = AccountState{Status: "signed_out"}
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (c *accountController) logout(ctx context.Context) ([]sub.SubscriptionMeta, error) {
	c.cancelPending()
	err := c.manager.Logout(ctx)
	removeOverviewCache()
	removed, logoutErr := c.logoutSubs()
	return removed, errors.Join(err, logoutErr)
}

func (c *accountController) refresh(ctx context.Context) (AccountState, error) {
	link, err := c.manager.RefreshLink(ctx)
	if err != nil {
		c.mu.Lock()
		c.state.UpdateError = err.Error()
		state := c.state
		c.mu.Unlock()
		return state, err
	}

	session, err := c.manager.Session()
	if err != nil {
		return c.snapshot(), err
	}
	origin := session.Origin
	if len(link.FallbackDomains) > 0 && origin == account.DefaultOrigin {
		origin = link.FallbackDomains[0]
	}
	credentials := &account.Credentials{
		Origin:            origin,
		SubscriptionToken: link.SubscriptionToken,
		FallbackOrigins:   link.FallbackDomains,
	}
	var meta *sub.SubscriptionMeta
	updateError := ""
	if credentials.SubscriptionToken != "" {
		options := accountBindOptions{}
		if existing := c.listXBond(); existing != nil {
			options.Name = existing.Name
		}
		bound, bindError, err := c.bind(ctx, credentials, options)
		if err != nil {
			updateError = err.Error()
		} else {
			meta = bound
			if bindError != "" {
				updateError = bindError
			}
		}
	}

	c.syncOverviewCtx(ctx)

	c.mu.Lock()
	c.state.Status = "signed_in"
	c.state.Subscription = meta
	c.state.UpdateError = updateError
	c.state.Error = ""
	c.state.ErrorCode = ""
	state := c.state
	c.mu.Unlock()
	return state, nil
}

// syncOverview refreshes the overview in the background; failures keep the
// last cached values visible.
func (c *accountController) syncOverview() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	c.syncOverviewCtx(ctx)
}

func (c *accountController) syncOverviewCtx(ctx context.Context) {
	c.mu.Lock()
	if c.state.Status == "signed_out" {
		c.mu.Unlock()
		return // signed out: nothing to sync
	}
	generation := c.syncGen
	c.mu.Unlock()
	overview, err := c.overview(ctx)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return // signed out: nothing to sync
		}
		c.mu.Lock()
		if c.syncGen == generation {
			c.state.OverviewError = err.Error()
		}
		c.mu.Unlock()
		return
	}
	degraded := ""
	if overview.Service == nil {
		degraded = "service status unavailable"
	}
	if overview.Announcements == nil {
		degraded = joinDegraded(degraded, "notifications unavailable")
	}
	c.mu.Lock()
	if c.syncGen != generation {
		c.mu.Unlock()
		return // superseded by a logout or reset
	}
	c.applyOverviewLocked(overview, degraded)
	c.mu.Unlock()
}

// applyOverviewLocked folds a fetched or cached overview into the state.
// Callers hold c.mu.
func (c *accountController) applyOverviewLocked(overview *clientapi.AccountOverview, degraded string) {
	c.state.Email = overview.Profile.Email
	c.state.Name = overview.Profile.Name
	c.state.Service = overview.Service
	c.state.Announcements = overview.Announcements
	c.state.UnreadCount = overview.UnreadCount
	c.state.ConsoleURL = c.consoleURLLocked()
	c.state.OverviewError = degraded
	if degraded == "" && overview.Profile.Email != "" {
		saveOverviewCache(overview)
	}
}

// consoleURLLocked derives the trusted console entry from the session's own
// origin — the issuer the tokens actually came from, not user input.
func (c *accountController) consoleURLLocked() string {
	session, err := c.manager.Session()
	if err != nil || session.Origin == "" {
		return ""
	}
	return session.Origin + "/dash"
}

func loadOverviewCache() *clientapi.AccountOverview {
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

// saveOverviewCache persists the overview as a display cache. Failures only
// cost boot-time freshness, so they never fail the sync itself.
func saveOverviewCache(overview *clientapi.AccountOverview) {
	data, err := json.MarshalIndent(overview, "", "  ")
	if err != nil {
		return
	}
	_ = atomicfile.Write(paths.AccountOverviewPath(), data, 0o600)
}

func removeOverviewCache() {
	_ = os.Remove(paths.AccountOverviewPath())
}

func joinDegraded(first, second string) string {
	if first == "" {
		return second
	}
	return first + "; " + second
}

func (s *Server) handleAccountStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, s.account.snapshot())
}

func (s *Server) handleAccountLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Origin    string `json:"origin"`
		Name      string `json:"name"`
		Lang      string `json:"lang"`
		Protocol  string `json:"protocol"`
		Device    bool   `json:"device"`
		NoBrowser bool   `json:"noBrowser"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid account login request")
		return
	}
	state := s.account.start(
		account.LoginOptions{
			Origin:      req.Origin,
			Device:      req.Device,
			NoBrowser:   req.NoBrowser,
			OpenBrowser: browser.Open,
		},
		accountBindOptions{Name: req.Name, Lang: req.Lang, Protocol: req.Protocol},
	)
	writeJSON(w, http.StatusOK, state)
}

// handleAccountCancel aborts an in-flight login flow. Restarting the flow
// with a different method needs this: start() refuses while pending, so the
// UI must drop the pending state before switching to the device flow.
func (s *Server) handleAccountCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.account.cancelPending()
	writeJSON(w, http.StatusOK, s.account.snapshot())
}

func (s *Server) handleAccountLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	removed, err := s.account.logout(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "removed": removed})
}

func (s *Server) handleAccountRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	state, _ := s.account.refresh(r.Context())
	// The state carries UpdateError; return it with 200 so the UI can render
	// the retry path instead of treating the session as invalid.
	writeJSON(w, http.StatusOK, state)
}
