package main

import (
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/daemon"
	"github.com/openxbond/xbond/internal/sub"
)

func TestParseStrictBool(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want bool
	}{
		{"true", true},
		{"TRUE", true},
		{"1", true},
		{"false", false},
		{"False", false},
		{"0", false},
		{" false ", false},
	} {
		got, err := parseStrictBool(tc.in)
		if err != nil || got != tc.want {
			t.Errorf("parseStrictBool(%q) = %v, %v; want %v, nil", tc.in, got, err, tc.want)
		}
	}
	for _, bad := range []string{"banana", "yes", "on", "2", ""} {
		if _, err := parseStrictBool(bad); err == nil {
			t.Errorf("parseStrictBool(%q) accepted a non-boolean value", bad)
		}
	}
}

func TestRedactSubscriptionMetaStripsCredentialsKeepsPaths(t *testing.T) {
	redacted := redactSubscriptionMeta(sub.SubscriptionMeta{
		Token:     "sub-secret-token",
		SourceURL: "https://gw.example.com/sub?token=sub-secret&flag=1",
	})
	if redacted.Token != "" {
		t.Error("token survived redaction")
	}
	if strings.Contains(redacted.SourceURL, "sub-secret") || strings.Contains(redacted.SourceURL, "flag=1") {
		t.Errorf("URL credential survived redaction: %s", redacted.SourceURL)
	}
	if !strings.HasPrefix(redacted.SourceURL, "https://gw.example.com/sub") {
		t.Errorf("redaction lost the URL origin: %s", redacted.SourceURL)
	}

	kept := redactSubscriptionMeta(sub.SubscriptionMeta{SourceURL: "/home/user/config.json"})
	if kept.SourceURL != "/home/user/config.json" {
		t.Errorf("local file path is not a credential and must be kept: %s", kept.SourceURL)
	}
}

func TestRedactStatusClearsSecrets(t *testing.T) {
	st := &daemon.StatusResponse{}
	st.Engine.ClashSecret = "engine-secret"
	st.Preferences.ClashSecret = "prefs-secret"
	st.ActiveSub = &sub.SubscriptionMeta{Token: "sub-secret-token"}

	out := redactStatus(st)
	if out.Engine.ClashSecret != "" || out.Preferences.ClashSecret != "" {
		t.Error("controller secrets survived redaction")
	}
	if out.ActiveSub == nil || out.ActiveSub.Token != "" {
		t.Error("active subscription token survived redaction")
	}
}

func TestResolveSubscriptionTarget(t *testing.T) {
	list := &daemon.SubsListResponse{
		ActiveID: "uni_active",
		Subscriptions: []sub.SubscriptionMeta{
			{ID: "uni_active", Name: "active"},
			{ID: "uni_other", Name: "other"},
		},
	}

	id, err := resolveSubscriptionTarget(list, "")
	if err != nil || id != "uni_active" {
		t.Fatalf("omitted target must resolve to the active subscription: %q %v", id, err)
	}
	id, err = resolveSubscriptionTarget(list, "other")
	if err != nil || id != "uni_other" {
		t.Fatalf("name target must resolve: %q %v", id, err)
	}
	if _, err := resolveSubscriptionTarget(list, "missing"); err == nil {
		t.Fatal("an explicit target that matches nothing must fail, not fall back to the active subscription")
	}
	if _, err := resolveSubscriptionTarget(&daemon.SubsListResponse{}, ""); err == nil {
		t.Fatal("no target and no active subscription must fail")
	}
}
