package sub

import (
	"testing"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
)

// SetUpdateChannel validates and persists: direct clears any proxy URL,
// proxy requires an absolute http(s)/socks5 URL, unknown channels are
// rejected.
func TestSetUpdateChannelValidatesAndPersists(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	manager, err := NewManager()
	if err != nil {
		t.Fatal(err)
	}
	id := importOverrideFixture(t, manager, "channel_sub", overrideTestSource)

	if err := manager.SetUpdateChannel(id, "proxy", "not-a-url"); err == nil {
		t.Fatal("proxy channel accepted a non-URL")
	}
	if err := manager.SetUpdateChannel(id, "proxy", "http://127.0.0.1:7890"); err != nil {
		t.Fatalf("proxy channel rejected a valid URL: %v", err)
	}
	meta, err := manager.Get(id)
	if err != nil || meta.UpdateChannel != "proxy" || meta.UpdateProxy != "http://127.0.0.1:7890" {
		t.Fatalf("proxy channel not persisted: %+v (%v)", meta, err)
	}

	if err := manager.SetUpdateChannel(id, "self", ""); err != nil {
		t.Fatal(err)
	}
	meta, _ = manager.Get(id)
	if meta.UpdateChannel != "self" || meta.UpdateProxy != "" {
		t.Fatalf("self channel must clear the proxy URL: %+v", meta)
	}

	if err := manager.SetUpdateChannel(id, "dial-up", ""); err == nil {
		t.Fatal("unknown channel accepted")
	}

	if err := manager.SetUpdateChannel(id, "direct", ""); err != nil {
		t.Fatal(err)
	}
	if meta, _ := manager.Get(id); meta.UpdateChannel != "direct" {
		t.Fatalf("direct channel not persisted: %+v", meta)
	}

	// The override of the update channel is independent from the local
	// override layer; both persist side by side.
	if err := manager.SetOverride(id, &engine.SubscriptionOverride{
		RulesAppend: []string{"DOMAIN,x.example.invalid,edge"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := manager.SetUpdateChannel(id, ChannelProxy, "socks5://127.0.0.1:1080"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Override(id); err != nil {
		t.Fatalf("channel change must not touch the override: %v", err)
	}
	_ = paths.SubOverridePath
}
