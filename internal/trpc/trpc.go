// Package trpc implements a minimal client for the tRPC batch wire protocol
// (tRPC 10/11, default legacy JSON format):
//
//	GET  {base}/procA,procB?batch=1&input={"0":...}   (queries only)
//	POST {base}/procA,procB?batch=1  body {"0":...}   (any batch with a mutation)
//
// Success items decode as {"result":{"data":...}}; failure items as
// {"error":{"message","code","data":{"code","httpStatus"}}}. Inputs and
// outputs are plain JSON.
//
// Generality notes: BaseURL is the caller-supplied tRPC mount root (any path
// works); servers running a data transformer (superjson et al) change the
// envelope and are NOT supported — responses with json/meta wrappers that
// carry transformer payloads surface as parse errors.
//
// The package is protocol-only: credentials are injected per request through
// Client.Authorize; refresh-and-retry policies belong to the caller.
package trpc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Client calls a tRPC server. BaseURL is the tRPC mount root including its
// path prefix (e.g. "https://host/api/trpc" or "https://host/trpc"). A nil
// HTTP falls back to http.DefaultClient.
type Client struct {
	BaseURL string
	HTTP    *http.Client
	// Authorize optionally injects credentials into each outgoing request
	// (e.g. an Authorization: Bearer header).
	Authorize func(*http.Request)
}

// Procedure is one entry in a batch.
type Procedure struct {
	// Name is the procedure path, e.g. "user.credentials.subscriptionLink".
	Name string
	// Input is the procedure input (JSON-serializable); nil omits the entry
	// from the batch input map, which is what input-less procedures expect.
	Input any
	// Mutation marks the procedure as a mutation (routed via POST; a batch
	// containing any mutation travels as one POST).
	Mutation bool
}

// Result is the per-procedure outcome, in batch order.
type Result struct {
	Data json.RawMessage
	Err  *Error
}

// Error is a procedure-level failure.
type Error struct {
	Message    string // human-readable debug message
	Code       string // TRPC_ERROR_CODE_KEY, e.g. "UNAUTHORIZED"
	HTTPStatus int    // the status the adapter mapped the error to
	RawCode    int    // the numeric JSON-RPC-style code, e.g. -32001
}

func (e *Error) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("trpc error %s: %s", e.Code, e.Message)
	}
	return fmt.Sprintf("trpc error: %s", e.Message)
}

// HTTPError is a response that is not a valid batch payload (e.g. a bare
// error object from an auth/transport failure). The status is preserved so
// callers can map transport-level 401s onto their own credential semantics.
type HTTPError struct {
	Status int
	Body   string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("trpc: unexpected response (status %d): %s", e.Status, truncate([]byte(e.Body)))
}

// Call executes the procedures as a single tRPC batch and returns one result
// per procedure, in order.
func (c *Client) Call(ctx context.Context, procs ...Procedure) ([]Result, error) {
	if len(procs) == 0 {
		return nil, fmt.Errorf("trpc: empty batch")
	}
	for _, proc := range procs {
		if proc.Name == "" || strings.ContainsAny(proc.Name, ",?&") {
			return nil, fmt.Errorf("trpc: invalid procedure name %q", proc.Name)
		}
	}

	paths := make([]string, len(procs))
	inputs := map[int]any{}
	anyMutation := false
	for i, proc := range procs {
		paths[i] = proc.Name
		if proc.Input != nil {
			inputs[i] = proc.Input
		}
		anyMutation = anyMutation || proc.Mutation
	}
	inputJSON, err := json.Marshal(inputs)
	if err != nil {
		return nil, fmt.Errorf("trpc: encode batch input: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx, http.MethodGet,
		c.url()+"/"+strings.Join(paths, ","),
		nil,
	)
	if err != nil {
		return nil, err
	}
	query := httpReq.URL.Query()
	query.Set("batch", "1")
	if anyMutation {
		httpReq.Method = http.MethodPost
		body, err := json.Marshal(inputs)
		if err != nil {
			return nil, fmt.Errorf("trpc: encode batch input: %w", err)
		}
		httpReq.Body = io.NopCloser(bytes.NewReader(body))
		httpReq.Header.Set("Content-Type", "application/json")
	} else {
		query.Set("input", string(inputJSON))
	}
	httpReq.URL.RawQuery = query.Encode()

	if c.Authorize != nil {
		c.Authorize(httpReq)
	}
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("trpc: request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<22))
	if err != nil {
		return nil, fmt.Errorf("trpc: read response: %w", err)
	}

	var items []struct {
		Result *struct {
			Data json.RawMessage `json:"data"`
		} `json:"result"`
		Error *struct {
			Message string `json:"message"`
			Code    int    `json:"code"`
			Data    *struct {
				Code       string `json:"code"`
				HTTPStatus int    `json:"httpStatus"`
			} `json:"data"`
			// New-format envelope (trpc-accept: application/json); parsed
			// defensively although the client never requests it.
			JSON *struct {
				Message string `json:"message"`
				Code    int    `json:"code"`
				Data    *struct {
					Code       string `json:"code"`
					HTTPStatus int    `json:"httpStatus"`
				} `json:"data"`
			} `json:"json"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &items); err != nil {
		return nil, &HTTPError{Status: resp.StatusCode, Body: string(body)}
	}
	if len(items) != len(procs) {
		return nil, &HTTPError{Status: resp.StatusCode, Body: truncate(body)}
	}

	results := make([]Result, len(items))
	for i, item := range items {
		switch {
		case item.Result != nil:
			results[i] = Result{Data: item.Result.Data}
		case item.Error != nil:
			e := item.Error
			trpcErr := &Error{Message: e.Message, RawCode: e.Code}
			if e.Data != nil {
				trpcErr.Code = e.Data.Code
				trpcErr.HTTPStatus = e.Data.HTTPStatus
			}
			if e.JSON != nil {
				trpcErr.Message = e.JSON.Message
				trpcErr.RawCode = e.JSON.Code
				if e.JSON.Data != nil {
					trpcErr.Code = e.JSON.Data.Code
					trpcErr.HTTPStatus = e.JSON.Data.HTTPStatus
				}
			}
			results[i] = Result{Err: trpcErr}
		default:
			results[i] = Result{Err: &Error{
				Message:    fmt.Sprintf("malformed batch item (status %d)", resp.StatusCode),
				HTTPStatus: resp.StatusCode,
			}}
		}
	}
	return results, nil
}

func (c *Client) url() string {
	return strings.TrimSuffix(c.BaseURL, "/")
}

func truncate(body []byte) string {
	const limit = 512
	if len(body) <= limit {
		return strings.TrimSpace(string(body))
	}
	return strings.TrimSpace(string(body[:limit])) + "…"
}
