package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/openxbond/xbond/internal/account"
	"github.com/openxbond/xbond/internal/clientapi"
	"github.com/openxbond/xbond/internal/platform/browser"
	"github.com/openxbond/xbond/internal/sub"
)

// AccountState is the only account shape LocalAPI consumers see. The OAuth
// token set never leaves the daemon.
type AccountState struct {
	Status                  string                `json:"status"`
	Method                  string                `json:"method,omitempty"`
	AuthURL                 string                `json:"authUrl,omitempty"`
	VerificationURI         string                `json:"verificationUri,omitempty"`
	VerificationURIComplete string                `json:"verificationUriComplete,omitempty"`
	UserCode                string                `json:"userCode,omitempty"`
	ErrorCode               string                `json:"errorCode,omitempty"`
	Error                   string                `json:"error,omitempty"`
	StartedAt               *time.Time            `json:"startedAt,omitempty"`
	Subscription            *sub.SubscriptionMeta `json:"subscription,omitempty"`
	UpdateError             string                `json:"updateError,omitempty"`
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
	Logout() error
}

type accountController struct {
	mu         sync.Mutex
	manager    accountLoginManager
	state      AccountState
	cancel     context.CancelFunc
	bind       func(context.Context, *account.Credentials, accountBindOptions) (*sub.SubscriptionMeta, string, error)
	logoutSubs func() ([]sub.SubscriptionMeta, error)
	listXBond  func() *sub.SubscriptionMeta
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
	controller.hydrate()
	return controller
}

// hydrate derives the initial state from persisted evidence. An XBond
// subscription created by the CLI also counts as signed in: the subscription
// token is the durable credential the daemon already owns.
func (c *accountController) hydrate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.state = AccountState{Status: "signed_out"}
	if _, err := c.manager.Session(); err == nil {
		c.state.Status = "signed_in"
	}
	if meta := c.listXBond(); meta != nil {
		c.state.Status = "signed_in"
		c.state.Subscription = meta
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
	c.state.Status = "error"
	c.state.ErrorCode = code
	c.state.Error = err.Error()
	c.cancel = nil
	c.mu.Unlock()
}

func (c *accountController) cancelPending() {
	c.mu.Lock()
	cancel := c.cancel
	c.cancel = nil
	c.state = AccountState{Status: "signed_out"}
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (c *accountController) logout() ([]sub.SubscriptionMeta, error) {
	c.cancelPending()
	err := c.manager.Logout()
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

func (s *Server) handleAccountLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	removed, err := s.account.logout()
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
