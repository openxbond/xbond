package diag

import (
	"regexp"
)

var (
	subTokenRegex    = regexp.MustCompile(`sub-[A-Za-z0-9_-]+`)
	proxyTokenRegex  = regexp.MustCompile(`px-[A-Za-z0-9_-]+`)
	wsPathRegex      = regexp.MustCompile(`/ws/[^\s"'?]+`)
	urlTokenRegex    = regexp.MustCompile(`([?&]token=)[^&\s"'` + "`" + `]+`)
	bearerRegex      = regexp.MustCompile(`(?i)(bearer\s+)[A-Za-z0-9._-]+`)
	passwordJSON     = regexp.MustCompile(`(?i)("(?:password|secret|private_key|uuid|short_id|auth)"\s*:\s*)"[^"]+"`)
	passwordYAML     = regexp.MustCompile(`(?i)((?:password|secret|uuid):\s*)[^\s]+`)
)

func Redact(input string) string {
	res := subTokenRegex.ReplaceAllString(input, "sub-[REDACTED]")
	res = proxyTokenRegex.ReplaceAllString(res, "px-[REDACTED]")
	res = wsPathRegex.ReplaceAllString(res, "/ws/[REDACTED]")
	res = urlTokenRegex.ReplaceAllString(res, "${1}[REDACTED]")
	res = bearerRegex.ReplaceAllString(res, "${1}[REDACTED]")
	res = passwordJSON.ReplaceAllString(res, `${1}"[REDACTED]"`)
	res = passwordYAML.ReplaceAllString(res, `${1}[REDACTED]`)
	return res
}
