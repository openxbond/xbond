package sub

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 订阅 token 随 URL query 发送，而 url.Error 的消息会原样嵌入完整 URL：
// 拉取失败时错误文本若不脱敏，token 就会进入持久化的 LastErrorMessage、
// /subs 响应与 CLI 输出。这里是审计发现 #15 的直接行为证明。
func TestFetchSubscriptionErrorRedactsToken(t *testing.T) {
	token := "sub-audit-fixture-token"
	fetchURL := "https://127.0.0.1:1/api/subscription/config?token=" + token

	resp, err := FetchSubscription(context.Background(), fetchURL, FetchOptions{Timeout: 2 * time.Second})
	if err == nil {
		t.Fatal("expected the fetch to fail against the closed port")
	}
	if strings.Contains(err.Error(), token) {
		t.Fatalf("returned error carries the token: %v", err)
	}
	if resp != nil && strings.Contains(resp.ErrorMessage, token) {
		t.Fatalf("response error message carries the token: %q", resp.ErrorMessage)
	}
}

func TestRedactURL(t *testing.T) {
	if got := redactURL("https://airport.example/api/sub?token=abc&target=clash"); got != "https://airport.example/api/sub" {
		t.Fatalf("query not stripped: %q", got)
	}
	if got := redactURL("https://user:pass@airport.example/sub"); got != "https://airport.example/sub" {
		t.Fatalf("userinfo not stripped: %q", got)
	}
	if got := redactURL("weird input"); strings.ContainsAny(got, "?@") {
		t.Fatalf("redacted URL must not carry query or userinfo: %q", got)
	}
}

// 安装信标只随 XBond 自有抓取发送：调用方设置 InstallHeader 才带头，
// 第三方（universal）订阅走同一 HTTP 栈但保持原样。
func TestFetchSubscriptionInstallHeader(t *testing.T) {
	var got http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Clone()
		w.Header().Set("ETag", `"test-etag"`)
		_, _ = w.Write([]byte("{}"))
	}))
	defer srv.Close()

	const beacon = "id=0123456789abcdef0123456789abcdef; app=0.1.0; os=linux; arch=amd64"
	if _, err := FetchSubscription(context.Background(), srv.URL, FetchOptions{InstallHeader: beacon}); err != nil {
		t.Fatalf("fetch failed: %v", err)
	}
	if got.Get("X-XBond-Install") != beacon {
		t.Fatalf("install beacon not sent verbatim: %q", got.Get("X-XBond-Install"))
	}

	got = nil
	if _, err := FetchSubscription(context.Background(), srv.URL, FetchOptions{}); err != nil {
		t.Fatalf("fetch failed: %v", err)
	}
	if got.Get("X-XBond-Install") != "" {
		t.Fatalf("install beacon must be omitted when unset: %q", got.Get("X-XBond-Install"))
	}
}
