//! Tray-side LocalAPI client. The desktop shell is a LocalAPI peer exactly
//! like the CLI (daemon-runtime spec: GUI 不持有第二份狀態來源) — the tray
//! polls the same `/localapi/v0` endpoints the frontend does, so tray state
//! stays truthful even when the webview is hidden, hung, or gone.
//!
//! Plain HTTP on loopback only: credentials come from the daemon's discovery
//! files, re-read on every call so a daemon restart with a fresh token is
//! picked up without shell restart.

use serde::Deserialize;
use serde_json::json;
use std::sync::OnceLock;
use std::time::Duration;

const POLL_TIMEOUT: Duration = Duration::from_secs(2);
const ACTION_TIMEOUT: Duration = Duration::from_secs(10);

fn agent(timeout: Duration) -> ureq::Agent {
    static POLL: OnceLock<ureq::Agent> = OnceLock::new();
    static ACTION: OnceLock<ureq::Agent> = OnceLock::new();
    let build = || {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_millis(700))
            .timeout(timeout)
            .build()
    };
    // Two distinct timeouts per call kind; the slots only cache the config.
    (if timeout == POLL_TIMEOUT {
        &POLL
    } else {
        &ACTION
    })
    .get_or_init(build)
    .clone()
}

fn endpoint() -> Result<(String, String), &'static str> {
    crate::daemon::read_credentials().ok_or("daemon discovery files are missing")
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct StatusResponse {
    #[serde(default, rename = "engine")]
    pub engine: EngineStatus,
    #[serde(default, rename = "preferences")]
    pub preferences: Preferences,
    #[serde(default, rename = "activeSub")]
    pub active_sub: Option<ActiveSub>,
    #[serde(default)]
    pub capabilities: Capabilities,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct EngineStatus {
    #[serde(default)]
    pub running: bool,
    #[serde(default, rename = "takeoverMode")]
    pub takeover_mode: String,
    #[serde(default, rename = "routingMode")]
    pub routing_mode: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Preferences {
    #[serde(default, rename = "mixedPort")]
    pub mixed_port: u16,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ActiveSub {
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Capabilities {
    #[serde(default)]
    pub tun: bool,
    #[serde(default, rename = "tunReasonCode")]
    pub tun_reason_code: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProxyItem {
    #[serde(default, rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub now: String,
    #[serde(default)]
    pub all: Vec<String>,
}

/// The proxies object keeps the core's document order (serde_json's
/// preserve_order feature), but Map only implements Deserialize for
/// `Value`, so each entry is decoded separately.
#[derive(Debug, Clone, Deserialize)]
pub struct ProxiesResponse {
    #[serde(default)]
    pub proxies: serde_json::Map<String, serde_json::Value>,
}

fn request(
    timeout: Duration,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<ureq::Response, String> {
    let (addr, token) = endpoint()?;
    let url = format!("http://{addr}{path}");
    let req = agent(timeout)
        .request(method, &url)
        .set("X-XBond-Token", &token)
        .timeout(timeout);
    let result = match body {
        Some(payload) => req.send_json(payload),
        None => req.call(),
    };
    result.map_err(|e| e.to_string())
}

fn get_json<T: for<'de> Deserialize<'de>>(path: &str) -> Result<T, String> {
    let resp = request(POLL_TIMEOUT, "GET", path, None)?;
    resp.into_json::<T>().map_err(|e| e.to_string())
}

/// Light status: skips the daemon's three-tier network evaluation, so the
/// 2s tray poll never generates DNS or egress traffic.
pub fn fetch_status() -> Result<StatusResponse, String> {
    get_json("/localapi/v0/status?light=1")
}

pub fn fetch_proxies() -> Result<ProxiesResponse, String> {
    get_json("/localapi/v0/nodes")
}

fn post_action(path: &str, body: serde_json::Value) -> Result<(), String> {
    request(ACTION_TIMEOUT, "POST", path, Some(body)).map(|_| ())
}

pub fn up() -> Result<(), String> {
    post_action("/localapi/v0/up", json!({}))
}

pub fn down() -> Result<(), String> {
    post_action("/localapi/v0/down", json!({}))
}

/// Switch takeover mode and/or routing mode; empty strings leave the other
/// dimension untouched (runtimeOptions zero values are ignored by Configure).
pub fn set_mode(mode: &str, routing: &str) -> Result<(), String> {
    post_action(
        "/localapi/v0/mode",
        json!({ "mode": mode, "routing": routing }),
    )
}

pub fn select_node(group: &str, node: &str) -> Result<(), String> {
    post_action(
        "/localapi/v0/nodes/select",
        json!({ "group": group, "node": node }),
    )
}
