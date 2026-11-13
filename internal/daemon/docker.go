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

func (s *Server) runAutostart(ctx context.Context) {
	if s.subMgr.ActiveID() != "" {
		if err := s.runtime.Up(ctx, runtimeOptions{}); err != nil && ctx.Err() == nil {
			s.logAutostartFailure(err)
		}
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

func (s *Server) logAutostartFailure(err error) {
	message := "Container autostart: " + err.Error()
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
