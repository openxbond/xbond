package daemon

import (
	"github.com/openxbond/xbond/internal/sub"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRenameSubscriptionHandler(t *testing.T) {
	t.Setenv("XBOND_DATA_DIR", t.TempDir())
	m, err := sub.NewManager()
	if err != nil {
		t.Fatal(err)
	}
	meta, err := m.AddUniversal("https://example.invalid/config", "original", 24, true)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{subMgr: m}
	request := httptest.NewRequest(http.MethodPatch, "/localapi/v0/subs", strings.NewReader(`{"id":"`+meta.ID+`","name":"renamed"}`))
	response := httptest.NewRecorder()
	s.handleSubs(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("rename status %d", response.Code)
	}
	saved, _ := m.Get(meta.ID)
	if saved.Name != "renamed" {
		t.Fatal("handler did not rename subscription")
	}
	response = httptest.NewRecorder()
	s.handleSubs(response, httptest.NewRequest(http.MethodPatch, "/localapi/v0/subs", strings.NewReader(`{"id":"`+meta.ID+`","name":" "}`)))
	if response.Code != http.StatusBadRequest {
		t.Fatal("invalid name was not rejected")
	}
}
