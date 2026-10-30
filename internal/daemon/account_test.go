package daemon

import (
	"context"
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

func (f *fakeAccountManager) RefreshLink(context.Context) (*clientapi.SubscriptionLink, error) {
	if f.refreshErr != nil {
		return nil, f.refreshErr
	}
	return f.link, nil
}

func (f *fakeAccountManager) Logout() error {
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

func TestAccountControllerLogoutCancelsPendingLogin(t *testing.T) {
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
	removed, err := controller.logout()
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

func TestAccountControllerRefreshBindsSubscription(t *testing.T) {
	manager := &fakeAccountManager{
		session: &account.Session{AccessToken: "at", Origin: account.DefaultOrigin},
		link: &clientapi.SubscriptionLink{
			SubscriptionToken: "sub-abc",
			FallbackDomains:   []string{"https://sub-01.xbond.dev"},
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
}
