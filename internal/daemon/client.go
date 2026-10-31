package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/openxbond/xbond/internal/daemon/service"
	"github.com/openxbond/xbond/internal/diag"
	"github.com/openxbond/xbond/internal/engine"
	"github.com/openxbond/xbond/internal/platform/paths"
	"github.com/openxbond/xbond/internal/sub"
)

type Client struct {
	addr       string
	token      string
	httpClient *http.Client
	slowClient *http.Client
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

type ShutdownResult struct {
	CleanedUp bool   `json:"cleanedUp"`
	Error     string `json:"error,omitempty"`
}

type LoginResponse struct {
	OK          bool                  `json:"ok"`
	Meta        *sub.SubscriptionMeta `json:"meta"`
	UpdateError string                `json:"updateError,omitempty"`
}

type AddSubResponse struct {
	Meta        *sub.SubscriptionMeta `json:"meta"`
	Activated   bool                  `json:"activated"`
	Reloaded    bool                  `json:"reloaded"`
	UpdateError string                `json:"updateError,omitempty"`
}

type LogoutResponse struct {
	OK      bool                   `json:"ok"`
	Removed []sub.SubscriptionMeta `json:"removed"`
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
		slowClient: &http.Client{
			// Endpoints that fetch and apply a subscription can legitimately
			// take minutes: a first config download measured 2.6 MB over a
			// ~39 KB/s line (~67 s), and the fetch client alone allows 120 s.
			Timeout: 180 * time.Second,
		},
	}, nil
}

// Connect returns a client for an already responding daemon. Unlike
// EnsureRunning it never starts the service: read-only commands answer
// questions about the current state, they must not bring a stopped daemon
// back to life as a side effect.
func Connect(ctx context.Context) (*Client, error) {
	if c, err := NewClient(); err == nil {
		if _, err := c.GetStatusLight(ctx); err == nil {
			return c, nil
		}
	}
	return nil, errors.New("xbond daemon is not running; start it with `xbond daemon start` (first time? install it: `xbond daemon install`)")
}

// EnsureRunning connects to the managed xbond daemon. An already running
// daemon is reused and an installed-but-stopped service is started. The CLI
// never spawns a bare daemon process and never registers autostart on its
// own: installing the service is an explicit `xbond daemon install`, so a
// stray command cannot silently change what starts at login.
func EnsureRunning(ctx context.Context) (*Client, error) {
	if c, err := NewClient(); err == nil {
		if _, err := c.GetStatusLight(ctx); err == nil {
			return c, nil
		}
	}

	if !service.Installed() {
		return nil, fmt.Errorf(
			"xbond daemon is not running; start the background service with `xbond daemon start` (first time? install it: `xbond daemon install`, or run `xbond daemon` in another terminal)",
		)
	}
	if err := service.Start(); err != nil {
		return nil, fmt.Errorf("failed to start xbond daemon service: %w", err)
	}

	// Poll until ready (up to 5 seconds) for the supervised daemon to publish
	// its addr/token files. The probe is the light status: readiness must not
	// trigger the full network diagnostic on every poll.
	for i := 0; i < 50; i++ {
		time.Sleep(100 * time.Millisecond)
		c, err := NewClient()
		if err == nil {
			if _, err := c.GetStatusLight(ctx); err == nil {
				return c, nil
			}
		}
	}

	return nil, fmt.Errorf("xbond daemon service started but did not become ready in time; check its logs")
}

