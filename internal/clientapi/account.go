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
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Summary      string  `json:"summary,omitempty"`
	Content      string  `json:"content,omitempty"`
	Category     string  `json:"category,omitempty"`
	Tag          *string `json:"tag,omitempty"`
	IsBanner     bool    `json:"isBanner,omitempty"`
	BannerEndsAt *string `json:"bannerEndsAt,omitempty"`
	PublishedAt  string  `json:"publishedAt,omitempty"`
	ReadAt       *string `json:"readAt,omitempty"`
}

// PersonalNotification is one user-targeted notification from
// user.notifications.list (e.g. referral_reward).
type PersonalNotification struct {
	ID        string          `json:"id"`
	Kind      string          `json:"kind"`
	Data      json.RawMessage `json:"data"`
	ReadAt    *string         `json:"readAt,omitempty"`
	CreatedAt string          `json:"createdAt"`
}

// AccountOverview is the account snapshot a signed-in client displays.
// Identity is authoritative; the service and notification reads degrade
// independently (nil parts) so a partial Cloud outage shows what it can.
type AccountOverview struct {
	Profile       Profile                `json:"profile"`
	Service       *ServiceStatus         `json:"service,omitempty"`
	Announcements []Announcement         `json:"announcements,omitempty"`
	Personal      []PersonalNotification `json:"personal,omitempty"`
	UnreadCount   int                    `json:"unreadCount"`
	FetchedAt     time.Time              `json:"fetchedAt"`
}

// NormalizeLanguageHeader maps client UI / locale tags onto Cloud API's
// x-app-language header values ("zh", "zh-HK", "en", "ko", "fa"). Empty or
// unrecognized values return "" so the request leaves the header unset.
func NormalizeLanguageHeader(lang string) string {
	switch strings.ToLower(strings.TrimSpace(lang)) {
	case "zh", "zh-cn", "zh_cn", "zh-sg", "zh_sg", "zh-hans", "zh_hans":
		return "zh"
	case "zh-hk", "zh_hk", "zh-tw", "zh_tw", "zh-mo", "zh_mo", "zh-hant", "zh_hant":
		return "zh-HK"
	case "en", "en-us", "en_us", "en-gb", "en_gb":
		return "en"
	case "ko", "ko-kr", "ko_kr":
		return "ko"
	case "fa", "fa-ir", "fa_ir":
		return "fa"
	default:
		return ""
	}
}

// FetchAccountOverview reads identity, service status and announcements in
// one tRPC batch. Identity failure fails the call (UNAUTHORIZED maps to
// ErrUnauthorized so the refresh-and-retry wrapper can kick in); a failed
// service or notification read leaves its part nil.
func FetchAccountOverview(
	ctx context.Context,
	origin, accessToken, lang string,
) (*AccountOverview, error) {
	headerLang := NormalizeLanguageHeader(lang)
	client := &trpc.Client{
		BaseURL: trimOrigin(origin) + "/api/trpc",
		Authorize: func(r *http.Request) {
			r.Header.Set("Authorization", "Bearer "+accessToken)
			if headerLang != "" {
				r.Header.Set("x-app-language", headerLang)
			}
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
			Items       []Announcement         `json:"items"`
			Personal    []PersonalNotification `json:"personal"`
			UnreadCount int                    `json:"unreadCount"`
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
		overview.Personal = list.Personal
		if overview.Personal == nil {
			overview.Personal = []PersonalNotification{}
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
	lang string,
) (*AccountOverview, error) {
	var overview *AccountOverview
	err := fetchWithRefresh(ctx, origin, token, func(ctx context.Context, access string) error {
		result, fetchErr := FetchAccountOverview(ctx, origin, access, lang)
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

func callNotificationMutation(
	ctx context.Context,
	origin, accessToken, procedure string,
	input any,
	target any,
) error {
	client := &trpc.Client{
		BaseURL: trimOrigin(origin) + "/api/trpc",
		Authorize: func(r *http.Request) {
			r.Header.Set("Authorization", "Bearer "+accessToken)
		},
	}
	results, err := client.Call(ctx, trpc.Procedure{
		Name:     procedure,
		Input:    input,
		Mutation: true,
	})
	if err != nil {
		var httpErr *trpc.HTTPError
		if errors.As(err, &httpErr) && httpErr.Status == http.StatusUnauthorized {
			return ErrUnauthorized
		}
		return fmt.Errorf("%s failed: %w", procedure, err)
	}
	result := results[0]
	if result.Err != nil {
		if result.Err.Code == "UNAUTHORIZED" || result.Err.HTTPStatus == http.StatusUnauthorized {
			return ErrUnauthorized
		}
		return fmt.Errorf("%s rejected: %w", procedure, result.Err)
	}
	if target != nil && len(result.Data) > 0 {
		if err := json.Unmarshal(result.Data, target); err != nil {
			return fmt.Errorf("malformed %s response: %w", procedure, err)
		}
	}
	return nil
}

// MarkAnnouncementRead marks one announcement as read on the Cloud server.
func MarkAnnouncementRead(
	ctx context.Context,
	origin, accessToken, announcementID string,
) error {
	return callNotificationMutation(
		ctx,
		origin,
		accessToken,
		"user.notifications.markRead",
		map[string]string{"announcementId": announcementID},
		nil,
	)
}

// MarkAnnouncementReadWithRefresh marks one announcement read with automatic
// access-token refresh on 401.
func MarkAnnouncementReadWithRefresh(
	ctx context.Context,
	origin string,
	token *oauth2.Token,
	announcementID string,
) error {
	return fetchWithRefresh(ctx, origin, token, func(ctx context.Context, access string) error {
		return MarkAnnouncementRead(ctx, origin, access, announcementID)
	})
}

// MarkPersonalNotificationRead marks one personal notification as read on Cloud.
func MarkPersonalNotificationRead(
	ctx context.Context,
	origin, accessToken, id string,
) error {
	return callNotificationMutation(
		ctx,
		origin,
		accessToken,
		"user.notifications.markPersonalRead",
		map[string]string{"id": id},
		nil,
	)
}

// MarkPersonalNotificationReadWithRefresh marks one personal notification read
// with automatic access-token refresh on 401.
func MarkPersonalNotificationReadWithRefresh(
	ctx context.Context,
	origin string,
	token *oauth2.Token,
	id string,
) error {
	return fetchWithRefresh(ctx, origin, token, func(ctx context.Context, access string) error {
		return MarkPersonalNotificationRead(ctx, origin, access, id)
	})
}

// MarkAllNotificationsRead marks all announcements and personal notifications read.
func MarkAllNotificationsRead(
	ctx context.Context,
	origin, accessToken string,
) (int, error) {
	var out struct {
		Marked int `json:"marked"`
	}
	if err := callNotificationMutation(
		ctx,
		origin,
		accessToken,
		"user.notifications.markAllRead",
		nil,
		&out,
	); err != nil {
		return 0, err
	}
	return out.Marked, nil
}

// MarkAllNotificationsReadWithRefresh marks all notifications read with automatic
// access-token refresh on 401.
func MarkAllNotificationsReadWithRefresh(
	ctx context.Context,
	origin string,
	token *oauth2.Token,
) (int, error) {
	var marked int
	err := fetchWithRefresh(ctx, origin, token, func(ctx context.Context, access string) error {
		count, callErr := MarkAllNotificationsRead(ctx, origin, access)
		if callErr != nil {
			return callErr
		}
		marked = count
		return nil
	})
	return marked, err
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
