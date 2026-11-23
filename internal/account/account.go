// Package account owns the first-party OAuth session used by the daemon.
//
// The CLI and the desktop UI never talk to the Cloud token endpoint directly:
// the daemon performs the OAuth flow, persists the refreshable token set with
// 0600 permissions, and exposes only login state to LocalAPI consumers.
package account

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/openxbond/xbond/internal/clientapi"
	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"golang.org/x/oauth2"
)

// DefaultOrigin is the primary Cloud issuer used when the caller does not
// pass an explicit origin. Subscription delivery lines may differ and are
// discovered after login.
const DefaultOrigin = "https://www.xbond.net"

// Progress describes an in-flight login step so the UI can render the
// browser URL or the device code while the flow is still pending.
type Progress struct {
	Phase                   string `json:"phase,omitempty"`
	Method                  string `json:"method"`
	AuthURL                 string `json:"authUrl,omitempty"`
	VerificationURI         string `json:"verificationUri,omitempty"`
	VerificationURIComplete string `json:"verificationUriComplete,omitempty"`
	UserCode                string `json:"userCode,omitempty"`
	ExpiresIn               int    `json:"expiresIn,omitempty"`
	Interval                int    `json:"interval,omitempty"`
}

// LoginOptions controls the OAuth flow. Name and Lang are not part of OAuth;
// callers keep them for the subscription bind that follows login.
type LoginOptions struct {
	Origin      string
	Device      bool
	NoBrowser   bool
	OpenBrowser func(string) error
	// CallbackHTML renders the browser callback page. The lang argument is
	// the callback query's lang when present. Nil uses a plain English page.
	CallbackHTML func(lang string) string
	// RedirectURI switches PKCE to the custom-scheme flow: the daemon never
	// opens a loopback listener and the authorization code arrives through
	// WaitCode instead (OS deep link -> desktop shell -> LocalAPI callback).
	// The Cloud must have the scheme registered as an allowed redirect URI
	// for ClientID; mirror of @cloud/core's client-oauth contract.
	RedirectURI string
	// WaitCode blocks until the authorization code for state is delivered.
	// Required with RedirectURI; ignored otherwise.
	WaitCode func(ctx context.Context, state string) (string, error)
}

// Credentials is the result of a successful OAuth login. LinkError means the
// account session is valid but resolving the subscription link failed; the
// session is still saved so a later refresh can retry.
type Credentials struct {
	Token             *oauth2.Token
	Origin            string
	Issuer            string
	SubscriptionToken string
	FallbackOrigins   []string
	LinkError         error
}

// Error carries a machine-readable code so LocalAPI consumers can localize
// the message instead of matching English text.
type Error struct {
	Code string
	Err  error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return e.Err.Error()
	}
	return e.Code
}

func (e *Error) Unwrap() error { return e.Err }

const (
	ErrCodeAccessDenied = "access_denied"
	ErrCodeExpired      = "expired"
	ErrCodeTimeout      = "timeout"
	ErrCodeOAuth        = "oauth"
)

// IsSessionExpired reports whether an error indicates that the account's
// OAuth session or refresh token is no longer valid and requires re-authentication.
func IsSessionExpired(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, clientapi.ErrUnauthorized) {
		return true
	}
	var tokenErr *oauth2.RetrieveError
	if errors.As(err, &tokenErr) {
		code := strings.ToLower(tokenErr.ErrorCode)
		if code == "invalid_grant" || code == "invalid_token" || code == "unauthorized_client" {
			return true
		}
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "invalid_grant") ||
		strings.Contains(msg, "session not found") ||
		strings.Contains(msg, "invalid refresh token") ||
		strings.Contains(msg, "session_expired") ||
		strings.Contains(msg, "unauthorized")
}

// Session is the persisted token set. The refresh token is the durable
// credential; access tokens are rotated by clientapi on use.
type Session struct {
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken,omitempty"`
	TokenType    string    `json:"tokenType,omitempty"`
	Expiry       time.Time `json:"expiry,omitempty"`
	Origin       string    `json:"origin"`
}

