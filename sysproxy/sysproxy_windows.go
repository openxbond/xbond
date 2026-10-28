//go:build windows

package sysproxy

import (
	"fmt"
	"time"

	"golang.org/x/sys/windows/registry"
)

const internetSettingsKey = `Software\Microsoft\Windows\CurrentVersion\Internet Settings`

func Get() (Snapshot, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsKey, registry.QUERY_VALUE)
	if err != nil {
		return Snapshot{}, fmt.Errorf("failed to open registry key: %w", err)
	}
	defer k.Close()

	enable, _, err := k.GetIntegerValue("ProxyEnable")
	if err != nil {
		enable = 0
	}

	server, _, err := k.GetStringValue("ProxyServer")
	if err != nil {
		server = ""
	}

	bypass, _, err := k.GetStringValue("ProxyOverride")
	if err != nil {
		bypass = ""
	}

	return Snapshot{
		Enabled:   enable == 1,
		Server:    server,
		Bypass:    bypass,
		Timestamp: time.Now().Unix(),
	}, nil
}

func Set(server string, bypass string) error {
	current, err := Get()
	if err == nil {
		_ = SaveSnapshot(current)
	}

	k, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("failed to open registry key for writing: %w", err)
	}
	defer k.Close()

	if err := k.SetDWordValue("ProxyEnable", 1); err != nil {
		return err
	}
	if err := k.SetStringValue("ProxyServer", server); err != nil {
		return err
	}
	if bypass == "" {
		bypass = "localhost;127.*;10.*;172.16.*;192.168.*;<local>"
	}
	if err := k.SetStringValue("ProxyOverride", bypass); err != nil {
		return err
	}

	return nil
}

func Disable() error {
	k, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("failed to open registry key for writing: %w", err)
	}
	defer k.Close()

	if err := k.SetDWordValue("ProxyEnable", 0); err != nil {
		return err
	}
	ClearSnapshot()
	return nil
}
