package daemon

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/sub"
)

func runtimeRequest(handler http.HandlerFunc, body string) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	handler(response, httptest.NewRequest(http.MethodPost, "/localapi/v0/test", strings.NewReader(body)))
	return response
}

func TestRuntimeHandlersReturnOperationResultsAndRejectInvalidRequests(t *testing.T) {
	f := newRuntimeFixture(t)
	server := &Server{subMgr: f.subs, runtime: f.controller}
	for _, body := range []string{`{"routing":"unsupported"}`, `{"mode":"port"} trailing`, `{"port":-1}`} {
		before := f.controller.Preferences()
		response := runtimeRequest(server.handleMode, body)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid mode request returned %d", response.Code)
		}
		if f.controller.Preferences() != before {
			t.Fatal("invalid input mutated preferences")
		}
	}
	selected := runtimeRequest(server.handleSubUse, `{"id":"`+f.second.ID+`"}`)
	var selection struct {
		ActiveID string `json:"activeId"`
	}
	if err := json.Unmarshal(selected.Body.Bytes(), &selection); err != nil {
		t.Fatal(err)
	}
	if selected.Code != http.StatusOK || selection.ActiveID != f.second.ID {
		t.Fatalf("wrong subscription result: %d %s", selected.Code, selected.Body)
	}
	if !strings.Contains(string(f.core.configuration()), "second") {
		t.Fatal("selected subscription was not applied")
	}
	source, _ := f.subs.Get(f.second.ID)
	if err := os.WriteFile(source.SourceURL, []byte(`{"outbounds":[{"type":"direct","tag":"new-second"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	updated := runtimeRequest(server.handleSubUpdate, `{"id":"`+f.second.ID+`","force":true}`)
	var result sub.UpdateResult
	if err := json.Unmarshal(updated.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if updated.Code != http.StatusOK || result.Meta == nil || result.Meta.ID != f.second.ID || !result.ContentChanged {
		t.Fatalf("update response lost its metadata: %d %s", updated.Code, updated.Body)
	}
}

func TestRuntimeBulkUpdateReportsFailuresInsteadOfReturningSuccess(t *testing.T) {
	f := newRuntimeFixture(t)
	second, _ := f.subs.Get(f.second.ID)
	if err := os.Remove(second.SourceURL); err != nil {
		t.Fatal(err)
	}
	server := &Server{subMgr: f.subs, runtime: f.controller}
	response := runtimeRequest(server.handleSubUpdate, `{"all":true,"force":true}`)
	var result sub.BatchUpdateResult
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK {
		t.Fatalf("a batch keeps per-item outcomes at 200, got %d: %s", response.Code, response.Body)
	}
	if len(result.Results) != 1 || result.Results[0].Meta == nil || result.Results[0].Meta.ID != f.first.ID {
		t.Fatalf("healthy subscription's result missing from batch: %s", response.Body)
	}
	found := false
	for _, failure := range result.Failures {
		if failure.ID == f.second.ID && failure.Name != "" && failure.Error != "" {
			found = true
		}
	}
	if !found {
		t.Fatalf("failed update was hidden: %s", response.Body)
	}
}

func TestRuntimeUpHTTPReturnsActualStartedCoreStatus(t *testing.T) {
	f := newRuntimeFixture(t)
	freePort := func() int {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		port := listener.Addr().(*net.TCPAddr).Port
		if err := listener.Close(); err != nil {
			t.Fatal(err)
		}
		return port
	}
	preferences := f.controller.Preferences()
	preferences.MixedPort, preferences.ClashPort = freePort(), freePort()
	core := engine.NewManager(100)
	controller := newRuntimeController(core, f.subs, preferences)
	server := &Server{engineMgr: core, subMgr: f.subs, runtime: controller}
	t.Cleanup(func() {
		if _, err := controller.Down(); err != nil {
			t.Error(err)
		}
	})
	response := runtimeRequest(server.handleUp, "{}")
	var result struct {
		Status engine.EngineStatus `json:"status"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || !result.Status.Running || result.Status.MixedPort != preferences.MixedPort {
		t.Fatalf("up response did not describe the started core: %d %s", response.Code, response.Body)
	}
	if err := controller.Configure(context.Background(), runtimeOptions{Routing: engine.RoutingGlobal}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(paths.SubRuntimePath(f.first.ID)); err != nil {
		t.Fatal(err)
	}
}
