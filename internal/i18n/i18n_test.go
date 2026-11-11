package i18n

import (
	"embed"
	"encoding/json"
	"maps"
	"slices"
	"strings"
	"testing"
)

func TestNormalize(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"zh-CN", "zh-CN"},
		{"zh_CN", "zh-CN"},
		{"zh-Hans", "zh-CN"},
		{"zh", "zh-CN"},
		{"zh-HK", "zh-HK"},
		{"zh_HK", "zh-HK"},
		{"zh-TW", "zh-HK"},
		{"zh-MO", "zh-HK"},
		{"en", "en"},
		{"en-US", "en"},
		{"en_GB", "en"},
		{"ko", "ko"},
		{"ko-KR", "ko"},
		{"fa", "fa"},
		{"fa-IR", "fa"},
		{"", "zh-HK"},
		{"unknown", "zh-HK"},
	}

	for _, c := range cases {
		actual := Normalize(c.input)
		if actual != c.expected {
			t.Errorf("Normalize(%q) = %q; want %q", c.input, actual, c.expected)
		}
	}
}

func TestDir(t *testing.T) {
	if Dir("fa") != "rtl" {
		t.Errorf("Dir(fa) = %q; want rtl", Dir("fa"))
	}
	for _, l := range []string{"en", "zh-CN", "zh-HK", "ko"} {
		if Dir(l) != "ltr" {
			t.Errorf("Dir(%q) = %q; want ltr", l, Dir(l))
		}
	}
}

//go:embed locales/*.json
var localeFiles embed.FS

// Every locale must define the same message ids, so a missing translation
// fails the build instead of falling back silently.
func TestLocalesCoverSameMessageIDs(t *testing.T) {
	var ids map[string]bool
	for _, tag := range locales {
		buf, err := localeFiles.ReadFile("locales/" + tag + ".json")
		if err != nil {
			t.Fatalf("read %s: %v", tag, err)
		}
		var messages map[string]any
		if err := json.Unmarshal(buf, &messages); err != nil {
			t.Fatalf("parse %s: %v", tag, err)
		}
		keys := slices.Sorted(maps.Keys(messages))
		if ids == nil {
			ids = make(map[string]bool, len(keys))
			for _, k := range keys {
				ids[k] = true
			}
			continue
		}
		for _, k := range keys {
			if !ids[k] {
				t.Errorf("%s defines unexpected message %q", tag, k)
			}
		}
		for _, k := range slices.Collect(maps.Keys(ids)) {
			if !slices.Contains(keys, k) {
				t.Errorf("%s is missing message %q", tag, k)
			}
		}
	}
}

func TestTInterpolates(t *testing.T) {
	msg := T("en", "engine.started", P{"mode": "sysproxy", "routing": "rule", "port": 7890})
	for _, part := range []string{"sysproxy", "rule", "7890"} {
		if !strings.Contains(msg, part) {
			t.Errorf("engine.started = %q; want it to contain %q", msg, part)
		}
	}
}

func TestTMissingIDReturnsID(t *testing.T) {
	if got := T("en", "test.missing_id"); got != "test.missing_id" {
		t.Errorf("T with unknown id = %q; want the id itself", got)
	}
}

func TestTAllLocalesBasicMessages(t *testing.T) {
	for _, tag := range locales {
		for _, id := range []string{"tag.success", "pkce.banner", "device.approved", "engine.started", "status.title", "callback.title"} {
			if msg := T(tag, id); msg == id {
				t.Errorf("%s: message %q fell back to its id", tag, id)
			}
		}
	}
}

func TestRenderCallbackHTML(t *testing.T) {
	html := RenderCallbackHTML("fa")
	for _, want := range []string{`lang="fa"`, `dir="rtl"`, "کلاینت ترمینال آماده است"} {
		if !strings.Contains(html, want) {
			t.Errorf("fa callback html missing %q", want)
		}
	}
	html = RenderCallbackHTML("zh-CN")
	for _, want := range []string{`lang="zh-CN"`, `dir="ltr"`, "终端客户端已就绪"} {
		if !strings.Contains(html, want) {
			t.Errorf("zh-CN callback html missing %q", want)
		}
	}
}

func TestPadCountsCJKAsTwoColumns(t *testing.T) {
	width := func(s string) int {
		w := 0
		for _, r := range s {
			w += runeWidth(r)
		}
		return w
	}
	if got := Pad("端口:", 10); width(got) != 10 {
		t.Errorf("Pad(%q, 10) display width = %d; want 10", "端口:", width(got))
	}
	if got := Pad("Port:", 10); width(got) != 10 {
		t.Errorf("Pad(%q, 10) display width = %d; want 10", "Port:", width(got))
	}
	if got := Pad("本机混合端口:", 8); got != "本机混合端口:" {
		t.Errorf("Pad beyond width must not truncate, got %q", got)
	}
}
