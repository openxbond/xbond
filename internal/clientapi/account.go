// Account overview contract for native clients: one tRPC batch reading the
// same procedures the dashboard uses — identity (user.profile.me), service
// status (user.billing.subscription) and announcements
// (user.notifications.list). Contract constants mirror @cloud/core.
package clientapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/openxbond/xbond/internal/trpc"
	"golang.org/x/oauth2"
)

// Profile is what user.profile.me returns: the session user's identity.
type Profile struct {
	Email         string `json:"email"`
	Name          string `json:"name"`
	EmailVerified bool   `json:"emailVerified"`
	Language      string `json:"language"`
}

// ServiceStatus mirrors user.billing.subscription's read shape (the
// billing-enabled form; billing disabled collapses to plan "free").
type ServiceStatus struct {
	Enabled           bool   `json:"enabled"`
	Plan              string `json:"plan"`
	Status            string `json:"status,omitempty"`
	PlanSlug          string `json:"planSlug,omitempty"`
	ServicePeriodEnd  string `json:"servicePeriodEnd,omitempty"`
	QuotaState        string `json:"quotaState,omitempty"`
	DataLimitBytes    *int64 `json:"dataLimitBytes,omitempty"`
	DataUsedBytes     *int64 `json:"dataUsedBytes,omitempty"`
	CancelAtPeriodEnd bool   `json:"cancelAtPeriodEnd"`
}

// Announcement is one published announcement from user.notifications.list.
type Announcement struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Summary     string  `json:"summary,omitempty"`
	Category    string  `json:"category,omitempty"`
	PublishedAt string  `json:"publishedAt,omitempty"`
	ReadAt      *string `json:"readAt,omitempty"`
}

// AccountOverview is the account snapshot a signed-in client displays.
// Identity is authoritative; the service and notification reads degrade
// independently (nil parts) so a partial Cloud outage shows what it can.
type AccountOverview struct {
	Profile       Profile        `json:"profile"`
	Service       *ServiceStatus `json:"service,omitempty"`
	Announcements []Announcement `json:"announcements,omitempty"`
	UnreadCount   int            `json:"unreadCount"`
	FetchedAt     time.Time      `json:"fetchedAt"`
}

// FetchAccountOverview reads identity, service status and announcements in
// one tRPC batch. Identity failure fails the call (UNAUTHORIZED maps to
// ErrUnauthorized so the refresh-and-retry wrapper can kick in); a failed
// service or notification read leaves its part nil.
func FetchAccountOverview(
	ctx context.Context,
	origin, accessToken string,
) (*AccountOverview, error) {
	client := &trpc.Client{
		BaseURL: trimOrigin(origin) + "/api/trpc",
		Authorize: func(r *http.Request) {
			r.Header.Set("Authorization", "Bearer "+accessToken)
		},
	}
	results, err := client.Call(ctx,
		trpc.Procedure{Name: "user.profile.me"},
		trpc.Procedure{Name: "user.billing.subscription"},
		trpc.Procedure{Name: "user.notifications.list"},
	)
	if err != nil {
		var httpErr *trpc.HTTPError
		if errors.As(err, &httpErr) && httpErr.Status == http.StatusUnauthorized {
			return nil, ErrUnauthorized
		}
		return nil, fmt.Errorf("failed to fetch account overview: %w", err)
	}

	overview := &AccountOverview{FetchedAt: time.Now().UTC()}
	if err := unmarshalProfile(results[0], &overview.Profile); err != nil {
		return nil, err
	}
	if results[1].Err == nil {
		var service ServiceStatus
		if err := json.Unmarshal(results[1].Data, &service); err != nil {
			return nil, fmt.Errorf("malformed service status response: %w", err)
		}
		overview.Service = &service
	}
	if results[2].Err == nil {
		var list struct {
			Items       []Announcement `json:"items"`
			UnreadCount int            `json:"unreadCount"`
		}
		if err := json.Unmarshal(results[2].Data, &list); err != nil {
			return nil, fmt.Errorf("malformed notifications response: %w", err)
		}
		// A successful read with no announcements is an empty list, not a
		// failed one: nil means the read itself failed.
		overview.Announcements = list.Items
		if overview.Announcements == nil {
			overview.Announcements = []Announcement{}
		}
		overview.UnreadCount = list.UnreadCount
	}
	return overview, nil
}

func unmarshalProfile(result trpc.Result, profile *Profile) error {
	if result.Err != nil {
		if result.Err.Code == "UNAUTHORIZED" || result.Err.HTTPStatus == http.StatusUnauthorized {
			return ErrUnauthorized
		}
		return fmt.Errorf("profile read rejected: %w", result.Err)
	}
	if err := json.Unmarshal(result.Data, profile); err != nil {
		return fmt.Errorf("malformed profile response: %w", err)
	}
	return nil
}

// FetchAccountOverviewWithRefresh fetches the overview with an
// auto-refreshing token source; a 401 forces one refresh and retries.
// Rotated values are written back into token so callers persisting the token
// set stay current.
func FetchAccountOverviewWithRefresh(
	ctx context.Context,
	origin string,
	token *oauth2.Token,
) (*AccountOverview, error) {
	var overview *AccountOverview
	err := fetchWithRefresh(ctx, origin, token, func(ctx context.Context, access string) error {
		result, fetchErr := FetchAccountOverview(ctx, origin, access)
		if fetchErr != nil {
			return fetchErr
		}
		overview = result
		return nil
	})
	if err != nil {
		return nil, err
	}
	return overview, nil
}

// RevokeToken revokes a token per RFC 7009 at the issuer's revocation
// endpoint. Both valid and invalid tokens yield 200, so only transport
// failures surface as errors; callers treat revocation as best effort.
func RevokeToken(ctx context.Context, origin, token string) error {
	form := url.Values{"token": {token}, "client_id": {ClientID}}
	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost,
		trimOrigin(origin)+"/api/auth/oauth2/revoke",
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	return nil
}
