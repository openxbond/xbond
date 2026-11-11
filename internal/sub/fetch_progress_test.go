package sub

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestFetchSubscriptionReportsProgress(t *testing.T) {
	body := strings.Repeat("x", 2048)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, body)
	}))
	defer server.Close()

	var lastRead, lastTotal int64
	calls := 0
	resp, err := FetchSubscription(context.Background(), server.URL, FetchOptions{
		OnProgress: func(read, total int64) {
			lastRead, lastTotal = read, total
			calls++
		},
	})
	if err != nil {
		t.Fatalf("fetch failed: %v", err)
	}
	if resp.Health != HealthOK {
		t.Fatalf("health: got %q (%s)", resp.Health, resp.ErrorMessage)
	}
	if calls == 0 {
		t.Fatal("progress callback never fired")
	}
	if lastRead != int64(len(body)) {
		t.Errorf("final read: got %d, want %d", lastRead, len(body))
	}
	if lastTotal != int64(len(body)) {
		t.Errorf("total: got %d, want %d", lastTotal, len(body))
	}
}
