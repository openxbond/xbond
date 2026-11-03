package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openxbond/xbond/internal/sub"
)

func TestRemoteSubscriptionSchedule(t *testing.T) {
	for _, hours := range []int{-1, 0, 4, 12, 24, 72, 168} {
		t.Run(fmt.Sprint(hours), func(t *testing.T) {
			f := newRuntimeFixture(t)
			s := &Server{subMgr: f.subs, runtime: f.controller}
			var requests atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				w.Header().Set("profile-update-interval", "2")
				_, _ = w.Write([]byte("proxies:\n  - {name: remote, type: trojan, server: example.invalid, port: 443, password: fixture}\n"))
			}))
			defer upstream.Close()
			input := map[string]any{"urlOrFile": upstream.URL, "use": false}
			want := hours
			if hours < 0 {
				want = 24 // An omitted value defaults to one day.
			} else {
				input["updateIntervalHours"] = hours
			}
			body, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			response := runtimeRequest(s.handleLogin, string(body))
			var result struct {
				Meta        *sub.SubscriptionMeta `json:"meta"`
				UpdateError string                `json:"updateError"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != http.StatusOK || result.Meta == nil || result.UpdateError != "" {
				t.Fatalf("import failed: status=%d err=%v", response.Code, err)
			}
			id := result.Meta.ID
			assertSchedule := func(manager *sub.Manager) *sub.SubscriptionMeta {
				t.Helper()
				meta, err := manager.Get(id)
				if err != nil || meta.AutoUpdate != (want != 0) || meta.UpdateIntervalHours != want || !meta.UpdateIntervalCustomized {
					t.Fatalf("schedule not preserved: %+v %v", meta, err)
				}
				return meta
			}
			assertSchedule(f.subs)
			if err := f.controller.Use(context.Background(), id); err != nil {
				t.Fatal(err)
			}
			meta := assertSchedule(f.subs)
			before := requests.Load()
			if want == 0 {
				if err := f.controller.UpdateDue(context.Background(), time.Now().Add(30*24*time.Hour)); err != nil {
					t.Fatal(err)
				}
			} else {
				due := meta.LastCheckedAt.Add(time.Duration(want) * time.Hour)
				if err := f.controller.UpdateDue(context.Background(), due.Add(-time.Second)); err != nil {
					t.Fatal(err)
				}
				if requests.Load() != before {
					t.Fatal("updated before selected interval")
				}
				if err := f.controller.UpdateDue(context.Background(), due); err != nil {
					t.Fatal(err)
				}
				before++
			}
			if requests.Load() != before {
				t.Fatal("scheduler ignored the selected interval")
			}
			if _, err := f.controller.Update(context.Background(), id, true, nil); err != nil {
				t.Fatal(err)
			}
			if requests.Load() != before+1 {
				t.Fatal("manual update was disabled")
			}
			assertSchedule(f.subs)
			reloaded, err := sub.NewManager()
			if err != nil {
				t.Fatal(err)
			}
			assertSchedule(reloaded)
			patch := httptest.NewRecorder()
			s.handleSubs(patch, httptest.NewRequest(http.MethodPatch, "/localapi/v0/subs", strings.NewReader(fmt.Sprintf(`{"id":%q,"updateIntervalHours":12}`, id))))
			if patch.Code != http.StatusOK {
				t.Fatal("could not change saved frequency")
			}
			want = 12
			assertSchedule(f.subs)
			invalid := httptest.NewRecorder()
			s.handleSubs(invalid, httptest.NewRequest(http.MethodPatch, "/localapi/v0/subs", strings.NewReader(fmt.Sprintf(`{"id":%q,"updateIntervalHours":5}`, id))))
			if invalid.Code != http.StatusBadRequest {
				t.Fatal("saved subscription accepted an invalid frequency")
			}
			assertSchedule(f.subs)
		})
	}
}

func TestFailedRemoteImportRetainsDisabledSchedule(t *testing.T) {
	f := newRuntimeFixture(t)
	s := &Server{subMgr: f.subs, runtime: f.controller}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer upstream.Close()
	response := runtimeRequest(s.handleLogin, fmt.Sprintf(`{"urlOrFile":%q,"updateIntervalHours":0,"use":false}`, upstream.URL))
	var result struct {
		Meta        *sub.SubscriptionMeta `json:"meta"`
		UpdateError string                `json:"updateError"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != http.StatusOK || result.Meta == nil || result.UpdateError == "" {
		t.Fatal("failed import did not report the saved source and download error")
	}
	if result.Meta.AutoUpdate || result.Meta.UpdateIntervalHours != 0 || f.subs.ActiveID() != f.first.ID {
		t.Fatal("failed import lost the selected schedule or changed the active configuration")
	}
}

func TestImportRejectsInvalidScheduleBeforeSaving(t *testing.T) {
	f := newRuntimeFixture(t)
	s := &Server{subMgr: f.subs, runtime: f.controller}
	before := len(f.subs.List())
	for _, invalid := range []string{"-1", "1", "5", "25", "999", "1.5", `"24"`} {
		response := runtimeRequest(s.handleLogin, `{"urlOrFile":"https://example.invalid/config","updateIntervalHours":`+invalid+`}`)
		if response.Code != http.StatusBadRequest || len(f.subs.List()) != before {
			t.Fatalf("invalid schedule %s was saved", invalid)
		}
	}
}
