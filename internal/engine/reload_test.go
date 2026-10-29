package engine

import (
	"context"
	"net"
	"testing"
	"time"
)

func TestReloadRestoresRunningCoreWhenNewListenerCannotStart(t *testing.T) {
	mixedPort, clashPort := getFreePort(t), getFreePort(t)
	config, err := DeriveRuntimeConfig(sampleValidConfig(), ModePort, RoutingRule, mixedPort, false, clashPort, "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	manager := NewManager(100)
	if err := manager.Start(config); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.Stop() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := manager.Client().SelectNode(ctx, "proxy-group", "block"); err != nil {
		t.Fatal(err)
	}

	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	replacement, err := DeriveRuntimeConfig(sampleValidConfig(), ModePort, RoutingGlobal, occupied.Addr().(*net.TCPAddr).Port, false, clashPort, "replacement-secret")
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Reload(replacement, map[string]string{"proxy-group": "direct"}); err == nil {
		t.Fatal("expected the occupied listener to reject the new core")
	}
	if !manager.IsRunning() {
		t.Fatal("failed reload stopped the previously working core")
	}
	status := manager.Status()
	if status.MixedPort != mixedPort || status.RoutingMode != RoutingRule || status.ClashSecret != "test-secret" {
		t.Fatalf("failed reload published replacement metadata: %+v", status)
	}
	for {
		proxies, err := manager.Client().GetProxies(ctx)
		if err != nil {
			t.Fatalf("restored core is not reachable: %v", err)
		}
		if proxies["proxy-group"].Now == "block" {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("replacement subscription selections leaked into the restored core")
		case <-time.After(10 * time.Millisecond):
		}
	}
}
