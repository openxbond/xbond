package i18n

import (
	_ "embed"
	"strings"
)

//go:embed templates/auth_callback.html
var authCallbackHTMLTemplate string

func Normalize(code string) string {
	raw := strings.TrimSpace(strings.ToLower(code))
	if raw == "" {
		return "zh-HK"
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
	return "zh-HK"
}

func Detect() string {
	locale := detectOSLocale()
	if locale != "" {
		return Normalize(locale)
	}
	return "zh-HK"
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

func Get(lang string) *Messages {
	norm := Normalize(lang)
	if msg, ok := messagesMap[norm]; ok {
		return msg
	}
	return messagesMap["zh-HK"]
}

func RenderCallbackHTML(lang string) string {
	msg := Get(lang)
	return strings.NewReplacer(
		"{{LANG}}", msg.Lang,
		"{{DIR}}", msg.Dir,
		"{{PAGE_TITLE}}", msg.PageTitle,
		"{{SUBTITLE}}", msg.HtmlSubtitle,
		"{{TITLE}}", msg.HtmlTitle,
		"{{DESC}}", msg.HtmlDesc,
		"{{STATUS}}", msg.HtmlStatus,
		"{{META}}", msg.HtmlMeta,
		"{{BUTTON}}", msg.HtmlButton,
		"{{HINT}}", msg.HtmlHint,
	).Replace(authCallbackHTMLTemplate)
}
