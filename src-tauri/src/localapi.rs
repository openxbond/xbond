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
const INSTALL_TIMEOUT: Duration = Duration::from_secs(120);

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
}

/// The daemon's real takeover facts: system proxy and TUN are independent
/// switches (runtime.go `reconcileTakeover`) and can run together; the
/// collapsed `takeoverMode` enum is a derived view, so consumers that need
/// the truth read the flags.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Preferences {
    #[serde(default, rename = "systemProxy")]
    pub system_proxy: bool,
    #[serde(default)]
    pub tun: bool,
    #[serde(default, rename = "routingMode")]
    pub routing_mode: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Capabilities {
    #[serde(default)]
    pub tun: bool,
    #[serde(default, rename = "tunReasonCode")]
    pub tun_reason_code: String,
    #[serde(default, rename = "serviceInstalled")]
    pub service_installed: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ActiveSub {
    #[serde(default)]
    pub name: String,
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

/// `/localapi/v0/nodes` returns the core's proxies document as a bare map —
/// server.go `handleNodes` writes the engine's `GetProxies` map directly,
/// with no `proxies` wrapper key. Order follows the core's document
/// (serde_json's preserve_order feature); each entry is decoded separately.
pub fn fetch_proxies() -> Result<serde_json::Map<String, serde_json::Value>, String> {
    get_json("/localapi/v0/nodes")
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

fn post_action(path: &str, body: serde_json::Value) -> Result<(), String> {
    request(ACTION_TIMEOUT, "POST", path, Some(body)).map(|_| ())
}

pub fn up() -> Result<(), String> {
    post_action("/localapi/v0/up", json!({}))
}

pub fn down() -> Result<(), String> {
    post_action("/localapi/v0/down", json!({}))
}

/// Independent takeover switches: each POSTs one boolean flag, leaving the
/// other switch and routing untouched (daemon `reconcileTakeover`). Both off
/// is the port-only state.
pub fn set_sysproxy(on: bool) -> Result<(), String> {
    post_action("/localapi/v0/mode", json!({ "systemProxy": on }))
}

pub fn set_tun(on: bool) -> Result<(), String> {
    post_action("/localapi/v0/mode", json!({ "tun": on }))
}

/// Routing-only switch; an empty mode field leaves takeover untouched.
pub fn set_routing(routing: &str) -> Result<(), String> {
    post_action("/localapi/v0/mode", json!({ "routing": routing }))
}

/// Registers the machine-scoped tunnel host. The daemon raises the native
/// elevation prompt (UAC / osascript) and returns once the elevated helper
/// is launched — callers confirm the outcome by polling
/// `capabilities.serviceInstalled` (server.go `handleServiceInstall`).
/// The long timeout covers a user deliberating over the OS prompt.
pub fn install_service() -> Result<(), String> {
    request(
        INSTALL_TIMEOUT,
        "POST",
        "/localapi/v0/service/install",
        Some(json!({})),
    )
    .map(|_| ())
}

pub fn select_node(group: &str, node: &str) -> Result<(), String> {
    post_action(
        "/localapi/v0/nodes/select",
        json!({ "group": group, "node": node }),
    )
}

/// Hands the browser's OAuth authorization code (delivered by the OS deep
/// link) to the daemon, which validates the state and completes the token
/// exchange. The shell never holds tokens — it is only the delivery path.
pub fn post_account_callback(code: &str, state: &str) -> Result<(), String> {
    post_action(
        "/localapi/v0/account/callback",
        json!({ "code": code, "state": state }),
    )
}
