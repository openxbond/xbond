package mobile

import (
	"testing"

	"github.com/openxbond/xbond/internal/sub"
)

// 移动端的更新通道必须与 daemon 同一套语义：proxy 通道用存储的代理 URL，
// self 通道如实报错（移动端没有 mixed 端口），未知通道报错——绝不能静默
// 直连（审计 #8：更新通道被无视）。
func TestResolveMobileUpdateProxy(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	mgr, err := sub.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	meta, err := mgr.AddUniversalContent("proxies: []", "resolve-test", 24, true)
	if err != nil {
		t.Fatal(err)
	}

	// 默认（空通道）= 直连
	proxyURL, err := resolveMobileUpdateProxy(mgr, meta.ID)
	if err != nil || proxyURL != "" {
		t.Fatalf("empty channel must resolve to direct, got %q, %v", proxyURL, err)
	}

	// proxy 通道用存储的 URL
	if err := mgr.SetUpdateChannel(meta.ID, "proxy", "http://127.0.0.1:17890"); err != nil {
		t.Fatal(err)
	}
	proxyURL, err = resolveMobileUpdateProxy(mgr, meta.ID)
	if err != nil || proxyURL != "http://127.0.0.1:17890" {
		t.Fatalf("proxy channel must use the stored URL, got %q, %v", proxyURL, err)
	}

	// self 通道：移动端没有 mixed 端口，如实报错
	if err := mgr.SetUpdateChannel(meta.ID, "self", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveMobileUpdateProxy(mgr, meta.ID); err == nil {
		t.Fatal("self channel must error on mobile, not silently go direct")
	}
}
