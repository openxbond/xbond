package i18n

import (
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

func TestGetMessages(t *testing.T) {
	langs := []string{"zh-HK", "zh-CN", "en", "ko", "fa"}
	for _, l := range langs {
		msg := Get(l)
		if msg == nil {
			t.Fatalf("Get(%q) returned nil", l)
		}
		if msg.Lang != l {
			t.Errorf("Get(%q).Lang = %q; want %q", l, msg.Lang, l)
		}
		if l == "fa" && msg.Dir != "rtl" {
			t.Errorf("expected rtl for fa, got %q", msg.Dir)
		}
		if l != "fa" && msg.Dir != "ltr" {
			t.Errorf("expected ltr for %s, got %q", l, msg.Dir)
		}
		if msg.TagSuccess == "" || msg.PkceTitleBanner == "" || msg.PageTitle == "" {
			t.Errorf("missing key message fields in language %s", l)
		}
	}
}

func TestRenderCallbackHTML(t *testing.T) {
	// English rendering
	enHTML := RenderCallbackHTML("en")
	if !strings.Contains(enHTML, `<title id="page-title">XBond CLI Authorization Successful</title>`) {
		t.Errorf("expected English title in rendered HTML")
	}
	if !strings.Contains(enHTML, `lang="en"`) {
		t.Errorf("expected lang=\"en\" in rendered HTML")
	}

	// Persian (RTL) rendering
	faHTML := RenderCallbackHTML("fa")
	if !strings.Contains(faHTML, `dir="rtl"`) {
		t.Errorf("expected dir=\"rtl\" in Persian rendered HTML")
	}
	if !strings.Contains(faHTML, `<title id="page-title">احراز هویت XBond CLI با موفقیت انجام شد</title>`) {
		t.Errorf("expected Persian title in rendered HTML")
	}

	// Simplified Chinese rendering
	cnHTML := RenderCallbackHTML("zh-CN")
	if !strings.Contains(cnHTML, `<title id="page-title">XBond CLI 授权成功</title>`) {
		t.Errorf("expected Simplified Chinese title in rendered HTML")
	}
}