// Shutdown asks the daemon to exit gracefully through the LocalAPI shutdown
// endpoint. The daemon tears its runtime down before answering, so the
// result reports completed cleanup (engine down, proxy restored) — accepted
// but incomplete exits surface in CleanedUp/Error. Platform supervisors kill
// processes hard, so service stop goes through this first.
func (c *Client) Shutdown(ctx context.Context) (*ShutdownResult, error) {
	var res ShutdownResult
	if err := c.request(ctx, http.MethodPost, "/localapi/v0/shutdown", nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) request(ctx context.Context, method, endpoint string, body any, target any) error {
	return c.requestWith(ctx, c.httpClient, method, endpoint, body, target)
}

// requestSlow runs endpoints whose handler fetches a subscription config;
// see slowClient for the timeout rationale.
func (c *Client) requestSlow(ctx context.Context, method, endpoint string, body any, target any) error {
	return c.requestWith(ctx, c.slowClient, method, endpoint, body, target)
}

func (c *Client) requestWith(ctx context.Context, client *http.Client, method, endpoint string, body any, target any) error {
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

	resp, err := client.Do(req)
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

func (c *Client) getStatus(ctx context.Context, query string) (*StatusResponse, error) {
	var res StatusResponse
	if err := c.request(ctx, http.MethodGet, "/localapi/v0/status"+query, nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// GetStatus returns the full status including the three-tier network
// evaluation (DNS and egress probes).
func (c *Client) GetStatus(ctx context.Context) (*StatusResponse, error) {
	return c.getStatus(ctx, "")
}

// GetStatusLight skips the network probes — the shape for readiness checks
// and polling loops.
func (c *Client) GetStatusLight(ctx context.Context) (*StatusResponse, error) {
	return c.getStatus(ctx, "?light=1")
}

func (c *Client) Up(ctx context.Context, mode engine.TakeoverMode, routing engine.RoutingMode, port int, allowLan *bool, subID string) error {
	payload := map[string]any{
		"mode":     mode,
		"routing":  routing,
		"port":     port,
		"allowLan": allowLan,
		"subId":    subID,
	}
	return c.requestSlow(ctx, http.MethodPost, "/localapi/v0/up", payload, nil)
}

// Down disconnects the core. The bool reports whether there was anything to
// stop, so the CLI can distinguish "stopped" from "was already stopped".
func (c *Client) Down(ctx context.Context) (bool, error) {
	var res struct {
		Stopped bool `json:"stopped"`
	}
	if err := c.request(ctx, http.MethodPost, "/localapi/v0/down", nil, &res); err != nil {
		return false, err
	}
	return res.Stopped, nil
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

// Login binds a subscription (XBond token or universal source) as the login
// result. A non-empty UpdateError means authorization and saving succeeded
// but the initial configuration fetch failed — the subscription stays and
// `xbond update` retries the fetch.
func (c *Client) Login(ctx context.Context, token, origin string, fallbackOrigins []string, protocol, lang, name, urlOrFile string) (*LoginResponse, error) {
	payload := map[string]any{
		"token":           token,
		"origin":          origin,
		"fallbackOrigins": fallbackOrigins,
		"protocol":        protocol,
		"lang":            lang,
		"name":            name,
		"urlOrFile":       urlOrFile,
	}
	var res LoginResponse
	if err := c.requestSlow(ctx, http.MethodPost, "/localapi/v0/login", payload, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// Logout removes the local XBond credentials. It returns what was removed;
// universal subscriptions are never touched by logout.
func (c *Client) Logout(ctx context.Context) ([]sub.SubscriptionMeta, error) {
	var res struct {
		OK      bool                   `json:"ok"`
		Removed []sub.SubscriptionMeta `json:"removed"`
	}
	if err := c.request(ctx, http.MethodPost, "/localapi/v0/logout", nil, &res); err != nil {
		return nil, err
	}
	return res.Removed, nil
}

// SubscriptionProgress snapshots the daemon's in-flight subscription config
// download; inactive when nothing is downloading.
func (c *Client) SubscriptionProgress(ctx context.Context) (*sub.FetchProgress, error) {
	var res sub.FetchProgress
	if err := c.request(ctx, http.MethodGet, "/localapi/v0/subs/progress", nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) ListSubs(ctx context.Context) (*SubsListResponse, error) {
	var res SubsListResponse
	if err := c.request(ctx, http.MethodGet, "/localapi/v0/subs", nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) AddSub(ctx context.Context, subType sub.SubscriptionType, token, origin string, fallbacks []string, protocol, lang, name, urlOrFile string, interval int, use bool) (*AddSubResponse, error) {
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
	var res AddSubResponse
	if err := c.requestSlow(ctx, http.MethodPost, "/localapi/v0/subs", payload, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

func (c *Client) UseSub(ctx context.Context, id string) error {
	payload := map[string]any{"id": id}
	return c.request(ctx, http.MethodPost, "/localapi/v0/subs/use", payload, nil)
}

func (c *Client) UpdateSub(ctx context.Context, id string, force, viaProxy bool) (*sub.UpdateResult, error) {
	payload := map[string]any{
		"id":       id,
		"force":    force,
		"viaProxy": viaProxy,
	}
	var res sub.UpdateResult
	if err := c.requestSlow(ctx, http.MethodPost, "/localapi/v0/subs/update", payload, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// UpdateSubAll refreshes every subscription and returns each per-item
// outcome; the response is always 200, so partial failure keeps all results.
func (c *Client) UpdateSubAll(ctx context.Context, force, viaProxy bool) (*sub.BatchUpdateResult, error) {
	payload := map[string]any{
		"force":    force,
		"viaProxy": viaProxy,
		"all":      true,
	}
	var res sub.BatchUpdateResult
	if err := c.requestSlow(ctx, http.MethodPost, "/localapi/v0/subs/update", payload, &res); err != nil {
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

func (c *Client) GetLogs(ctx context.Context, level string, limit int) ([]engine.LogEntry, error) {
	endpoint := fmt.Sprintf("/localapi/v0/logs?limit=%d", limit)
	if level != "" {
		endpoint += "&level=" + url.QueryEscape(level)
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
