//go:build windows

package i18n

import (
	"os"

	"golang.org/x/sys/windows/registry"
)

func detectOSLocale() string {
	if env := os.Getenv("LC_ALL"); env != "" {
		return env
	}
	if env := os.Getenv("LANG"); env != "" {
		return env
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, `Control Panel\International`, registry.QUERY_VALUE)
	if err == nil {
		defer key.Close()
		if val, _, err := key.GetStringValue("LocaleName"); err == nil && val != "" {
			return val
		}
	}
	return ""
}
