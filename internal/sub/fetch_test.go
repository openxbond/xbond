package sub

import (
	"context"
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
