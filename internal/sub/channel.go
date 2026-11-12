package sub

import (
	"fmt"
	"net/url"
	"strings"
)

// Update channels for a subscription's fetches (client-rethink §四.5): the
// empty value defaults to self for Cloud and direct otherwise; "self" rides
// the daemon's own mixed port while the core runs, and "proxy" uses the saved URL.
const (
	ChannelDirect = "direct"
	ChannelSelf   = "self"
	ChannelProxy  = "proxy"
)

// SetUpdateChannel persists the subscription's update channel. "proxy"
// requires an absolute http(s) or socks5 URL; the other channels clear any
// stored URL.
func (m *Manager) SetUpdateChannel(id, channel, proxyURL string) error {
	meta, err := m.Get(id)
	if err != nil {
		return err
	}
	switch channel {
	case "", ChannelDirect:
		channel, proxyURL = ChannelDirect, ""
	case ChannelSelf:
		proxyURL = ""
	case ChannelProxy:
		if err := validateProxyURL(proxyURL); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unknown update channel %q (expected direct, self or proxy)", channel)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.store.Subscriptions {
		if m.store.Subscriptions[i].ID == meta.ID {
			m.store.Subscriptions[i].UpdateChannel = channel
			m.store.Subscriptions[i].UpdateProxy = proxyURL
			return m.saveStoreLocked()
		}
	}
	return fmt.Errorf("subscription %q not found", meta.ID)
}

func validateProxyURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https" && parsed.Scheme != "socks5") {
		return fmt.Errorf("proxy URL must be an absolute http(s):// or socks5:// URL")
	}
	return nil
}
