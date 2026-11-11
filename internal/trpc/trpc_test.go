package trpc

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// 服务器端形状以云 API 实测为准（apps/api 的 tRPC 11，默认 legacy JSON 格式）。

func TestSingleQueryBatch(t *testing.T) {
	var gotPath, gotBatch, gotInput, gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotBatch = r.URL.Query().Get("batch")
		gotInput = r.URL.Query().Get("input")
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{{
			"result": map[string]any{"data": map[string]any{"hello": "world"}},
		}})
	}))
	defer server.Close()

	client := &Client{BaseURL: server.URL + "/api/trpc", Authorize: func(r *http.Request) {
		r.Header.Set("Authorization", "Bearer tok-1")
	}}
	results, err := client.Call(context.Background(),
		Procedure{Name: "user.credentials.subscriptionLink"},
	)
	if err != nil {
		t.Fatalf("call failed: %v", err)
	}
	if gotPath != "/api/trpc/user.credentials.subscriptionLink" {
		t.Errorf("path: %q", gotPath)
	}
	if gotBatch != "1" {
		t.Errorf("batch: %q", gotBatch)
	}
	if gotInput != "{}" {
		t.Errorf("input for a no-input procedure must be empty: %q", gotInput)
	}
	if gotAuth != "Bearer tok-1" {
		t.Errorf("authorize hook missing: %q", gotAuth)
	}

	var data struct {
		Hello string `json:"hello"`
	}
	if results[0].Err != nil {
		t.Fatalf("unexpected error item: %v", results[0].Err)
	}
	if err := json.Unmarshal(results[0].Data, &data); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if data.Hello != "world" {
		t.Errorf("data: %+v", data)
	}
}

func TestMultiProcedureQueryBatchKeepsOrderAndSparseInput(t *testing.T) {
	var gotPaths, gotInput string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPaths = r.URL.Path
		gotInput = r.URL.Query().Get("input")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{"result": map[string]any{"data": 1}},
			{"result": map[string]any{"data": 2}},
			{"result": map[string]any{"data": 3}},
		})
	}))
	defer server.Close()

	client := &Client{BaseURL: server.URL + "/trpc"}
	results, err := client.Call(context.Background(),
		Procedure{Name: "a.proc"},
		Procedure{Name: "b.proc", Input: map[string]any{"purpose": "plan"}},
		Procedure{Name: "c.proc"},
	)
	if err != nil {
		t.Fatalf("call failed: %v", err)
	}
	if gotPaths != "/trpc/a.proc,b.proc,c.proc" {
		t.Errorf("paths: %q", gotPaths)
	}
	// 只有带输入的过程出现在 input 映射里（与 dash 的 batch 一致）。
	var input map[string]json.RawMessage
	if err := json.Unmarshal([]byte(gotInput), &input); err != nil {
		t.Fatalf("input decode: %v", gotInput)
	}
	if _, present := input["0"]; present {
		t.Errorf("input-less procedure must be omitted from the input map")
	}
	if _, present := input["1"]; !present {
		t.Errorf("procedure with input missing from input map")
	}
	if _, present := input["2"]; present {
		t.Errorf("input-less procedure must be omitted from the input map")
	}

	for i, want := range []float64{1, 2, 3} {
		var got float64
		if results[i].Err != nil {
			t.Fatalf("item %d error: %v", i, results[i].Err)
		}
		if err := json.Unmarshal(results[i].Data, &got); err != nil || got != want {
			t.Errorf("item %d: got %v (%v), want %v", i, got, err, want)
		}
	}
}

func TestMutationBatchTravelsAsPost(t *testing.T) {
	var gotMethod, gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{{
			"result": map[string]any{"data": map[string]any{"ok": true}},
		}})
	}))
	defer server.Close()

	client := &Client{BaseURL: server.URL + "/api/trpc"}
	results, err := client.Call(context.Background(),
		Procedure{Name: "user.credentials.rotateProxyToken", Mutation: true},
	)
	if err != nil {
		t.Fatalf("call failed: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method: %s", gotMethod)
	}
	// 无输入过程在 POST 批量体里同样按稀疏映射省略（tRPC 按索引解码）。
	if gotBody != "{}" {
		t.Errorf("body: %q", gotBody)
	}
	if results[0].Err != nil {
		t.Fatalf("unexpected error: %v", results[0].Err)
	}
}

func TestErrorItemSurfacesAsTRPCError(t *testing.T) {
	// 云 API 实测的错误壳（legacy，无 json 包裹）：message/code/data 同级。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{{
			"error": map[string]any{
				"message": "Authentication required",
				"code":    -32001,
				"data": map[string]any{
					"code": "UNAUTHORIZED", "httpStatus": 401,
				},
			},
		}})
	}))
	defer server.Close()

	client := &Client{BaseURL: server.URL + "/api/trpc"}
	results, err := client.Call(context.Background(),
		Procedure{Name: "user.credentials.subscriptionLink"},
	)
	if err != nil {
		t.Fatalf("call failed: %v", err)
	}
	if results[0].Err == nil {
		t.Fatal("expected an error item")
	}
	e := results[0].Err
	if e.Code != "UNAUTHORIZED" || e.HTTPStatus != 401 || e.RawCode != -32001 {
		t.Errorf("error fields: %+v", e)
	}
	if e.Message != "Authentication required" {
		t.Errorf("message: %q", e.Message)
	}
}

func TestNonBatchResponseSurfacesAsTypedHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("upstream exploded"))
	}))
	defer server.Close()

	client := &Client{BaseURL: server.URL + "/trpc"}
	_, err := client.Call(context.Background(), Procedure{Name: "a"})
	var httpErr *HTTPError
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusBadGateway {
		t.Fatalf("got %v, want HTTPError with status 502", err)
	}

	empty := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[]`))
	}))
	defer empty.Close()

	_, err = (&Client{BaseURL: empty.URL + "/trpc"}).Call(context.Background(), Procedure{Name: "a"})
	if !errors.As(err, &httpErr) {
		t.Fatalf("got %v, want HTTPError for empty batch response", err)
	}

	if _, err = (&Client{BaseURL: server.URL + "/trpc"}).Call(context.Background()); err == nil {
		t.Fatal("expected an error for an empty procedure list")
	}
}
