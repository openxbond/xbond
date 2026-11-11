package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/openxbond/xbond/internal/daemon"
)

const progressPollInterval = 500 * time.Millisecond

const progressBarWidth = 28

// withFetchProgress runs fn while rendering the daemon's subscription config
// download progress on stderr. The progress line is ASCII-only so the \r
// overwrite math stays byte-accurate; localized hints go on their own lines.
func withFetchProgress(ctx context.Context, client *daemon.Client, fn func() error) error {
	done := make(chan struct{})
	var fnErr error
	go func() {
		defer close(done)
		fnErr = fn()
	}()
	pollFetchProgress(ctx, client, done)
	return fnErr
}

func pollFetchProgress(ctx context.Context, client *daemon.Client, done <-chan struct{}) {
	ticker := time.NewTicker(progressPollInterval)
	defer ticker.Stop()

	frames := []string{"|", "/", "-", "\\"}
	frame := 0
	lastLen := 0
	clear := func() {
		if lastLen > 0 {
			fmt.Fprintf(os.Stderr, "\r%s\r", strings.Repeat(" ", lastLen))
			lastLen = 0
		}
	}

	for {
		select {
		case <-done:
			clear()
			return
		case <-ctx.Done():
			clear()
			return
		case <-ticker.C:
			progress, err := client.SubscriptionProgress(ctx)
			if err != nil || !progress.Active {
				continue
			}
			frame = (frame + 1) % len(frames)
			line := renderFetchProgressLine(frames[frame], progress.Bytes, progress.Total)
			fmt.Fprintf(os.Stderr, "\r%s", line)
			pad := lastLen - len(line)
			if pad > 0 {
				fmt.Fprint(os.Stderr, strings.Repeat(" ", pad))
			}
			lastLen = len(line) + max(pad, 0)
		}
	}
}

func renderFetchProgressLine(frame string, read, total int64) string {
	downloaded := formatProgressBytes(read)
	if total <= 0 {
		return fmt.Sprintf("downloading config %s %s", frame, downloaded)
	}
	percent := float64(read) / float64(total)
	if percent > 1 {
		percent = 1
	}
	filled := int(percent * progressBarWidth)
	if filled > progressBarWidth {
		filled = progressBarWidth
	}
	bar := strings.Repeat("=", filled)
	if filled < progressBarWidth {
		bar += ">" + strings.Repeat(" ", progressBarWidth-filled-1)
	}
	return fmt.Sprintf("downloading config [%s] %3.0f%% %s/%s", bar, percent*100, downloaded, formatProgressBytes(total))
}

func formatProgressBytes(n int64) string {
	switch {
	case n >= 1024*1024:
		return fmt.Sprintf("%.1f MB", float64(n)/(1024*1024))
	case n >= 1024:
		return fmt.Sprintf("%.0f KB", float64(n)/1024)
	default:
		return fmt.Sprintf("%d B", n)
	}
}
