package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/openxbond/xbond/internal/account"
	"github.com/openxbond/xbond/internal/clientapi"
	"github.com/openxbond/xbond/internal/sub"
)

type fakeAccountManager struct {
	session     *account.Session
	login       func(context.Context, account.LoginOptions, func(account.Progress)) (*account.Credentials, error)
	link        *clientapi.SubscriptionLink
	refreshErr  error
	refresh     func(context.Context) (*clientapi.SubscriptionLink, error)
	overview    *clientapi.AccountOverview
	overviewErr error
	logoutCalls int
}

func (f *fakeAccountManager) Login(
	ctx context.Context,
	opts account.LoginOptions,
	progress func(account.Progress),
) (*account.Credentials, error) {
	return f.login(ctx, opts, progress)
}

func (f *fakeAccountManager) Session() (*account.Session, error) {
	if f.session == nil {
		return nil, errors.New("no session")
	}
	return f.session, nil
}

func (f *fakeAccountManager) RefreshLink(ctx context.Context) (*clientapi.SubscriptionLink, error) {
	if f.refresh != nil {
		return f.refresh(ctx)
	}
	if f.refreshErr != nil {
		return nil, f.refreshErr
	}
	return f.link, nil
}

func (f *fakeAccountManager) Overview(context.Context) (*clientapi.AccountOverview, error) {
	if f.overviewErr != nil {
		return nil, f.overviewErr
	}
	if f.overview == nil {
		return nil, errors.New("no overview")
	}
	return f.overview, nil
}

func (f *fakeAccountManager) Logout(context.Context) error {
	f.logoutCalls++
	return nil
}

