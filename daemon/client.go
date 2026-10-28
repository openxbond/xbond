package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/openxbond/xbond/diag"
	"github.com/openxbond/xbond/engine"
	"github.com/openxbond/xbond/paths"
	"github.com/openxbond/xbond/sub"
)

type Client struct {
	addr       string
	token      string
	httpClient *http.Client
}

type StatusResponse struct {
	Engine      engine.EngineStatus   `json:"engine"`
	Preferences RuntimePreferences    `json:"preferences"`
	ThreeTier   diag.ThreeTierStatus  `json:"threeTier"`
	ActiveSub   *sub.SubscriptionMeta `json:"activeSub"`
}

type SubsListResponse struct {
	ActiveID      string                 `json:"activeId"`
	Subscriptions []sub.SubscriptionMeta `json:"subscriptions"`
}

func (c *Client) Addr() string {
	return c.addr
}

func NewClient() (*Client, error) {
	addrBytes, err := os.ReadFile(paths.LocalAPIAddrPath())
	if err != nil {
		return nil, fmt.Errorf("daemon is not running (addr file missing)")
	}
	tokenBytes, err := os.ReadFile(paths.LocalAPITokenPath())
	if err != nil {
		return nil, fmt.Errorf("daemon is not running (token file missing)")
	}

	return &Client{
		addr:  strings.TrimSpace(string(addrBytes)),
		token: strings.TrimSpace(string(tokenBytes)),
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}, nil
}

func EnsureRunning(ctx context.Context) (*Client, error) {
	c, err := NewClient()
	if err == nil {
		if _, err := c.GetStatus(ctx); err == nil {
			return c, nil
		}
	}

	// Launch background daemon
	exe, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("failed to get executable path: %w", err)
	}

	cmd := exec.Command(exe, "daemon")
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start daemon process: %w", err)
	}

	// Poll until ready (up to 3 seconds)
	for i := 0; i < 30; i++ {
		time.Sleep(100 * time.Millisecond)
		c, err := NewClient()
		if err == nil {
			if _, err := c.GetStatus(ctx); err == nil {
				return c, nil
			}
		}
	}

	return nil, fmt.Errorf("daemon process started but failed to become ready in time")
}

func (c *Client) request(ctx context.Context, method, endpoint string, body any, target any) error {
	var bodyReader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(buf)
	}

	reqURL := fmt.Sprintf("http://%s%s", c.addr, endpoint)
	req, err := http.NewRequestWithContext(ctx, method, reqURL, bodyReader)
	if err != nil {
		return err
	}

	req.Header.Set("X-XBond-Token", c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBytes, _ := io.ReadAll(resp.Body)
		var errObj struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(respBytes, &errObj)
		if errObj.Error != "" {
			return fmt.Errorf("%s", errObj.Error)
		}
		return fmt.Errorf("request failed with status %d: %s", resp.StatusCode, string(respBytes))
	}

	if target != nil {
		return json.NewDecoder(resp.Body).Decode(target)
	}
	return nil
}

