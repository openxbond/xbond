// Package i18n localizes CLI output and the OAuth callback page.
//
// Messages live in locales/*.json (go-i18n v2 format, embedded) and are
// rendered through go-i18n Localizers with {{.field}} template variables.
// Locale detection (Normalize/Detect/Resolve) stays here; it is policy,
// not translation.
package i18n

import (
	"embed"
	"encoding/json"
	"strings"

	"github.com/nicksnyder/go-i18n/v2/i18n"
	"golang.org/x/text/language"
)

//go:embed templates/auth_callback.html
var authCallbackHTMLTemplate string

//go:embed locales/*.json
var localesFS embed.FS

// P is the template data for a message.
type P = map[string]any

const (
	langDefault = "zh-HK"
	langRTL     = "fa"
)

var locales = []string{"en", "zh-CN", "zh-HK", "ko", "fa"}

var bundle = newBundle()

func newBundle() *i18n.Bundle {
	b := i18n.NewBundle(language.English)
	b.RegisterUnmarshalFunc("json", json.Unmarshal)
	for _, tag := range locales {
		buf, err := localesFS.ReadFile("locales/" + tag + ".json")
		if err != nil {
			panic("i18n: embedded locale file missing: " + err.Error())
		}
		if _, err := b.ParseMessageFileBytes(buf, tag+".json"); err != nil {
			panic("i18n: parse " + tag + ".json: " + err.Error())
		}
	}
	return b
}

func Normalize(code string) string {
	raw := strings.TrimSpace(strings.ToLower(code))
	if raw == "" {
		return langDefault
	}
	raw = strings.ReplaceAll(raw, "_", "-")

	if strings.HasPrefix(raw, "zh-cn") || strings.HasPrefix(raw, "zh-sg") || strings.HasPrefix(raw, "zh-hans") || raw == "zh" {
		return "zh-CN"
	}
	if strings.HasPrefix(raw, "zh") {
		return "zh-HK"
	}
	if strings.HasPrefix(raw, "ko") {
		return "ko"
	}
	if strings.HasPrefix(raw, "fa") {
		return "fa"
	}
	if strings.HasPrefix(raw, "en") {
		return "en"
	}
	return langDefault
}

func Detect() string {
	locale := detectOSLocale()
	if locale != "" {
		return Normalize(locale)
	}
	return langDefault
}

func Resolve(preferred, fallback string) string {
	if preferred != "" {
		return Normalize(preferred)
	}
	if fallback != "" {
		return Normalize(fallback)
	}
	return Detect()
}

// Dir returns the text direction of the normalized language.
func Dir(lang string) string {
	if Normalize(lang) == langRTL {
		return "rtl"
	}
	return "ltr"
}

// T renders the message id in lang. data supplies {{.field}} template
// variables. A missing id returns the id itself so the failure is visible.
func T(lang, id string, data ...P) string {
	cfg := &i18n.LocalizeConfig{MessageID: id}
	if len(data) > 0 {
		cfg.TemplateData = data[0]
	}
	msg, err := i18n.NewLocalizer(bundle, Normalize(lang)).Localize(cfg)
	if err != nil {
		return id
	}
	return msg
}

// Pad extends s with trailing spaces so its terminal display width —
// counting CJK and Hangul runes as two columns — reaches width.
// Status tables align per locale without hand-padded translations.
func Pad(s string, width int) string {
	w := 0
	for _, r := range s {
		w += runeWidth(r)
	}
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}

func runeWidth(r rune) int {
	switch {
	case r >= 0x1100 && r <= 0x115F, // Hangul Jamo
		r >= 0x2E80 && r <= 0x303E, // CJK radicals, punctuation
		r >= 0x3041 && r <= 0x33FF, // Hiragana .. CJK compat
		r >= 0x3400 && r <= 0x4DBF, // CJK ext A
		r >= 0x4E00 && r <= 0x9FFF, // CJK unified
		r >= 0xA000 && r <= 0xA4CF, // Yi
		r >= 0xAC00 && r <= 0xD7A3, // Hangul syllables
		r >= 0xF900 && r <= 0xFAFF, // CJK compat ideographs
		r >= 0xFE30 && r <= 0xFE4F, // CJK compat forms
		r >= 0xFF00 && r <= 0xFF60, // fullwidth forms
		r >= 0xFFE0 && r <= 0xFFE6,
		r >= 0x20000 && r <= 0x3FFFD: // CJK ext B+
		return 2
	default:
		return 1
	}
}

// StatusWidth is the label column width used by status output.
const StatusWidth = 22

func RenderCallbackHTML(lang string) string {
	norm := Normalize(lang)
	m := func(id string) string { return T(norm, id) }
	return strings.NewReplacer(
		"{{LANG}}", norm,
		"{{DIR}}", Dir(norm),
		"{{PAGE_TITLE}}", m("callback.page_title"),
		"{{SUBTITLE}}", m("callback.subtitle"),
		"{{TITLE}}", m("callback.title"),
		"{{DESC}}", m("callback.desc"),
		"{{STATUS}}", m("callback.status"),
		"{{META}}", m("callback.meta"),
		"{{BUTTON}}", m("callback.button"),
		"{{HINT}}", m("callback.hint"),
	).Replace(authCallbackHTMLTemplate)
}