func (s *Session) Token() *oauth2.Token {
	return &oauth2.Token{
		AccessToken:  s.AccessToken,
		RefreshToken: s.RefreshToken,
		TokenType:    s.TokenType,
		Expiry:       s.Expiry,
	}
}

type Flow func(context.Context, LoginOptions, func(Progress)) (*oauth2.Token, error)
type LinkFetcher func(context.Context, string, *oauth2.Token) (*clientapi.SubscriptionLink, error)
type OverviewFetcher func(context.Context, string, *oauth2.Token, string) (*clientapi.AccountOverview, error)
type NotificationMarker func(context.Context, string, *oauth2.Token, string) error
type AllNotificationsMarker func(context.Context, string, *oauth2.Token) (int, error)
type TokenRevoker func(context.Context, string, string) error

// Manager owns the persisted session and the OAuth/link operations.
type Manager struct {
	mu                   sync.Mutex
	generation           uint64
	sessionPath          string
	flow                 Flow
	fetchLink            LinkFetcher
	fetchOverview        OverviewFetcher
	markAnnouncementRead NotificationMarker
	markPersonalRead     NotificationMarker
	markAllRead          AllNotificationsMarker
	revoke               TokenRevoker
}

func NewManager(sessionPath string) *Manager {
	return &Manager{
		sessionPath:          sessionPath,
		flow:                 Authenticate,
		fetchLink:            clientapi.FetchSubscriptionLinkWithRefresh,
		fetchOverview:        clientapi.FetchAccountOverviewWithRefresh,
		markAnnouncementRead: clientapi.MarkAnnouncementReadWithRefresh,
		markPersonalRead:     clientapi.MarkPersonalNotificationReadWithRefresh,
		markAllRead:          clientapi.MarkAllNotificationsReadWithRefresh,
		revoke:               clientapi.RevokeToken,
	}
}

// Login runs the OAuth flow, saves the session before resolving the
// subscription link, and reports link failures through Credentials.LinkError
// so a valid login is not thrown away when the Cloud is temporarily down.
func (m *Manager) Login(
	ctx context.Context,
	opts LoginOptions,
	progress func(Progress),
) (*Credentials, error) {
	generation := m.currentGeneration()
	origin, err := NormalizeOrigin(opts.Origin)
	if err != nil {
		return nil, err
	}
	var latestProgress Progress
	token, err := m.flow(ctx, opts, func(value Progress) {
		latestProgress = value
		reportProgress(progress, value)
	})
	if err != nil {
		return nil, err
	}

	session := &Session{
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		TokenType:    token.TokenType,
		Expiry:       token.Expiry,
		Origin:       origin,
	}
	if err := m.saveCurrentSession(ctx, generation, session); err != nil {
		return nil, err
	}

	credentials := &Credentials{Token: token, Origin: origin, Issuer: origin}
	latestProgress.Phase = "fetching_subscription"
	reportProgress(progress, latestProgress)
	link, err := m.fetchLink(ctx, origin, token)
	if err != nil {
		credentials.LinkError = err
		return credentials, nil
	}
	credentials.SubscriptionToken = link.SubscriptionToken
	credentials.FallbackOrigins = link.FallbackDomains
	if origin == DefaultOrigin && len(link.FallbackDomains) > 0 {
		credentials.Origin = link.FallbackDomains[0]
	}
	return credentials, nil
}

// Session returns the persisted session, or fs.ErrNotExist when the user has
// not signed in. Callers must not treat a missing session as an invalid one.
func (m *Manager) Session() (*Session, error) {
	data, err := os.ReadFile(m.sessionPath)
	if err != nil {
		return nil, err
	}
	var session Session
	if err := json.Unmarshal(data, &session); err != nil {
		return nil, err
	}
	return &session, nil
}