func (c *Client) GetStatus(ctx context.Context) (*StatusResponse, error) {
	var res StatusResponse
	if err := c.request(ctx, http.MethodGet, "/localapi/v0/status", nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) Up(ctx context.Context, mode engine.TakeoverMode, routing engine.RoutingMode, port int, allowLan *bool, subID string) error {
	payload := map[string]any{
		"mode":     mode,
		"routing":  routing,
		"port":     port,
		"allowLan": allowLan,
		"subId":    subID,
	}
	return c.request(ctx, http.MethodPost, "/localapi/v0/up", payload, nil)
}

func (c *Client) Down(ctx context.Context) error {
	return c.request(ctx, http.MethodPost, "/localapi/v0/down", nil, nil)
}

func (c *Client) Restart(ctx context.Context) error {
	return c.request(ctx, http.MethodPost, "/localapi/v0/restart", nil, nil)
}

func (c *Client) SetMode(ctx context.Context, mode engine.TakeoverMode, routing engine.RoutingMode, port int, allowLan *bool) error {
	payload := map[string]any{
		"mode":     mode,
		"routing":  routing,
		"port":     port,
		"allowLan": allowLan,
	}
	return c.request(ctx, http.MethodPatch, "/localapi/v0/mode", payload, nil)
}

func (c *Client) Login(ctx context.Context, token, origin string, fallbackOrigins []string, protocol, lang, name, urlOrFile string) (*sub.SubscriptionMeta, error) {
	payload := map[string]any{
		"token":           token,
		"origin":          origin,
		"fallbackOrigins": fallbackOrigins,
		"protocol":        protocol,
		"lang":            lang,
		"name":            name,
		"urlOrFile":       urlOrFile,
	}
	var res struct {
		OK   bool                  `json:"ok"`
		Meta *sub.SubscriptionMeta `json:"meta"`
	}
	if err := c.request(ctx, http.MethodPost, "/localapi/v0/login", payload, &res); err != nil {
		return nil, err
	}
	return res.Meta, nil
}

func (c *Client) Logout(ctx context.Context, purge bool) error {
	payload := map[string]any{"purge": purge}
	return c.request(ctx, http.MethodPost, "/localapi/v0/logout", payload, nil)
}

func (c *Client) ListSubs(ctx context.Context) (*SubsListResponse, error) {
	var res SubsListResponse
	if err := c.request(ctx, http.MethodGet, "/localapi/v0/subs", nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) AddSub(ctx context.Context, subType sub.SubscriptionType, token, origin string, fallbacks []string, protocol, lang, name, urlOrFile string, interval int, use bool) (*sub.SubscriptionMeta, error) {
	payload := map[string]any{
		"type":            subType,
		"token":           token,
		"origin":          origin,
		"fallbackOrigins": fallbacks,
		"protocol":        protocol,
		"lang":            lang,
		"name":            name,
		"urlOrFile":       urlOrFile,
		"intervalHours":   interval,
		"use":             use,
	}
	var res sub.SubscriptionMeta
	if err := c.request(ctx, http.MethodPost, "/localapi/v0/subs", payload, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) UseSub(ctx context.Context, id string) error {
	payload := map[string]any{"id": id}
	return c.request(ctx, http.MethodPost, "/localapi/v0/subs/use", payload, nil)
}

func (c *Client) UpdateSub(ctx context.Context, id string, force, viaProxy, all bool) (*sub.UpdateResult, error) {
	payload := map[string]any{
		"id":       id,
		"force":    force,
		"viaProxy": viaProxy,
		"all":      all,
	}
	var res sub.UpdateResult
	if err := c.request(ctx, http.MethodPost, "/localapi/v0/subs/update", payload, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) RemoveSub(ctx context.Context, id string) error {
	endpoint := fmt.Sprintf("/localapi/v0/subs?id=%s", url.QueryEscape(id))
	return c.request(ctx, http.MethodDelete, endpoint, nil, nil)
}

func (c *Client) GetNodes(ctx context.Context) (map[string]engine.ProxyItem, error) {
	var res map[string]engine.ProxyItem
	if err := c.request(ctx, http.MethodGet, "/localapi/v0/nodes", nil, &res); err != nil {
		return nil, err
	}
	return res, nil
}

func (c *Client) SelectNode(ctx context.Context, group, node string) error {
	payload := map[string]any{"group": group, "node": node}
	return c.request(ctx, http.MethodPost, "/localapi/v0/nodes/select", payload, nil)
}

func (c *Client) TestNode(ctx context.Context, node, testURL string, timeoutMs int) (int, error) {
	payload := map[string]any{"node": node, "url": testURL, "timeoutMs": timeoutMs}
	var res struct {
		Delay int `json:"delay"`
	}
	if err := c.request(ctx, http.MethodPost, "/localapi/v0/nodes/test", payload, &res); err != nil {
		return 0, err
	}
	return res.Delay, nil
}

func (c *Client) GetConnections(ctx context.Context) (*engine.ConnectionsResponse, error) {
	var res engine.ConnectionsResponse
	if err := c.request(ctx, http.MethodGet, "/localapi/v0/connections", nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) CloseConnections(ctx context.Context, id string) error {
	endpoint := "/localapi/v0/connections"
	if id != "" {
		endpoint += "?id=" + url.QueryEscape(id)
	}
	return c.request(ctx, http.MethodDelete, endpoint, nil, nil)
}

func (c *Client) GetRules(ctx context.Context) ([]engine.RuleItem, error) {
	var res struct {
		Rules []engine.RuleItem `json:"rules"`
	}
	if err := c.request(ctx, http.MethodGet, "/localapi/v0/rules", nil, &res); err != nil {
		return nil, err
	}
	return res.Rules, nil
}

func (c *Client) QueryDNS(ctx context.Context, domain, recordType string) (*engine.DNSQueryResponse, error) {
	payload := map[string]any{"domain": domain, "type": recordType}
	var res engine.DNSQueryResponse
	if err := c.request(ctx, http.MethodPost, "/localapi/v0/dns/query", payload, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) FlushDNS(ctx context.Context) error {
	return c.request(ctx, http.MethodPost, "/localapi/v0/dns/flush", nil, nil)
}

func (c *Client) GetLogs(ctx context.Context, level string) ([]engine.LogEntry, error) {
	endpoint := "/localapi/v0/logs"
	if level != "" {
		endpoint += "?level=" + url.QueryEscape(level)
	}
	var res struct {
		Logs []engine.LogEntry `json:"logs"`
	}
	if err := c.request(ctx, http.MethodGet, endpoint, nil, &res); err != nil {
		return nil, err
	}
	return res.Logs, nil
}

func (c *Client) RunDoctor(ctx context.Context) (*diag.DoctorReport, error) {
	var res diag.DoctorReport
	if err := c.request(ctx, http.MethodPost, "/localapi/v0/doctor", nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) GetBugReport(ctx context.Context) (*diag.BugReport, error) {
	var res diag.BugReport
	if err := c.request(ctx, http.MethodGet, "/localapi/v0/bugreport", nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}
