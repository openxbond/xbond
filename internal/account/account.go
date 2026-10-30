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
}

// Credentials is the result of a successful OAuth login. LinkError means the
// account session is valid but resolving the subscription link failed; the
// session is still saved so a later refresh can retry.
type Credentials struct {
	Token             *oauth2.Token
	Origin            string
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

// Manager owns the persisted session and the OAuth/link operations.
type Manager struct {
	sessionPath string
	flow        Flow
	fetchLink   LinkFetcher
}

func NewManager(sessionPath string) *Manager {
	return &Manager{
		sessionPath: sessionPath,
		flow:        Authenticate,
		fetchLink:   clientapi.FetchSubscriptionLinkWithRefresh,
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
	origin, err := NormalizeOrigin(opts.Origin)
	if err != nil {
		return nil, err
	}
	token, err := m.flow(ctx, opts, progress)
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
	if err := SaveSession(m.sessionPath, session); err != nil {
		return nil, err
	}

	credentials := &Credentials{Token: token, Origin: origin}
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

// RefreshLink resolves the subscription link again with the saved session and
// persists any rotated tokens. This is the recovery path after a purchase or a
// temporary Cloud failure.
func (m *Manager) RefreshLink(ctx context.Context) (*clientapi.SubscriptionLink, error) {
	session, err := m.Session()
	if err != nil {
		return nil, err
	}
	token := session.Token()
	link, err := m.fetchLink(ctx, session.Origin, token)
	if err != nil {
		return nil, err
	}
	session.AccessToken = token.AccessToken
	session.RefreshToken = token.RefreshToken
	session.TokenType = token.TokenType
	session.Expiry = token.Expiry
	if err := SaveSession(m.sessionPath, session); err != nil {
		return nil, err
	}
	return link, nil
}

func (m *Manager) Logout() error {
	if err := os.Remove(m.sessionPath); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
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
