package daemon

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/openxbond/xbond/internal/engine"

	"github.com/openxbond/xbond/internal/sub"
)

func boolPtr(v bool) *bool { return &v }

func setCoreRunning(t *testing.T, core *testRuntimeCore, running bool) {
	t.Helper()
	core.mu.Lock()
	core.running = running
	core.mu.Unlock()
}

// resolveUpdateProxy turns the update channel into a fetch proxy URL: the
// per-call override wins, "self" rides the daemon's own mixed port only
// while the core runs (a first configuration can never bootstrap through
// itself), "proxy" rides the stored URL, and the channel never silently
// switches on failure.
func TestResolveUpdateProxyFollowsChannelAndBootstrap(t *testing.T) {
	f := newRuntimeFixture(t)
	selfURL := "http://127.0.0.1:7890" // the fixture's default mixed port

	cases := []struct {
		name     string
		channel  string
		proxy    string
		running  bool
		override *bool
		want     string
		wantErr  bool
	}{
		{name: "default-direct", channel: "", proxy: "", running: false, override: nil, want: ""},
		{name: "direct-channel", channel: sub.ChannelDirect, proxy: "", running: true, override: nil, want: ""},
		{name: "self-bootstrap", channel: sub.ChannelSelf, proxy: "", running: false, override: nil, want: ""},
		{name: "self-running", channel: sub.ChannelSelf, proxy: "", running: true, override: nil, want: selfURL},
		{name: "proxy-channel", channel: sub.ChannelProxy, proxy: "socks5://127.0.0.1:1080", running: false, override: nil, want: "socks5://127.0.0.1:1080"},
		{name: "override-local", channel: sub.ChannelDirect, proxy: "", running: false, override: boolPtr(true), want: selfURL},
		{name: "override-direct", channel: sub.ChannelSelf, proxy: "", running: true, override: boolPtr(false), want: ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := f.subs.SetUpdateChannel(f.first.ID, tc.channel, tc.proxy); err != nil {
				t.Fatal(err)
			}
			setCoreRunning(t, f.core, tc.running)
			got, err := f.controller.resolveUpdateProxy(f.first.ID, tc.override)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, got)
			}
		})
	}
}

// A pinned (edited) source is invisible to scheduled updates; a manual
// update removes the pin and fetches fresh content.
func TestUpdateDueSkipsPinnedAndManualUpdateUnpins(t *testing.T) {
	f := newRuntimeFixture(t)
	if err := f.controller.Up(context.Background(), runtimeOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.subs.SetSourcePinned(f.first.ID, true); err != nil {
		t.Fatal(err)
	}

	// Scheduled updates skip the pinned subscription entirely.
	before := f.core.configuration()
	if err := f.controller.UpdateDue(context.Background(), time.Now().Add(48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if meta, _ := f.subs.Get(f.first.ID); !meta.SourcePinned {
		t.Fatal("scheduled update removed the pin")
	}
	if !bytes.Equal(before, f.core.configuration()) {
		t.Fatal("scheduled update changed the running core")
	}

	// A manual update is an explicit ask: it removes the pin.
	if _, err := f.controller.Update(context.Background(), f.first.ID, false, nil); err != nil {
		t.Fatal(err)
	}
	if meta, _ := f.subs.Get(f.first.ID); meta.SourcePinned {
		t.Fatal("manual update did not remove the pin")
	}
}

// TUN takeover fails deterministically before any state changes when the
// daemon lacks the privilege, instead of silently running mixed-only. The
// positive path needs a real privileged adapter, so the test is adaptive:
// it asserts the gating only when the capability is actually absent.
func TestTUNTakeoverGatedOnPrivilege(t *testing.T) {
	f := newRuntimeFixture(t)
	if err := f.controller.Up(context.Background(), runtimeOptions{}); err != nil {
		t.Fatal(err)
	}
	if tunCapability(nil).Tun {
		t.Skip("running privileged or delegated; the negative gate cannot be exercised")
	}

	config := f.core.configuration()
	prefs := f.controller.Preferences()
	err := f.controller.Configure(context.Background(), runtimeOptions{Mode: engine.ModeTun})
	var inputErr *runtimeInputError
	if !errors.As(err, &inputErr) {
		t.Fatalf("TUN without privilege must fail as an input error, got: %v", err)
	}
	if !strings.Contains(err.Error(), "TUN takeover unavailable") {
		t.Fatalf("gate error lacks the actionable prefix: %v", err)
	}
	if !f.core.IsRunning() || !bytes.Equal(config, f.core.configuration()) || f.controller.Preferences() != prefs {
		t.Fatal("the TUN gate disturbed the running core or preferences")
	}
}