func (m *Manager) withSessionToken(
	ctx context.Context,
	fn func(origin string, token *oauth2.Token) error,
) error {
	generation := m.currentGeneration()
	session, err := m.Session()
	if err != nil {
		return err
	}
	token := session.Token()
	if err := fn(session.Origin, token); err != nil {
		return err
	}
	session.AccessToken = token.AccessToken
	session.RefreshToken = token.RefreshToken
	session.TokenType = token.TokenType
	session.Expiry = token.Expiry
	return m.saveCurrentSession(ctx, generation, session)
}

// RefreshLink resolves the subscription link again with the saved session and
// persists any rotated tokens. This is the recovery path after a purchase or a
// temporary Cloud failure.
func (m *Manager) RefreshLink(ctx context.Context) (*clientapi.SubscriptionLink, error) {
	var link *clientapi.SubscriptionLink
	err := m.withSessionToken(ctx, func(origin string, token *oauth2.Token) error {
		var callErr error
		link, callErr = m.fetchLink(ctx, origin, token)
		return callErr
	})
	if err != nil {
		return nil, err
	}
	return link, nil
}

// Overview reads the account overview (identity, service status,
// announcements) with the saved session and persists any rotated tokens.
// It is the read path behind the daemon's account status.
func (m *Manager) Overview(ctx context.Context, lang string) (*clientapi.AccountOverview, error) {
	var overview *clientapi.AccountOverview
	err := m.withSessionToken(ctx, func(origin string, token *oauth2.Token) error {
		var callErr error
		overview, callErr = m.fetchOverview(ctx, origin, token, lang)
		return callErr
	})
	if err != nil {
		return nil, err
	}
	return overview, nil
}

// MarkAnnouncementRead marks one announcement read at the Cloud API and
// persists any rotated OAuth tokens.
func (m *Manager) MarkAnnouncementRead(ctx context.Context, announcementID string) error {
	return m.withSessionToken(ctx, func(origin string, token *oauth2.Token) error {
		return m.markAnnouncementRead(ctx, origin, token, announcementID)
	})
}

// MarkPersonalNotificationRead marks one personal notification read at the
// Cloud API and persists any rotated OAuth tokens.
func (m *Manager) MarkPersonalNotificationRead(ctx context.Context, id string) error {
	return m.withSessionToken(ctx, func(origin string, token *oauth2.Token) error {
		return m.markPersonalRead(ctx, origin, token, id)
	})
}

// MarkAllNotificationsRead marks all announcements and personal notifications
// read at the Cloud API and persists any rotated OAuth tokens.
func (m *Manager) MarkAllNotificationsRead(ctx context.Context) (int, error) {
	var marked int
	err := m.withSessionToken(ctx, func(origin string, token *oauth2.Token) error {
		var callErr error
		marked, callErr = m.markAllRead(ctx, origin, token)
		return callErr
	})
	return marked, err
}

// Logout revokes the refresh chain at the Cloud (best effort: a network
// failure must not strand local credentials) and removes the local session.
// Revoking an already-dead session is a no-op per RFC 7009.
func (m *Manager) Logout(ctx context.Context) error {
	m.mu.Lock()
	session, sessionErr := m.Session()
	m.generation++
	err := os.Remove(m.sessionPath)
	m.mu.Unlock()
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if sessionErr == nil && session.RefreshToken != "" {
		revokeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		_ = m.revoke(revokeCtx, session.Origin, session.RefreshToken)
		cancel()
	}
	return nil
}

func (m *Manager) currentGeneration() uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.generation
}

func (m *Manager) saveCurrentSession(ctx context.Context, generation uint64, session *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if generation != m.generation {
		return context.Canceled
	}
	return SaveSession(m.sessionPath, session)
}

func SaveSession(path string, session *Session) error {
	data, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.Write(path, data, 0o600)
}

// NormalizeOrigin validates a user-supplied issuer and falls back to the
// primary Cloud origin. It is deliberately stricter than url.Parse: the
// issuer must be an absolute http(s) URL, because the token endpoint and
// audience are derived from it.
func NormalizeOrigin(origin string) (string, error) {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return DefaultOrigin, nil
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("invalid origin: expected an absolute http(s) URL")
	}
	return strings.TrimSuffix(strings.TrimRight(origin, "/"), "/"), nil
}
