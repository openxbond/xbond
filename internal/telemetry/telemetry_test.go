package telemetry

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/platform/paths"
)

var installIDRe = regexp.MustCompile(`^[0-9a-f]{32}$`)

// withTempDataDir 把数据目录指到临时目录并清空进程内缓存；DataDir() 每次读
// env，ID 缓存是包级变量，测试间必须复位。
func withTempDataDir(t *testing.T) string {
	t.Helper()
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	t.Cleanup(func() {
		mu.Lock()
		cachedID = ""
		mu.Unlock()
	})
	mu.Lock()
	cachedID = ""
	mu.Unlock()
	return paths.DataDir()
}

func TestInstallIDPersistsAndStable(t *testing.T) {
	dir := withTempDataDir(t)

	id := InstallID()
	if !installIDRe.MatchString(id) {
		t.Fatalf("install ID is not 32 lowercase hex chars: %q", id)
	}

	data, err := os.ReadFile(filepath.Join(dir, "install-id"))
	if err != nil {
		t.Fatalf("install-id file not written: %v", err)
	}
	if strings.TrimSpace(string(data)) != id {
		t.Fatalf("file content %q does not match returned ID %q", data, id)
	}

	// 进程重启（清缓存重读文件）后必须拿到同一个 ID，装机口径靠它稳定。
	mu.Lock()
	cachedID = ""
	mu.Unlock()
	if again := InstallID(); again != id {
		t.Fatalf("ID changed after re-read: %q -> %q", id, again)
	}
}

func TestInstallIDReusesExistingValidFile(t *testing.T) {
	dir := withTempDataDir(t)
	// 模拟并发创建的赢家：已有合法文件时必须原样复用，不能覆盖。
	existing := "0123456789abcdef0123456789abcdef"
	if err := os.WriteFile(filepath.Join(dir, "install-id"), []byte(existing+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	if got := InstallID(); got != existing {
		t.Fatalf("existing valid ID not reused: got %q, want %q", got, existing)
	}
}

func TestInstallIDRegeneratesInvalidFile(t *testing.T) {
	dir := withTempDataDir(t)
	if err := os.WriteFile(filepath.Join(dir, "install-id"), []byte("hand-edited-garbage"), 0o600); err != nil {
		t.Fatal(err)
	}

	id := InstallID()
	if !installIDRe.MatchString(id) {
		t.Fatalf("invalid file not regenerated: %q", id)
	}
	data, err := os.ReadFile(filepath.Join(dir, "install-id"))
	if err != nil || strings.TrimSpace(string(data)) != id {
		t.Fatalf("file not rewritten with the new ID: %q err=%v", data, err)
	}
}

func TestInstallIDFailsSoftWithoutDataDir(t *testing.T) {
	// 数据目录路径落在一个普通文件上：MkdirAll 必然失败，ID 返回空、
	// Header 整体不发，而不是 panic 或写坏别处。
	file := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XBOND_DATA_DIR", file)
	mu.Lock()
	cachedID = ""
	mu.Unlock()
	t.Cleanup(func() {
		mu.Lock()
		cachedID = ""
		mu.Unlock()
	})

	if id := InstallID(); id != "" {
		t.Fatalf("expected empty ID when the data dir cannot be created, got %q", id)
	}
	if h := Header(); h != "" {
		t.Fatalf("expected no beacon header without an install ID, got %q", h)
	}
}

func TestHeaderShape(t *testing.T) {
	withTempDataDir(t)

	h := Header()
	if h == "" {
		t.Fatal("header is empty with a usable data dir")
	}

	fields := map[string]string{}
	for _, pair := range strings.Split(h, "; ") {
		key, value, found := strings.Cut(pair, "=")
		if !found || key == "" || value == "" {
			t.Fatalf("malformed field %q in header %q", pair, h)
		}
		fields[key] = value
	}
	for _, key := range []string{"id", "app", "os", "arch"} {
		if fields[key] == "" {
			t.Fatalf("header %q missing field %q", h, key)
		}
	}
	if !installIDRe.MatchString(fields["id"]) {
		t.Fatalf("id field is not a bare 32-hex install ID: %q", fields["id"])
	}
	// osv 在能探测的系统上出现（本机为 linux/darwin/windows 之一），
	// android 等为空——两种形态都合法，这里只验证出现时的形态。
	if osv, ok := fields["osv"]; ok && strings.ContainsAny(osv, ";= ") {
		t.Fatalf("osv must be a bare version token: %q", osv)
	}
}
