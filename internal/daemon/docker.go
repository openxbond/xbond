package daemon

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/openxbond/xbond/internal/diag"
	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/sub"
)

func dockerSubscriptionURL(raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", errors.New("SUB_URL must be an absolute HTTP(S) subscription URL")
	}
	return u.String(), nil
}

// Bootstrap runs only until a configuration has been selected. A saved
// selection wins on restart, including one chosen through the dashboard.
func (s *Server) bootstrapSubscription(ctx context.Context, source string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.subMgr.ActiveID() != "" {
		return nil
	}
	var meta *sub.SubscriptionMeta
	for _, item := range s.subMgr.List() {
		if item.Kind == sub.KindRemote && item.SourceURL == source {
			meta = &item
			break
		}
	}
	if meta == nil {
		var err error
		meta, err = s.subMgr.AddUniversal(source, "Docker subscription", 24, false)
		if err != nil {
			return err
		}
	}
	return s.runtime.bootstrap(ctx, meta.ID)
}

func (c *runtimeController) bootstrap(ctx context.Context, id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.subs.ActiveID() != "" {
		return nil
	}
	if _, err := c.updateLocked(ctx, id, false, nil); err != nil {
		return err
	}
	return c.applyLocked(ctx, runtimeOptions{SubID: id}, true)
}

// Auto-connect retry bounds: the first startup attempt races logon —
// network, ports and the machine service may not be up yet — so failures
// retry a bounded number of times before leaving the daemon honestly down.
// Variables so tests can shorten the wait and bound the attempts.
var (
	autoConnectAttempts   = 3
	autoConnectRetryDelay = 10 * time.Second
)

func (s *Server) runAutostart(ctx context.Context) {
	if s.subMgr.ActiveID() != "" {
		s.autoConnectActive(ctx)
		return
	}
	if s.subscriptionURL == "" {
		return
	}
	for ctx.Err() == nil && s.subMgr.ActiveID() == "" {
		err := s.bootstrapSubscription(ctx, s.subscriptionURL)
		if err == nil || ctx.Err() != nil {
			return
		}
		s.logAutostartFailure(err)
		timer := time.NewTimer(30 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

// autoConnectActive restores the active subscription's connection. Each
// round re-reads the takeover intent: a disconnect recorded while a retry is
// pending stops the loop instead of fighting the user (daemon-runtime spec:
// 主动断开不被重试循环重新连接).
func (s *Server) autoConnectActive(ctx context.Context) {
	for attempt := 1; ; attempt++ {
		if lastTakeoverIntentDisconnected() {
			return
		}
		err := s.runtime.Up(ctx, runtimeOptions{})
		if err == nil || ctx.Err() != nil {
			return
		}
		s.logAutostartFailure(err)
		if attempt >= autoConnectAttempts {
			return
		}
		timer := time.NewTimer(autoConnectRetryDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (s *Server) logAutostartFailure(err error) {
	label := "Auto-connect"
	if s.subscriptionURL != "" {
		label = "Container autostart"
	}
	message := label + ": " + err.Error()
	if s.subscriptionURL != "" {
		message = strings.ReplaceAll(message, s.subscriptionURL, "[subscription URL]")
	}
	message = diag.Redact(message)
	s.engineMgr.RingLog().Append(engine.LogLevelError, message)
	fmt.Fprintln(os.Stderr, message)
}

func (s *Server) useImported(ctx context.Context, id string) error {
	if s.autostart {
		return s.runtime.Up(ctx, runtimeOptions{SubID: id})
	}
	return s.runtime.Use(ctx, id)
}
