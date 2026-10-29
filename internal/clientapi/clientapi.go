// Package clientapi speaks the cloud API's client-facing surfaces: the
// Better Auth OAuth endpoints (PKCE authorization-code + RFC 8628 device
// flow) and the tRPC batch endpoint the login flow uses for subscription
// link discovery.
//
// OAuth protocol plumbing rides golang.org/x/oauth2 (PKCE helpers, device
// polling with slow-down handling, token refresh); this package only pins
// the endpoint/contract. Contract constants mirror @cloud/core's
// client-oauth module (packages/core/client-oauth); keep both sides in sync.
package clientapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/openxbond/xbond/internal/trpc"
	"golang.org/x/oauth2"
)

const (
	// ClientID is the first-party public client shared by client apps.
	ClientID = "xbond-app"
	// SubscriptionResource binds issued access tokens (RFC 8707). It is an
	// identifier, not a fetched URL; requests must carry it on the authorize,
	// device-code and token calls or the server issues opaque tokens.
	SubscriptionResource = "urn:xbond:api:subscription"
	// Scope requests subscription-config access plus a rotating refresh token.
	Scope = "api offline_access"
)

// ErrUnauthorized marks a 401 from the tRPC endpoint so the caller can
// refresh the access token once and retry.
var ErrUnauthorized = errors.New("unauthorized")

// NewConfig builds the OAuth client for the deployment origin. The client is
// public (no secret): client_id rides in the request body.
func NewConfig(origin string) *oauth2.Config {
	origin = trimOrigin(origin)
	return &oauth2.Config{
		ClientID: ClientID,
		Scopes:   strings.Fields(Scope),
		Endpoint: oauth2.Endpoint{
			AuthURL:       origin + "/api/auth/oauth2/authorize",
			DeviceAuthURL: origin + "/api/auth/device/code",
			TokenURL:      origin + "/api/auth/oauth2/token",
			AuthStyle:     oauth2.AuthStyleInParams,
		},
	}
}

// ResourceOption passes the RFC 8707 resource indicator to any endpoint
// call. Without it the server issues opaque tokens instead of JWTs.
func ResourceOption() oauth2.AuthCodeOption {
	return oauth2.SetAuthURLParam("resource", SubscriptionResource)
}

// SubscriptionLink is what user.credentials.subscriptionLink returns: the
// private config URL's credential and the gateway line domains. Lines are
// dynamic (dash-managed) and must never be hardcoded client-side.
type SubscriptionLink struct {
	SubscriptionToken string
	FallbackDomains   []string
}

func trimOrigin(origin string) string {
	origin = strings.TrimSuffix(strings.TrimRight(origin, "/"), "/")
	if origin == "" {
		return "https://www.xbond.net"
	}
	return origin
}

// FetchSubscriptionLink resolves the subscription credential and gateway line
// domains through the same tRPC procedure the dashboard uses
// (user.credentials.subscriptionLink, batch protocol, Bearer-authenticated).
func FetchSubscriptionLink(
	ctx context.Context,
	origin, accessToken string,
) (*SubscriptionLink, error) {
	client := &trpc.Client{
		BaseURL: trimOrigin(origin) + "/api/trpc",
		Authorize: func(r *http.Request) {
			r.Header.Set("Authorization", "Bearer "+accessToken)
		},
	}
	results, err := client.Call(ctx,
		trpc.Procedure{Name: "user.credentials.subscriptionLink"},
	)
	if err != nil {
		// 传输层 401（无批量体的裸拒绝）与过程级 UNAUTHORIZED 都映射为
		// ErrUnauthorized，调用方的刷新重试据此触发。
		var httpErr *trpc.HTTPError
		if errors.As(err, &httpErr) && httpErr.Status == http.StatusUnauthorized {
			return nil, ErrUnauthorized
		}
		return nil, fmt.Errorf("failed to fetch subscription link: %w", err)
	}
	result := results[0]
	if result.Err != nil {
		if result.Err.Code == "UNAUTHORIZED" || result.Err.HTTPStatus == http.StatusUnauthorized {
			return nil, ErrUnauthorized
		}
		return nil, fmt.Errorf("subscription link rejected: %w", result.Err)
	}

	var data struct {
		SubscriptionToken *string   `json:"subscriptionToken"`
		FallbackDomains   *[]string `json:"fallbackDomains"`
	}
	if err := json.Unmarshal(result.Data, &data); err != nil {
		return nil, fmt.Errorf("malformed subscription link response: %w", err)
	}
	link := &SubscriptionLink{FallbackDomains: []string{}}
	if data.SubscriptionToken != nil {
		link.SubscriptionToken = *data.SubscriptionToken
	}
	if data.FallbackDomains != nil {
		link.FallbackDomains = *data.FallbackDomains
	}
	return link, nil
}

// FetchSubscriptionLinkWithRefresh fetches the link with an auto-refreshing
// token source; a 401 (server-side revocation/rotation the source cannot
// foresee) forces one refresh and retries. Rotated values are written back
// into token so callers persisting the token set stay current.
func FetchSubscriptionLinkWithRefresh(
	ctx context.Context,
	origin string,
	token *oauth2.Token,
) (*SubscriptionLink, error) {
	conf := NewConfig(origin)
	src := conf.TokenSource(ctx, token)
	current, err := src.Token()
	if err != nil {
		return nil, err
	}
	link, err := FetchSubscriptionLink(ctx, origin, current.AccessToken)
	if !errors.Is(err, ErrUnauthorized) {
		return link, err
	}
	// Force a refresh independent of the source's expiry cache.
	forced := &oauth2.Token{RefreshToken: current.RefreshToken}
	refreshed, refreshErr := conf.TokenSource(ctx, forced).Token()
	if refreshErr != nil {
		return nil, errors.Join(err, refreshErr)
	}
	token.AccessToken = refreshed.AccessToken
	token.RefreshToken = refreshed.RefreshToken
	token.Expiry = refreshed.Expiry
	return FetchSubscriptionLink(ctx, origin, token.AccessToken)
}