func waitForAccountStatus(t *testing.T, controller *accountController, want string) AccountState {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		state := controller.snapshot()
		if state.Status == want {
			return state
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("account status did not become %q: %+v", want, controller.snapshot())
	return AccountState{}
}

func TestAccountControllerLoginSuccess(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	release := make(chan struct{})
	manager := &fakeAccountManager{}
	manager.login = func(
		ctx context.Context,
		_ account.LoginOptions,
		progress func(account.Progress),
	) (*account.Credentials, error) {
		progress(account.Progress{Method: "device", UserCode: "ABCD-EFGH"})
		select {
		case <-release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		return &account.Credentials{SubscriptionToken: "sub-abc", Origin: "https://sub-01.xbond.dev"}, nil
	}

	bound := &sub.SubscriptionMeta{ID: "sub_x", Name: "XBond", Type: sub.SubTypeXBond}
	controller := newAccountController(
		manager,
		func(context.Context, *account.Credentials, accountBindOptions) (*sub.SubscriptionMeta, string, error) {
			return bound, "", nil
		},
		func() ([]sub.SubscriptionMeta, error) { return nil, nil },
		func() *sub.SubscriptionMeta { return nil },
	)

	state := controller.start(account.LoginOptions{Device: true}, accountBindOptions{})
	if state.Status != "pending" {
		t.Fatalf("expected pending, got %+v", state)
	}
	close(release)

	final := waitForAccountStatus(t, controller, "signed_in")
	if final.Subscription == nil || final.Subscription.ID != bound.ID {
		t.Errorf("subscription not attached: %+v", final.Subscription)
	}
	if final.UserCode != "ABCD-EFGH" {
		t.Errorf("progress not exposed: %+v", final)
	}
}

func TestAccountControllerReportsSubscriptionSyncAfterAuthorization(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	entered := make(chan struct{})
	release := make(chan struct{})
	manager := &fakeAccountManager{
		login: func(context.Context, account.LoginOptions, func(account.Progress)) (*account.Credentials, error) {
			return &account.Credentials{SubscriptionToken: "sub-fixture"}, nil
		},
	}
	controller := newAccountController(manager,
		func(ctx context.Context, _ *account.Credentials, _ accountBindOptions) (*sub.SubscriptionMeta, string, error) {
			close(entered)
			select {
			case <-release:
				return nil, "fixture validation failure", nil
			case <-ctx.Done():
				return nil, "", ctx.Err()
			}
		}, nil, func() *sub.SubscriptionMeta { return nil })
	controller.start(account.LoginOptions{}, accountBindOptions{})
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("subscription sync did not start")
	}
	state, _ := json.Marshal(controller.snapshot())
	close(release)
	if !bytes.Contains(state, []byte(`"phase":"syncing_subscription"`)) {
		t.Errorf("authorization still looks idle during subscription sync: %s", state)
	}
	final := waitForAccountStatus(t, controller, "signed_in")
	if final.UpdateError != "fixture validation failure" {
		t.Fatalf("signed-in session lost its update failure: %+v", final)
	}
	data, _ := json.Marshal(final)
	if bytes.Contains(data, []byte(`"phase":`)) {
		t.Fatalf("finished sync is still marked busy: %s", data)
	}
}

func TestAccountRefreshFailureClearsBusyPhase(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager := &fakeAccountManager{
		session:    &account.Session{Origin: account.DefaultOrigin},
		refreshErr: errors.New("fixture offline"),
	}
	controller := newAccountController(manager, nil, nil, func() *sub.SubscriptionMeta { return nil })
	state, err := controller.refresh(context.Background())
	if err == nil || state.Phase != "" || controller.snapshot().Phase != "" {
		t.Fatalf("failed refresh stayed busy: %+v (%v)", state, err)
	}
	if state.Status != "signed_in" || state.UpdateError != "fixture offline" {
		t.Fatalf("failed refresh lost the valid account session: %+v", state)
	}
}

func TestAccountControllerLoginError(t *testing.T) {
	manager := &fakeAccountManager{
		login: func(context.Context, account.LoginOptions, func(account.Progress)) (*account.Credentials, error) {
			return nil, &account.Error{Code: account.ErrCodeAccessDenied}
		},
	}
	controller := newAccountController(
		manager,
		func(context.Context, *account.Credentials, accountBindOptions) (*sub.SubscriptionMeta, string, error) {
			return nil, "", nil
		},
		func() ([]sub.SubscriptionMeta, error) { return nil, nil },
		func() *sub.SubscriptionMeta { return nil },
	)

	controller.start(account.LoginOptions{}, accountBindOptions{})
	final := waitForAccountStatus(t, controller, "error")
	if final.ErrorCode != account.ErrCodeAccessDenied {
		t.Errorf("error code: got %q", final.ErrorCode)
	}
}

func TestAccountControllerHydrateFromSession(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager := &fakeAccountManager{session: &account.Session{AccessToken: "at", Origin: account.DefaultOrigin}}
	controller := newAccountController(
		manager,
		nil,
		nil,
		func() *sub.SubscriptionMeta { return nil },
	)
	if state := controller.snapshot(); state.Status != "signed_in" {
		t.Fatalf("expected signed_in, got %+v", state)
	}
}

func TestAccountControllerSubscriptionLinkDoesNotEstablishLogin(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	controller := newAccountController(&fakeAccountManager{}, nil, nil, func() *sub.SubscriptionMeta {
		return &sub.SubscriptionMeta{ID: "manual", Type: sub.SubTypeXBond}
	})
	if state := controller.snapshot(); state.Status != "signed_out" || state.Subscription != nil {
		t.Fatalf("a saved link must not impersonate an OAuth session: %+v", state)
	}
}

func TestAccountControllerDeadlineReportsFailure(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager := &fakeAccountManager{login: func(ctx context.Context, _ account.LoginOptions, _ func(account.Progress)) (*account.Credentials, error) {
		return nil, ctx.Err()
	}}
	controller := newAccountController(manager, nil, nil, func() *sub.SubscriptionMeta { return nil })
	controller.state.Status = "pending"
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	controller.run(ctx, account.LoginOptions{}, accountBindOptions{}, controller.syncGen)
	state := controller.snapshot()
	if state.Status != "error" || state.ErrorCode != "timeout" {
		t.Fatalf("expired login remained pending: %+v", state)
	}
}

func TestAccountControllerLogoutInvalidatesRefreshBeforeBinding(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	started, release := make(chan struct{}), make(chan struct{})
	manager := &fakeAccountManager{session: &account.Session{Origin: account.DefaultOrigin}, refresh: func(context.Context) (*clientapi.SubscriptionLink, error) {
		close(started)
		<-release
		return &clientapi.SubscriptionLink{SubscriptionToken: "sub-fixture"}, nil
	}}
	bound := false
	controller := newAccountController(manager, func(context.Context, *account.Credentials, accountBindOptions) (*sub.SubscriptionMeta, string, error) {
		bound = true
		return nil, "", nil
	}, func() ([]sub.SubscriptionMeta, error) { return nil, nil }, func() *sub.SubscriptionMeta { return nil })
	refreshed := make(chan struct{})
	go func() { defer close(refreshed); _, _ = controller.refresh(context.Background()) }()
	<-started
	loggedOut := make(chan struct{})
	go func() { defer close(loggedOut); _, _ = controller.logout(context.Background()) }()
	waitForAccountStatus(t, controller, "signed_out")
	close(release)
	<-refreshed
	<-loggedOut
	if bound || controller.snapshot().Status != "signed_out" {
		t.Fatal("late refresh restored an account after logout")
	}
}

func TestAccountControllerLogoutCancelsPendingLogin(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	started := make(chan struct{})
	manager := &fakeAccountManager{}
	manager.login = func(ctx context.Context, _ account.LoginOptions, _ func(account.Progress)) (*account.Credentials, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	logoutCalled := false
	controller := newAccountController(
		manager,
		func(context.Context, *account.Credentials, accountBindOptions) (*sub.SubscriptionMeta, string, error) {
			return nil, "", nil
		},
		func() ([]sub.SubscriptionMeta, error) {
			logoutCalled = true
			return nil, nil
		},
		func() *sub.SubscriptionMeta { return nil },
	)

	controller.start(account.LoginOptions{}, accountBindOptions{})
	<-started
	removed, err := controller.logout(context.Background())
	if err != nil {
		t.Fatalf("logout: %v", err)
	}
	if removed != nil {
		t.Errorf("unexpected removed subscriptions: %+v", removed)
	}
	if !logoutCalled || manager.logoutCalls != 1 {
		t.Errorf("logout side effects missing: subs=%v manager=%d", logoutCalled, manager.logoutCalls)
	}
	if state := controller.snapshot(); state.Status != "signed_out" {
		t.Fatalf("expected signed_out, got %+v", state)
	}
}

// Cancel drops a pending login so a new one can start with a different
// method: the UI's pending state switches PKCE to the device flow through
// exactly this sequence.
func TestAccountControllerCancelThenRestart(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	started := make(chan struct{})
	var methods []account.LoginOptions
	manager := &fakeAccountManager{}
	manager.login = func(ctx context.Context, opts account.LoginOptions, progress func(account.Progress)) (*account.Credentials, error) {
		methods = append(methods, opts)
		progress(account.Progress{Method: "pkce", AuthURL: "https://cloud.example.invalid/authorize"})
		if len(methods) == 1 {
			close(started)
			<-ctx.Done()
			return nil, ctx.Err()
		}
		return &account.Credentials{SubscriptionToken: "sub-abc", Origin: "https://sub-01.xbond.dev"}, nil
	}
	controller := newAccountController(
		manager,
		func(context.Context, *account.Credentials, accountBindOptions) (*sub.SubscriptionMeta, string, error) {
			return &sub.SubscriptionMeta{ID: "sub_x", Type: sub.SubTypeXBond}, "", nil
		},
		func() ([]sub.SubscriptionMeta, error) { return nil, nil },
		func() *sub.SubscriptionMeta { return nil },
	)

	pending := controller.start(account.LoginOptions{}, accountBindOptions{})
	if pending.Method != "pkce" {
		t.Fatalf("restart not on pkce flow: %+v", pending)
	}
	// The auth URL arrives through the async progress callback, not the
	// synchronous start snapshot.
	deadline := time.Now().Add(2 * time.Second)
	for controller.snapshot().AuthURL == "" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if state := controller.snapshot(); state.AuthURL == "" {
		t.Fatalf("pkce progress never surfaced: %+v", state)
	}
	<-started
	controller.cancelPending()
	if state := controller.snapshot(); state.Status != "signed_out" {
		t.Fatalf("cancel did not reset to signed_out: %+v", state)
	}

	restarted := controller.start(account.LoginOptions{Device: true}, accountBindOptions{})
	if restarted.Method != "device" {
		t.Fatalf("restart not on device flow: %+v", restarted)
	}
	final := waitForAccountStatus(t, controller, "signed_in")
	if final.Subscription == nil {
		t.Errorf("restarted login did not bind: %+v", final)
	}
}

func TestAccountControllerRefreshBindsSubscription(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager := &fakeAccountManager{
		session: &account.Session{AccessToken: "at", Origin: account.DefaultOrigin},
		link: &clientapi.SubscriptionLink{
			SubscriptionToken: "sub-abc",
			FallbackDomains:   []string{"https://sub-01.xbond.dev"},
		},
		overview: &clientapi.AccountOverview{
			Profile:       clientapi.Profile{Email: "user@example.invalid", Name: "User"},
			Service:       &clientapi.ServiceStatus{Plan: "Pro", ServicePeriodEnd: "2026-12-31T00:00:00Z"},
			Announcements: []clientapi.Announcement{},
		},
	}
	var boundToken string
	controller := newAccountController(
		manager,
		func(_ context.Context, credentials *account.Credentials, _ accountBindOptions) (*sub.SubscriptionMeta, string, error) {
			boundToken = credentials.SubscriptionToken
			return &sub.SubscriptionMeta{ID: "sub_x", Name: "XBond", Type: sub.SubTypeXBond}, "", nil
		},
		func() ([]sub.SubscriptionMeta, error) { return nil, nil },
		func() *sub.SubscriptionMeta { return nil },
	)

	state, err := controller.refresh(context.Background())
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if boundToken != "sub-abc" {
		t.Errorf("bind token: got %q", boundToken)
	}
	if state.Status != "signed_in" || state.Subscription == nil {
		t.Errorf("refresh state: %+v", state)
	}
	// The overview folded in: identity, service and a console link derived
	// from the session's own origin.
	if state.Email != "user@example.invalid" || state.Service == nil || state.Service.Plan != "Pro" {
		t.Errorf("overview not folded into state: %+v", state)
	}
	if state.ConsoleURL != "https://www.xbond.net/dash" {
		t.Errorf("unexpected console URL: %q", state.ConsoleURL)
	}
	if loadOverviewCache() == nil {
		t.Error("overview cache not persisted")
	}
}

// Hydrate shows the cached overview immediately even while the Cloud is
// unreachable; a failed background sync surfaces as OverviewError without
// discarding the cache.
func TestAccountControllerHydrateShowsCachedOverviewAndKeepsItOnFailure(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	saveOverviewCache(&clientapi.AccountOverview{
		Profile: clientapi.Profile{Email: "cached@example.invalid", Name: "Cached"},
		Service: &clientapi.ServiceStatus{Plan: "Pro"},
	})
	manager := &fakeAccountManager{
		session:     &account.Session{AccessToken: "at", Origin: account.DefaultOrigin},
		overviewErr: errors.New("cloud down"),
	}
	controller := newAccountController(
		manager,
		nil,
		nil,
		func() *sub.SubscriptionMeta { return nil },
	)

	state := controller.snapshot()
	if state.Email != "cached@example.invalid" || state.Service == nil {
		t.Fatalf("cached overview not shown at hydrate: %+v", state)
	}
	controller.syncOverviewCtx(context.Background())
	state = controller.snapshot()
	if state.OverviewError == "" {
		t.Error("failed overview sync not surfaced")
	}
	if state.Email != "cached@example.invalid" || state.Service == nil {
		t.Errorf("failed sync discarded the cached overview: %+v", state)
	}
}

// Logout clears the cached overview along with the session and subscriptions.
func TestAccountControllerLogoutClearsOverviewAndCache(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager := &fakeAccountManager{
		session: &account.Session{AccessToken: "at", Origin: account.DefaultOrigin},
		overview: &clientapi.AccountOverview{
			Profile:       clientapi.Profile{Email: "user@example.invalid"},
			Announcements: []clientapi.Announcement{},
		},
	}
	controller := newAccountController(
		manager,
		nil,
		func() ([]sub.SubscriptionMeta, error) { return nil, nil },
		func() *sub.SubscriptionMeta { return nil },
	)
	controller.syncOverviewCtx(context.Background())
	if state := controller.snapshot(); state.Email == "" {
		t.Fatalf("overview not synced: %+v", state)
	}

	if _, err := controller.logout(context.Background()); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if loadOverviewCache() != nil {
		t.Error("overview cache survived logout")
	}
	state := controller.snapshot()
	if state.Email != "" || state.Service != nil || state.ConsoleURL != "" {
		t.Errorf("overview fields survived logout: %+v", state)
	}
}
