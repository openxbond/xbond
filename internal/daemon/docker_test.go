package daemon

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestDockerBootstrapAndScheduledRefresh(t *testing.T) {
	f := newRuntimeFixture(t)
	if err := f.controller.Remove(f.second.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.controller.Remove(f.first.ID); err != nil {
		t.Fatal(err)
	}
	s := &Server{subMgr: f.subs, runtime: f.controller}
	var config atomic.Value
	config.Store("")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		content, _ := config.Load().(string)
		if content == "" {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = fmt.Fprint(w, content)
	}))
	defer upstream.Close()
	ctx := t.Context()
	if err := s.bootstrapSubscription(ctx, upstream.URL); err == nil {
		t.Fatal("expected initial fetch failure")
	}
	if f.core.IsRunning() || f.subs.ActiveID() != "" {
		t.Fatal("failed download selected a configuration")
	}
	setConfig := func(name string) {
		config.Store(fmt.Sprintf("proxies:\n  - {name: %s, type: trojan, server: example.invalid, port: 443, password: fixture}\nrules:\n  - MATCH,DIRECT\n", name))
	}
	setConfig("initial")
	if err := s.bootstrapSubscription(ctx, upstream.URL); err != nil {
		t.Fatal(err)
	}
	if !f.core.IsRunning() || !strings.Contains(string(f.core.configuration()), "name: initial") {
		t.Fatal("retry did not activate the downloaded configuration")
	}
	id := f.subs.ActiveID()
	meta, err := f.subs.Get(id)
	if err != nil || !meta.AutoUpdate || meta.UpdateIntervalHours != 24 {
		t.Fatalf("automatic subscription refresh was not configured: %v", err)
	}
	setConfig("updated")
	if err := f.controller.UpdateDue(ctx, meta.LastCheckedAt.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if f.subs.ActiveID() != id || !strings.Contains(string(f.core.configuration()), "name: updated") {
		t.Fatal("scheduled refresh did not update the running proxy")
	}
	meta, err = f.subs.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	config.Store("invalid configuration")
	if err := f.controller.UpdateDue(ctx, meta.LastCheckedAt.Add(24*time.Hour)); err == nil {
		t.Fatal("invalid refresh was accepted")
	}
	if !f.core.IsRunning() || !strings.Contains(string(f.core.configuration()), "name: updated") {
		t.Fatal("failed refresh replaced the working configuration")
	}
}

func TestDockerBootstrapCancelsFetch(t *testing.T) {
	f := newRuntimeFixture(t)
	if err := f.controller.Remove(f.second.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.controller.Remove(f.first.ID); err != nil {
		t.Fatal(err)
	}
	s := &Server{subMgr: f.subs, runtime: f.controller}
	started := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
	}))
	defer upstream.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- s.bootstrapSubscription(ctx, upstream.URL) }()
	select {
	case <-started:
		cancel()
	case <-ctx.Done():
		t.Fatal("bootstrap did not reach the server")
	}
	select {
	case err := <-result:
		if err == nil || f.subs.ActiveID() != "" {
			t.Fatalf("cancelled bootstrap selected a configuration: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("bootstrap did not cancel the fetch")
	}
}
