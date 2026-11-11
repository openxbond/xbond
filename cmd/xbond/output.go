package main

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/openxbond/xbond/internal/daemon"
	"github.com/openxbond/xbond/internal/diag"
	"github.com/openxbond/xbond/internal/sub"
)

// JSON query output is redacted at the CLI boundary: `status --json`,
// `sub list --json` and `sub info --json` answer "what is the state", not
// "hand me the credentials". Full-fidelity export stays explicit via
// `sub export --redacted=false`.

func redactSubscriptionMeta(m sub.SubscriptionMeta) sub.SubscriptionMeta {
	m.Token = ""
	m.SourceURL = redactSourceURL(m.SourceURL)
	return m
}

func redactSourceURL(source string) string {
	if !strings.HasPrefix(source, "http://") && !strings.HasPrefix(source, "https://") {
		return source // local file path: not a credential
	}
	parsed, err := url.Parse(source)
	if err != nil {
		return source
	}
	// The credential lives in the query (?token=…) and optionally userinfo.
	parsed.RawQuery = ""
	parsed.User = nil
	return parsed.String()
}

func redactStatus(st *daemon.StatusResponse) *daemon.StatusResponse {
	st.Engine.ClashSecret = ""
	st.Preferences.ClashSecret = ""
	if st.ActiveSub != nil {
		redacted := redactSubscriptionMeta(*st.ActiveSub)
		st.ActiveSub = &redacted
	}
	return st
}

func redactDoctorReport(rep *diag.DoctorReport) *diag.DoctorReport {
	if rep.Subscription != nil {
		redacted := redactSubscriptionMeta(*rep.Subscription)
		rep.Subscription = &redacted
	}
	return rep
}

// parseStrictBool rejects everything but the spelled-out values: `mode
// --allow-lan banana` must fail, not silently commit false.
func parseStrictBool(value string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true", "1":
		return true, nil
	case "false", "0":
		return false, nil
	}
	return false, fmt.Errorf("invalid boolean value %q (want true or false)", value)
}

// resolveSubscriptionTarget resolves an explicit name-or-ID against the
// subscription list. An explicit target that matches nothing is an error —
// silently falling back to the active subscription exports the wrong config;
// only an omitted target means "the active one".
func resolveSubscriptionTarget(list *daemon.SubsListResponse, target string) (string, error) {
	if target == "" {
		if list.ActiveID == "" {
			return "", fmt.Errorf("no active subscription; specify a name or ID")
		}
		return list.ActiveID, nil
	}
	for _, s := range list.Subscriptions {
		if s.ID == target || s.Name == target {
			return s.ID, nil
		}
	}
	return "", fmt.Errorf("subscription %q not found", target)
}
