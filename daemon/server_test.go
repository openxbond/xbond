package daemon

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/openxbond/xbond/engine"
	"github.com/openxbond/xbond/sub"
)

func TestLocalAPIServerAndClient(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "xbond-daemon-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)
	t.Setenv("XBOND_DATA_DIR", tempDir)

	// Create web dist mock
	webDir := filepath.Join(tempDir, "dist")
	_ = os.MkdirAll(webDir, 0o700)
	_ = os.WriteFile(filepath.Join(webDir, "index.html"), []byte(`<!DOCTYPE html><html><head><title>XBond</title></head><body>Hello</body></html>`), 0o600)

	server, err := NewServer("127.0.0.1:0", webDir)
	if err != nil {
		t.Fatalf("NewServer failed: %v", err)
	}

	go func() {
		_ = server.Start()
	}()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Stop(ctx)
	}()

	client, err := NewClient()
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 1. GetStatus
	status, err := client.GetStatus(ctx)
	if err != nil {
		t.Fatalf("GetStatus failed: %v", err)
	}
	if status.Preferences.MixedPort != 7890 {
		t.Errorf("expected mixedPort 7890, got %d", status.Preferences.MixedPort)
	}

	// 2. SetMode
	allowLan := true
	if err := client.SetMode(ctx, engine.ModePort, engine.RoutingGlobal, 7895, &allowLan); err != nil {
		t.Fatalf("SetMode failed: %v", err)
	}

	statusAfter, _ := client.GetStatus(ctx)
	if statusAfter.Preferences.MixedPort != 7895 || !statusAfter.Preferences.AllowLan {
		t.Errorf("preferences not updated: %+v", statusAfter.Preferences)
	}

	// 3. Add and list subscriptions
	addedMeta, err := client.AddSub(ctx, sub.SubTypeUniversal, "", "", nil, "", "", "TestSub", "local.json", 12, true)
	if err != nil {
		t.Fatalf("AddSub failed: %v", err)
	}
	if addedMeta.Name != "TestSub" {
		t.Errorf("expected TestSub, got %s", addedMeta.Name)
	}

	subsList, err := client.ListSubs(ctx)
	if err != nil {
		t.Fatalf("ListSubs failed: %v", err)
	}
	if len(subsList.Subscriptions) != 1 {
		t.Errorf("expected 1 sub in list, got %d", len(subsList.Subscriptions))
	}

	// 4. Test Web UI index.html meta injection
	resp, err := http.Get(fmt.Sprintf("http://%s/", server.Addr()))
	if err != nil {
		t.Fatalf("failed to get web index: %v", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := os.ReadFile(filepath.Join(webDir, "index.html"))
	_ = bodyBytes

	var buf [2048]byte
	n, _ := resp.Body.Read(buf[:])
	html := string(buf[:n])

	if !strings.Contains(html, `<meta name="external-controller"`) {
		t.Errorf("expected meta external-controller injected into html, got:\n%s", html)
	}
}
