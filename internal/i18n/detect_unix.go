//go:build !windows

package i18n

import (
	"os"
)

func detectOSLocale() string {
	if env := os.Getenv("LC_ALL"); env != "" {
		return env
	}
	if env := os.Getenv("LANG"); env != "" {
		return env
	}
	if env := os.Getenv("LC_MESSAGES"); env != "" {
		return env
	}
	return ""
}
