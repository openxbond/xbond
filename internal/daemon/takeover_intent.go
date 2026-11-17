package daemon

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/openxbond/xbond/internal/platform/atomicfile"
	"github.com/openxbond/xbond/internal/platform/paths"
)

// The takeover intent is the persisted record of the last explicit user
// action on the connection. Startup auto-connect reads it to tell three
// different facts apart: the user connected (restore on boot), the user
// disconnected (stay down, never auto-reconnected), and the process merely
// exited or died while connected (restore on boot — quitting, `daemon stop`
// and crashes clean up the runtime without touching this file).
type takeoverIntent string

const (
	takeoverIntentConnected    takeoverIntent = "connected"
	takeoverIntentDisconnected takeoverIntent = "disconnected"
)

// recordTakeoverIntent persists an explicit connect or disconnect. The
// intent only gates the next startup's auto-connect, so a write failure must
// not fail the action that produced it — callers log it instead.
func recordTakeoverIntent(intent takeoverIntent) error {
	data, err := json.MarshalIndent(map[string]string{"intent": string(intent)}, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.Write(paths.TakeoverIntentPath(), data, 0o600)
}

// loadTakeoverIntent returns the recorded intent, or an error when no
// explicit action was ever taken or the record is unreadable. Callers treat
// an unreadable record like an absent one: no evidence of a disconnect.
func loadTakeoverIntent() (takeoverIntent, error) {
	data, err := os.ReadFile(paths.TakeoverIntentPath())
	if err != nil {
		return "", err
	}
	var record struct {
		Intent string `json:"intent"`
	}
	if err := json.Unmarshal(data, &record); err != nil {
		return "", fmt.Errorf("decode takeover intent: %w", err)
	}
	switch intent := takeoverIntent(record.Intent); intent {
	case takeoverIntentConnected, takeoverIntentDisconnected:
		return intent, nil
	default:
		return "", fmt.Errorf("unknown takeover intent %q", record.Intent)
	}
}

// lastTakeoverIntentDisconnected reports whether the record says the last
// explicit action was a disconnect. Auto-connect uses it both at startup and
// between retries, so a disconnect recorded while a retry is pending stops
// the retry instead of fighting the user.
func lastTakeoverIntentDisconnected() bool {
	intent, err := loadTakeoverIntent()
	return err == nil && intent == takeoverIntentDisconnected
}

// shouldAutoConnect is the startup decision for restoring the active
// subscription's connection (daemon-runtime spec: 自动连接). The
// machine-scoped daemon only hosts delegated takeover and never manages its
// own connection; the preference must be on; and the last explicit user
// action must not have been a disconnect — a shutdown or crash while
// connected leaves no record and restores. An absent or unreadable record
// carries no objection: there is no evidence the user said no.
func shouldAutoConnect(systemScope bool, prefs RuntimePreferences, activeSubscription bool) bool {
	if systemScope || !prefs.AutoConnect || !activeSubscription {
		return false
	}
	intent, err := loadTakeoverIntent()
	if err != nil {
		return true
	}
	return intent != takeoverIntentDisconnected
}
