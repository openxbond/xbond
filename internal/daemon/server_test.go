package daemon

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/httplocal"
	"github.com/openxbond/xbond/internal/sub"
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
	port := 7895
	if err := client.SetMode(ctx, engine.ModePort, engine.RoutingGlobal, &port, &allowLan); err != nil {
		t.Fatalf("SetMode failed: %v", err)
	}

	statusAfter, _ := client.GetStatus(ctx)
	if statusAfter.Preferences.MixedPort != 7895 || !statusAfter.Preferences.AllowLan {
		t.Errorf("preferences not updated: %+v", statusAfter.Preferences)
	}

	// 3. Add and list subscriptions
	added, err := client.AddSub(ctx, sub.SubTypeUniversal, "", "", nil, "", "", "TestSub", "local.json", 12, true)
	if err != nil {
		t.Fatalf("AddSub failed: %v", err)
	}
	if added.Meta == nil || added.Meta.Name != "TestSub" {
		t.Errorf("expected TestSub, got %+v", added.Meta)
	}
	if added.Activated || added.UpdateError == "" {
		t.Error("failed initial fetch must not activate the saved source")
	}

	subsList, err := client.ListSubs(ctx)
	if err != nil {
		t.Fatalf("ListSubs failed: %v", err)
	}
	if len(subsList.Subscriptions) != 1 {
		t.Errorf("expected 1 sub in list, got %d", len(subsList.Subscriptions))
	}

	// An invalid first import remains saved for retry without becoming active.
	if status, err := client.GetStatus(ctx); err != nil || status.ActiveSub != nil {
		t.Fatalf("failed source became active: %v", err)
	}
	if err := client.Up(ctx, "", "", nil, nil, ""); err == nil {
		t.Error("starting without an active configuration must fail")
	}

	// 5. Test Web UI index.html meta injection
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

	if !strings.Contains(html, `<meta name="localapi-controller" content="`+controllerProxyPath+`">`) ||
		strings.Contains(html, `<meta name="external-controller"`) {
		t.Fatal("dashboard must discover the same-origin controller path")
	}
}

// LocalAPI 的唯一守门逻辑此前零测试：无 token/错 token 必须一律 401，任何
// refactor 反转检查时 CI 都要红（审计 #18 + 安全第一条的配套）。
func TestAuthMiddlewareRejectsMissingAndWrongTokens(t *testing.T) {
	s := &Server{token: "middleware-test-token"}
	handler := s.authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	for name, tc := range map[string]struct {
		token  string
		status int
	}{
		"missing token":   {token: "", status: http.StatusUnauthorized},
		"wrong token":     {token: "wrong", status: http.StatusUnauthorized},
		"correct token":   {token: "middleware-test-token", status: http.StatusOK},
		"prefix of token": {token: "middleware-test", status: http.StatusUnauthorized},
	} {
		req := httptest.NewRequest(http.MethodGet, "/localapi/v0/status", nil)
		if tc.token != "" {
			req.Header.Set("X-XBond-Token", tc.token)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != tc.status {
			t.Errorf("%s: got %d, want %d", name, rec.Code, tc.status)
		}
	}
}

// Host 守卫：rebinding 页面把自家域名解析到 127.0.0.1 后，浏览器发出的
// Host 是攻击者域名——必须一律拒绝；三种 loopback 名（含 IPv6 字面量）
// 是完整白名单。
func TestLoopbackHostGuard(t *testing.T) {
	srv := httptest.NewServer(httplocal.Guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	defer srv.Close()

	for name, tc := range map[string]struct {
		host   string
		status int
	}{
		"loopback IPv4":  {host: "127.0.0.1", status: http.StatusOK},
		"loopback name":  {host: "localhost", status: http.StatusOK},
		"loopback IPv6":  {host: "[::1]", status: http.StatusOK},
		"rebound domain": {host: "evil.example", status: http.StatusForbidden},
		"suffix spoof":   {host: "127.0.0.1.evil.example", status: http.StatusForbidden},
		"lookup-alike":   {host: "127.0.0.2", status: http.StatusForbidden},
	} {
		req, err := http.NewRequest(http.MethodGet, srv.URL, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Host = tc.host
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != tc.status {
			t.Errorf("%s: got %d, want %d", name, resp.StatusCode, tc.status)
		}
	}
}

// 本機任何進程都能連到 loopback 端口：/../.. 之類的路徑絕不能把 web 目錄外
// 的 daemon 私有文件當靜態資源送出去。ServeMux 會把未規範化路徑重定向，這裡
// 固定整條鏈路的可觀測行為：回應裡不得出現文件內容。
func TestWebBlocksPathTraversal(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "xbond-daemon-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)
	t.Setenv("XBOND_DATA_DIR", tempDir)

	webDir := filepath.Join(tempDir, "dist")
	_ = os.MkdirAll(webDir, 0o700)
	_ = os.WriteFile(filepath.Join(webDir, "index.html"), []byte("<!DOCTYPE html><html><body>ok</body></html>"), 0o600)
	secret := "secret-daemon-file-content"
	secretPath := filepath.Join(tempDir, "secret.txt")
	_ = os.WriteFile(secretPath, []byte(secret), 0o600)

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

	for _, path := range []string{"/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt"} {
		req, err := http.NewRequest(http.MethodGet, "http://"+server.Addr()+path, nil)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if strings.Contains(string(body), secret) {
			t.Fatalf("%s: traversal leaked the secret file", path)
		}
	}
}
