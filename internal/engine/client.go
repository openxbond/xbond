package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

type ClashClient struct {
	baseURL    string
	secret     string
	httpClient *http.Client
}

func NewClashClient(port int, secret string) *ClashClient {
	return &ClashClient{
		baseURL: fmt.Sprintf("http://127.0.0.1:%d", port),
		secret:  secret,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (c *ClashClient) request(ctx context.Context, method, endpoint string, body any, target any) error {
	var bodyReader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(buf)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+endpoint, bodyReader)
	if err != nil {
		return err
	}

	if c.secret != "" {
		req.Header.Set("Authorization", "Bearer "+c.secret)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("clash api returned status %d: %s", resp.StatusCode, string(respBytes))
	}

	if target != nil {
		return json.NewDecoder(resp.Body).Decode(target)
	}
	return nil
}

func (c *ClashClient) GetVersion(ctx context.Context) (string, error) {
	var result struct {
		Version string `json:"version"`
	}
	if err := c.request(ctx, http.MethodGet, "/version", nil, &result); err != nil {
		return "", err
	}
	return result.Version, nil
}

func (c *ClashClient) GetProxies(ctx context.Context) (map[string]ProxyItem, error) {
	var result ProxiesResponse
	if err := c.request(ctx, http.MethodGet, "/proxies", nil, &result); err != nil {
		return nil, err
	}
	return result.Proxies, nil
}

func (c *ClashClient) SelectNode(ctx context.Context, group, node string) error {
	payload := map[string]string{"name": node}
	endpoint := fmt.Sprintf("/proxies/%s", url.PathEscape(group))
	return c.request(ctx, http.MethodPut, endpoint, payload, nil)
}

func (c *ClashClient) TestDelay(ctx context.Context, node, testURL string, timeoutMs int) (int, error) {
	if testURL == "" {
		testURL = "https://www.gstatic.com/generate_204"
	}
	if timeoutMs <= 0 {
		timeoutMs = 5000
	}

	endpoint := fmt.Sprintf("/proxies/%s/delay?url=%s&timeout=%d",
		url.PathEscape(node),
		url.QueryEscape(testURL),
		timeoutMs,
	)

	var result DelayResponse
	if err := c.request(ctx, http.MethodGet, endpoint, nil, &result); err != nil {
		return 0, err
	}
	return result.Delay, nil
}

func (c *ClashClient) GetConnections(ctx context.Context) (*ConnectionsResponse, error) {
	var result ConnectionsResponse
	if err := c.request(ctx, http.MethodGet, "/connections", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *ClashClient) CloseConnection(ctx context.Context, id string) error {
	endpoint := fmt.Sprintf("/connections/%s", url.PathEscape(id))
	return c.request(ctx, http.MethodDelete, endpoint, nil, nil)
}

func (c *ClashClient) CloseAllConnections(ctx context.Context) error {
	return c.request(ctx, http.MethodDelete, "/connections", nil, nil)
}

func (c *ClashClient) GetRules(ctx context.Context) ([]RuleItem, error) {
	var result RulesResponse
	if err := c.request(ctx, http.MethodGet, "/rules", nil, &result); err != nil {
		return nil, err
	}
	return result.Rules, nil
}

func (c *ClashClient) QueryDNS(ctx context.Context, domain, recordType string) (*DNSQueryResponse, error) {
	if recordType == "" {
		recordType = "A"
	}
	endpoint := fmt.Sprintf("/dns/query?name=%s&type=%s", url.QueryEscape(domain), url.QueryEscape(recordType))
	var result DNSQueryResponse
	if err := c.request(ctx, http.MethodGet, endpoint, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *ClashClient) FlushFakeIP(ctx context.Context) error {
	return c.request(ctx, http.MethodPost, "/cache/fakeip/flush", nil, nil)
}

func (c *ClashClient) SetMode(ctx context.Context, mode RoutingMode) error {
	payload := map[string]string{"mode": string(mode)}
	return c.request(ctx, http.MethodPatch, "/configs", payload, nil)
}
