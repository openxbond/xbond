package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"

	"github.com/openxbond/xbond/internal/account"
	"github.com/openxbond/xbond/internal/clientapi"
	"github.com/openxbond/xbond/internal/i18n"
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

type accountBindOptions struct {
	Name     string
	Lang     string
	Protocol string
	// Use activates the bound subscription. Explicit logins set it (mobile
	// parity: mobile/account.go activates on login); background rotation and
	// recovery refreshes leave it false so they never switch the runtime.
	Use bool
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
	operation  sync.Mutex
	manager    accountLoginManager
	state      AccountState
	cancel     context.CancelFunc
	syncGen    int
	bind       func(context.Context, *account.Credentials, accountBindOptions) (*sub.SubscriptionMeta, string, error)
	logoutSubs func() ([]sub.SubscriptionMeta, error)
	listXBond  func() *sub.SubscriptionMeta
	// Deep-link scheme flow: the browser hands the authorization code to the
	// desktop shell, the shell delivers it through the LocalAPI callback
	// endpoint, and waitSchemeCode unblocks the in-flight flow. One flow at a
	// time (start refuses while pending), so a single slot suffices.
	schemeState string
	codeCh      chan string
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

// Only an OAuth session establishes account identity. A saved subscription
// link permits downloads, but cannot authorize account refresh operations.
func (c *accountController) hydrate() {
	c.mu.Lock()
	c.state = AccountState{Status: "signed_out"}
	if _, err := c.manager.Session(); err == nil {
		c.state.Status = "signed_in"
	}
	if c.state.Status == "signed_in" {
		c.state.Subscription = c.listXBond()
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

func (c *accountController) setPhase(generation int, phase string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.syncGen == generation {
		c.state.Phase = phase
	}
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
	c.syncGen++
	generation := c.syncGen
	c.cancel = cancel
	started := time.Now()
	c.state = AccountState{
		Status:    "pending",
		Phase:     "authorizing",
		Method:    "pkce",
		StartedAt: &started,
	}
	if login.Device {
		c.state.Method = "device"
	}
	if login.RedirectURI != "" {
		c.state.Method = "scheme"
		c.codeCh = make(chan string, 1)
		c.schemeState = ""
		login.WaitCode = c.waitSchemeCode
	}
	c.mu.Unlock()

	go c.run(loginCtx, login, bindOptions, generation)
	return c.snapshot()
}

func (c *accountController) run(
	ctx context.Context,
	login account.LoginOptions,
	bindOptions accountBindOptions,
	generation int,
) {
	credentials, err := c.manager.Login(ctx, login, func(progress account.Progress) {
		c.mu.Lock()
		if ctx.Err() != nil || c.syncGen != generation {
			c.mu.Unlock()
			return
		}
		c.state.Method = progress.Method
		if progress.Phase != "" {
			c.state.Phase = progress.Phase
		}
		c.state.AuthURL = progress.AuthURL
		c.state.VerificationURI = progress.VerificationURI
		c.state.VerificationURIComplete = progress.VerificationURIComplete
		c.state.UserCode = progress.UserCode
		c.mu.Unlock()
	})
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return
		}
		c.fail(err, generation)
		return
	}
	c.operation.Lock()
	defer c.operation.Unlock()
	c.mu.Lock()
	current := c.syncGen == generation
	c.mu.Unlock()
	if !current || errors.Is(ctx.Err(), context.Canceled) {
		return
	}

	updateError := ""
	if credentials.LinkError != nil {
		updateError = credentials.LinkError.Error()
	}
	var meta *sub.SubscriptionMeta
	if credentials.SubscriptionToken != "" {
		c.setPhase(generation, "syncing_subscription")
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
	c.setPhase(generation, "loading_account")
	c.syncOverviewCtx(ctx)

	c.mu.Lock()
	if ctx.Err() != nil || c.syncGen != generation {
		c.mu.Unlock()
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			c.fail(ctx.Err(), generation)
		}
		return
	}
	c.state.Status = "signed_in"
	c.state.Phase = ""
	c.state.Subscription = meta
	c.state.UpdateError = updateError
	c.state.Error = ""
	c.state.ErrorCode = ""
	c.cancel = nil
	c.mu.Unlock()
}

func (c *accountController) fail(err error, generation int) {
	code := "oauth"
	var accountErr *account.Error
	if errors.As(err, &accountErr) {
		code = accountErr.Code
	}
	if errors.Is(err, context.DeadlineExceeded) {
		code = account.ErrCodeTimeout
	}
	c.mu.Lock()
	if generation != c.syncGen {
		c.mu.Unlock()
		return
	}
	defer c.mu.Unlock()
	if c.state.Status == "signed_out" && c.cancel == nil {
		// A logout or reset already cleared the flow; do not resurrect an
		// error state over it.
		return
	}
	c.state.Status = "error"
	c.state.Phase = ""
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
	c.schemeState = ""
	c.codeCh = nil
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (c *accountController) logout(ctx context.Context) ([]sub.SubscriptionMeta, error) {
	c.cancelPending()
	err := c.manager.Logout(ctx)
	c.operation.Lock()
	defer c.operation.Unlock()
	removeOverviewCache()
	removed, logoutErr := c.logoutSubs()
	return removed, errors.Join(err, logoutErr)
}

// refresh re-resolves the subscription link and re-binds it. lang (render
// language for the fetched configuration) comes from the caller's interface
// language; empty keeps the subscription's persisted language.
func (c *accountController) refresh(ctx context.Context, lang string) (result AccountState, err error) {
	c.operation.Lock()
	defer c.operation.Unlock()
	c.mu.Lock()
	generation := c.syncGen
	c.mu.Unlock()
	c.setPhase(generation, "fetching_subscription")
	defer func() {
		c.setPhase(generation, "")
		result.Phase = ""
	}()
	link, err := c.manager.RefreshLink(ctx)
	if err != nil {
		c.mu.Lock()
		if c.syncGen != generation {
			state := c.state
			c.mu.Unlock()
			return state, context.Canceled
		}
		c.state.UpdateError = err.Error()
		var tokenErr *oauth2.RetrieveError
		if errors.Is(err, fs.ErrNotExist) || errors.Is(err, clientapi.ErrUnauthorized) || (errors.As(err, &tokenErr) && tokenErr.ErrorCode == "invalid_grant") {
			c.state.Status = "error"
			c.state.ErrorCode = "session_expired"
			c.state.Error = "Account session expired. Sign in again."
		}
		state := c.state
		c.mu.Unlock()
		return state, err
	}

	session, err := c.manager.Session()
	if err != nil {
		return c.snapshot(), err
	}
	c.mu.Lock()
	current := c.syncGen == generation
	c.mu.Unlock()
	if !current {
		return c.snapshot(), context.Canceled
	}
	origin := session.Origin
	if len(link.FallbackDomains) > 0 && origin == account.DefaultOrigin {
		origin = link.FallbackDomains[0]
	}
	credentials := &account.Credentials{
		Origin:            origin,
		Issuer:            session.Origin,
		SubscriptionToken: link.SubscriptionToken,
		FallbackOrigins:   link.FallbackDomains,
	}
	var meta *sub.SubscriptionMeta
	updateError := ""
	if credentials.SubscriptionToken == "" {
		updateError = "No subscription link is available. Open the Cloud console."
	}
	if credentials.SubscriptionToken != "" {
		c.setPhase(generation, "syncing_subscription")
		options := accountBindOptions{Lang: lang}
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

	c.setPhase(generation, "loading_account")
	c.syncOverviewCtx(ctx)

	c.mu.Lock()
	if c.syncGen != generation {
		state := c.state
		c.mu.Unlock()
		return state, context.Canceled
	}
	c.state.Phase = ""
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

// waitSchemeCode is the account package's code channel for the deep-link
// flow: it records the flow's state so deliverCallback can match the
// browser's answer, then blocks until the desktop shell delivers the code
// or the login context is cancelled.
func (c *accountController) waitSchemeCode(ctx context.Context, state string) (string, error) {
	c.mu.Lock()
	if c.state.Status != "pending" || c.codeCh == nil {
		c.mu.Unlock()
		return "", errors.New("no pending scheme login")
	}
	c.schemeState = state
	ch := c.codeCh
	c.mu.Unlock()

	select {
	case code := <-ch:
		return code, nil
	case <-ctx.Done():
		c.mu.Lock()
		if c.schemeState == state {
			c.schemeState = ""
		}
		c.mu.Unlock()
		return "", ctx.Err()
	}
}

// deliverCallback hands the browser's authorization code to the in-flight
// scheme flow. The state must match the flow that opened the browser; a
// stale or replayed link is rejected instead of guessing.
func (c *accountController) deliverCallback(code, state string) error {
	c.mu.Lock()
	if c.state.Status != "pending" || c.codeCh == nil || state == "" || state != c.schemeState {
		c.mu.Unlock()
		return errors.New("no matching pending authorization")
	}
	c.schemeState = ""
	ch := c.codeCh
	c.mu.Unlock()

	select {
	case ch <- code:
	default:
	}
	return nil
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
		Origin         string `json:"origin"`
		Name           string `json:"name"`
		Lang           string `json:"lang"`
		Protocol       string `json:"protocol"`
		Device         bool   `json:"device"`
		NoBrowser      bool   `json:"noBrowser"`
		CallbackScheme string `json:"callbackScheme"`
		Use            *bool  `json:"use"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid account login request")
		return
	}
	opts := account.LoginOptions{
		Origin:       req.Origin,
		Device:       req.Device,
		NoBrowser:    req.NoBrowser,
		CallbackHTML: i18n.RenderCallbackHTML,
		OpenBrowser:  browser.Open,
	}
	// The desktop app owns the OS deep link; its login asks the daemon to
	// redirect back through the registered custom scheme so the code returns
	// through the shell instead of a loopback listener. Everything else
	// (web, CLI, extension) keeps the loopback path.
	if !req.Device {
		if scheme := strings.ToLower(strings.TrimSpace(req.CallbackScheme)); scheme != "" {
			if !validCallbackScheme(scheme) {
				writeError(w, http.StatusBadRequest, "invalid callback scheme")
				return
			}
			opts.RedirectURI = scheme + "://callback"
		}
	}
	state := s.account.start(
		opts,
		// Signing in is an explicit ask to use the Cloud configuration; the
		// same default as /localapi/v0/login. Rotation refreshes never pass
		// Use, so they keep the current selection.
		accountBindOptions{Name: req.Name, Lang: req.Lang, Protocol: req.Protocol, Use: req.Use == nil || *req.Use},
	)
	writeJSON(w, http.StatusOK, state)
}

// handleAccountCancel aborts an in-flight login flow. Restarting the flow
// with a different method needs this: start() refuses while pending, so the
// UI must drop the pending state before starting over.
func (s *Server) handleAccountCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.account.cancelPending()
	writeJSON(w, http.StatusOK, s.account.snapshot())
}

// handleAccountCallback is the desktop deep-link landing: the shell hands
// over the browser's authorization code and the daemon — the only token
// holder — validates the state and completes the exchange.
func (s *Server) handleAccountCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req struct {
		Code  string `json:"code"`
		State string `json:"state"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid account callback request")
		return
	}
	if req.Code == "" || req.State == "" {
		writeError(w, http.StatusBadRequest, "code and state are required")
		return
	}
	if err := s.account.deliverCallback(req.Code, req.State); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.account.snapshot())
}

// validCallbackScheme matches RFC 3986 scheme syntax; the shell only
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
	var req struct {
		Lang string `json:"lang"`
	}
	// The body is optional: an empty request keeps the persisted render
	// language of the bound subscription.
	if r.Body != nil {
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "invalid account refresh request")
			return
		}
	}
	state, _ := s.account.refresh(r.Context(), req.Lang)
	// The state carries UpdateError; return it with 200 so the UI can render
	// the retry path instead of treating the session as invalid.
	writeJSON(w, http.StatusOK, state)
}
