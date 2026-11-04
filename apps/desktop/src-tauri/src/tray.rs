//! Native tray surface. Daily connect/disconnect, takeover mode, routing
//! mode and node switching happen here without opening the window — the
//! tray polls LocalAPI directly (see `localapi.rs`) so it stays functional
//! while the window is hidden, and it never spawns or stops the daemon:
//! per daemon-runtime spec, closing/quitting the GUI must not take the
//! proxy down.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{image::Image, AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_clipboard_manager::ClipboardExt as _;
use tauri_plugin_notification::NotificationExt as _;
use tauri_plugin_window_state::AppHandleExt as _;

const TRAY_TOGGLE_CONN: &str = "tray_toggle_conn";
const TRAY_MODE_SYSPROXY: &str = "tray_mode_sysproxy";
const TRAY_MODE_TUN: &str = "tray_mode_tun";
const TRAY_MODE_PORT: &str = "tray_mode_port";
const TRAY_ROUTING_RULE: &str = "tray_routing_rule";
const TRAY_ROUTING_GLOBAL: &str = "tray_routing_global";
const TRAY_ROUTING_DIRECT: &str = "tray_routing_direct";
const TRAY_COPY_ENV: &str = "tray_copy_env";
const TRAY_AUTOSTART: &str = "tray_autostart";
const TRAY_SHOW: &str = "tray_show_window";
const TRAY_QUIT: &str = "tray_quit";
/// Node items carry their position: `tray_node/{group_index}/{node_index}`
/// resolved against the snapshot stored in `TrayShared`.
const TRAY_NODE_PREFIX: &str = "tray_node/";

const MAX_GROUPS: usize = 8;
const MAX_NODES_PER_GROUP: usize = 30;
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const INTENT_TIMEOUT: Duration = Duration::from_secs(10);

/// One LocalAPI snapshot, flattened for menu/tooltip rendering.
#[derive(Debug, Clone, Default)]
struct TrayState {
    daemon_ok: bool,
    running: bool,
    takeover: String,
    routing: String,
    mixed_port: u16,
    tun_capable: bool,
    tun_reason: String,
    sub_name: String,
    node_now: String,
    groups: Vec<TrayGroup>,
}

#[derive(Debug, Clone, Default)]
struct TrayGroup {
    name: String,
    now: String,
    nodes: Vec<String>,
}

/// What the user just asked the tray to do; drives the transitional
/// 「正在連線／斷線」 display until the poll confirms it or times out.
#[derive(Debug, Clone, Copy)]
struct Intent {
    want_running: bool,
    deadline: Instant,
}

impl Intent {
    fn live(&self) -> Option<bool> {
        if Instant::now() >= self.deadline {
            None
        } else {
            Some(self.want_running)
        }
    }
}

struct TrayShared {
    tray: TrayIcon<Wry>,
    state: Mutex<TrayState>,
    menu_fingerprint: Mutex<String>,
    // The poll re-renders every 2s; icon/tooltip only go to the OS when the
    // visible state actually changed to avoid tray flicker.
    icon_state: Mutex<String>,
    tooltip: Mutex<String>,
    intent: Mutex<Option<Intent>>,
    prev_alive: Mutex<Option<bool>>,
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("missing default window icon")?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("XBond")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(TrayShared {
        tray,
        state: Mutex::new(TrayState::default()),
        menu_fingerprint: Mutex::new(String::new()),
        icon_state: Mutex::new(String::new()),
        tooltip: Mutex::new("XBond".to_string()),
        intent: Mutex::new(None),
        prev_alive: Mutex::new(None),
    });

    // First paint of the real state, then a steady poll. The tray is the
    // shell's own LocalAPI client: it never spawns the daemon (that stays
    // the frontend self-heal's job with its spawn cooldown).
    refresh_tray(app);
    let app_handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL_INTERVAL);
        refresh_tray(&app_handle);
    });

    Ok(())
}

/// Quit the GUI only. The daemon is a peer and keeps serving: system proxy
/// and TUN are daemon-owned, so GUI exit cannot strand them (daemon-runtime
/// spec: 關閉視窗、退出 GUI、斷線、停止後台服務是四種語義).
pub fn quit(app: &AppHandle) {
    let _ = app.save_window_state(crate::window_state_flags());
    app.exit(0);
}

pub(crate) fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        if visible && window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
            let _ = window.set_focus();
            return;
        }
        if visible {
            let _ = window.hide();
        } else {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn poll_state() -> TrayState {
    let status = match crate::localapi::fetch_status() {
        Ok(status) => status,
        Err(_) => {
            return TrayState {
                daemon_ok: false,
                ..TrayState::default()
            }
        }
    };
    let mut state = TrayState {
        daemon_ok: true,
        running: status.engine.running,
        takeover: status.engine.takeover_mode,
        routing: status.engine.routing_mode,
        mixed_port: status.preferences.mixed_port,
        tun_capable: status.capabilities.tun,
        tun_reason: status.capabilities.tun_reason_code,
        sub_name: status.active_sub.map(|sub| sub.name).unwrap_or_default(),
        ..TrayState::default()
    };
    if state.running {
        if let Ok(proxies) = crate::localapi::fetch_proxies() {
            fill_groups(&mut state, proxies);
        }
    }
    state
}

fn fill_groups(state: &mut TrayState, proxies: crate::localapi::ProxiesResponse) {
    for (name, raw) in proxies.proxies {
        let Ok(item) = serde_json::from_value::<crate::localapi::ProxyItem>(raw) else {
            continue;
        };
        // Selector groups are the ones a click can actually switch; GLOBAL
        // only becomes meaningful when routing mode is global.
        if item.kind != "Selector" || (name == "GLOBAL" && state.routing != "global") {
            continue;
        }
        if state.groups.len() >= MAX_GROUPS {
            break;
        }
        state.groups.push(TrayGroup {
            name,
            now: item.now,
            nodes: item.all.into_iter().take(MAX_NODES_PER_GROUP).collect(),
        });
    }
    state.node_now = state
        .groups
        .first()
        .map(|g| g.now.clone())
        .unwrap_or_default();
}

fn refresh_tray(app: &AppHandle) {
    let state = poll_state();

    // Only a daemon loss is worth interrupting the user for: a core going
    // idle can be a peer's own disconnect (CLI, web UI), not an incident.
    let shared = app.state::<TrayShared>();
    let mut prev_alive = shared.prev_alive.lock().unwrap_or_else(|e| e.into_inner());
    if *prev_alive == Some(true) && !state.daemon_ok {
        notify(
            app,
            "XBond 核心離線",
            "後台服務失去回應；重新打開 XBond 可嘗試恢復。",
        );
    }
    *prev_alive = Some(state.daemon_ok);
    drop(prev_alive);

    // Expired intents are inert but still cleared so they can't confuse a
    // later display pass.
    {
        let mut intent = shared.intent.lock().unwrap_or_else(|e| e.into_inner());
        let expired = match intent.as_ref() {
            Some(i) => i.live().is_none(),
            None => false,
        };
        if expired {
            *intent = None;
        }
    }

    *shared.state.lock().unwrap_or_else(|e| e.into_inner()) = state.clone();
    display_tray(app, &state);
}

/// Render icon, tooltip and (when changed) menu from a snapshot plus the
/// live intent, without touching the network.
fn display_tray(app: &AppHandle, state: &TrayState) {
    let shared = app.state::<TrayShared>();
    let intent = shared
        .intent
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .and_then(|intent| intent.live());

    let connecting = intent == Some(true) && !state.running;
    let disconnecting = intent == Some(false) && state.running;

    // The poll re-renders every 2s: icon/tooltip only go to the OS when the
    // visible state actually changed, so the tray never flickers.
    let icon_key = if !state.daemon_ok {
        "offline"
    } else if connecting {
        "connecting"
    } else if disconnecting || !state.running {
        "disconnected"
    } else {
        "connected"
    };
    {
        let mut icon_state = shared.icon_state.lock().unwrap_or_else(|e| e.into_inner());
        if *icon_state != icon_key {
            if let Some(icon) = state_icon(app, state, connecting) {
                shared.tray.set_icon(Some(icon)).ok();
                *icon_state = icon_key.to_string();
            }
        }
    }

    {
        let tip = tooltip(state, connecting, disconnecting);
        let mut last_tip = shared.tooltip.lock().unwrap_or_else(|e| e.into_inner());
        if *last_tip != tip {
            shared.tray.set_tooltip(Some(tip.clone())).ok();
            *last_tip = tip;
        }
    }

    let fingerprint = menu_fingerprint(state, app);
    let mut last = shared
        .menu_fingerprint
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if *last != fingerprint {
        match build_menu(app, state) {
            Ok(menu) => {
                shared.tray.set_menu(Some(menu)).ok();
                *last = fingerprint;
            }
            Err(e) => eprintln!("[XBond Desktop] Failed to rebuild tray menu: {e}"),
        }
    }
}

fn set_intent(app: &AppHandle, want_running: bool) {
    let shared = app.state::<TrayShared>();
    *shared.intent.lock().unwrap_or_else(|e| e.into_inner()) = Some(Intent {
        want_running,
        deadline: Instant::now() + INTENT_TIMEOUT,
    });
}

/// Queue an async LocalAPI action, then refresh from the source of truth.
/// The tray is the only feedback surface for these clicks, so a failure
/// answers with a native notification instead of vanishing.
fn run_action(
    app: &AppHandle,
    failure_notice: &'static str,
    action: impl FnOnce() -> Result<(), String> + Send + 'static,
) {
    let handle = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = action() {
            eprintln!("[XBond Desktop] Tray action failed: {e}");
            notify(&handle, failure_notice, &e);
        }
        refresh_tray(&handle);
    });
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        TRAY_TOGGLE_CONN => {
            let running = app
                .state::<TrayShared>()
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .running;
            let want_running = !running;
            set_intent(app, want_running);
            // Transitional display without waiting for the next poll tick.
            let state = app
                .state::<TrayShared>()
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            display_tray(app, &state);
            run_action(
                app,
                if want_running {
                    "連線失敗"
                } else {
                    "斷線失敗"
                },
                move || {
                    if want_running {
                        crate::localapi::up()
                    } else {
                        crate::localapi::down()
                    }
                },
            );
        }
        TRAY_MODE_SYSPROXY | TRAY_MODE_TUN | TRAY_MODE_PORT => {
            let mode = id.trim_start_matches("tray_mode_");
            let mode = mode.to_string();
            run_action(app, "接管模式切換失敗", move || {
                crate::localapi::set_mode(&mode, "")
            });
        }
        TRAY_ROUTING_RULE | TRAY_ROUTING_GLOBAL | TRAY_ROUTING_DIRECT => {
            let routing = id.trim_start_matches("tray_routing_").to_string();
            run_action(app, "路由模式切換失敗", move || {
                crate::localapi::set_mode("", &routing)
            });
        }
        TRAY_COPY_ENV => {
            let port = app
                .state::<TrayShared>()
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .mixed_port;
            if port == 0 {
                return;
            }
            match app.clipboard().write_text(proxy_env_command(port)) {
                Ok(()) => notify(app, "XBond", "代理環境變數已複製到剪貼簿。"),
                Err(e) => eprintln!("[XBond Desktop] Failed to write clipboard: {e}"),
            }
        }
        TRAY_AUTOSTART => {
            match app.autolaunch().is_enabled() {
                Ok(enabled) => {
                    let result = if enabled {
                        app.autolaunch().disable()
                    } else {
                        app.autolaunch().enable()
                    };
                    if let Err(e) = result {
                        eprintln!("[XBond Desktop] Failed to toggle autostart: {e}");
                    }
                }
                Err(e) => eprintln!("[XBond Desktop] Failed to read autostart: {e}"),
            }
            display_tray(
                app,
                &app.state::<TrayShared>()
                    .state
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone(),
            );
        }
        TRAY_SHOW => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        TRAY_QUIT => quit(app),
        other => {
            if let Some(rest) = other.strip_prefix(TRAY_NODE_PREFIX) {
                select_tray_node(app, rest);
            }
        }
    }
}

fn select_tray_node(app: &AppHandle, spec: &str) {
    let (gi, ni) = match spec.split_once('/') {
        Some((gi, ni)) => match (gi.parse::<usize>(), ni.parse::<usize>()) {
            (Ok(gi), Ok(ni)) => (gi, ni),
            _ => return,
        },
        None => return,
    };
    let shared = app.state::<TrayShared>();
    let groups = &shared
        .state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .groups;
    let Some(group) = groups.get(gi) else { return };
    let Some(node) = group.nodes.get(ni) else {
        return;
    };
    let group = group.name.clone();
    let node = node.clone();
    run_action(app, "節點切換失敗", move || {
        crate::localapi::select_node(&group, &node)
    });
}

fn tooltip(state: &TrayState, connecting: bool, disconnecting: bool) -> String {
    if !state.daemon_ok {
        return "XBond — 核心離線".into();
    }
    if disconnecting {
        return "XBond — 正在斷線…".into();
    }
    if connecting {
        return "XBond — 正在連線…".into();
    }
    if !state.running {
        return "XBond — 未連線".into();
    }
    let takeover = match state.takeover.as_str() {
        "sysproxy" => "系統代理",
        "tun" => "TUN",
        "port" => "僅埠",
        _ => "",
    };
    let routing = match state.routing.as_str() {
        "rule" => "規則",
        "global" => "全域",
        "direct" => "直連",
        _ => "",
    };
    let node = if state.node_now.is_empty() {
        state.sub_name.as_str()
    } else {
        state.node_now.as_str()
    };
    let mut parts: Vec<&str> = [takeover, routing]
        .into_iter()
        .filter(|p| !p.is_empty())
        .collect();
    if !node.is_empty() {
        parts.push(node);
    }
    if parts.is_empty() {
        return "XBond — 已連線".into();
    }
    format!("XBond — {}", parts.join(" · "))
}

fn menu_fingerprint(state: &TrayState, app: &AppHandle) -> String {
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);
    let groups: Vec<String> = state
        .groups
        .iter()
        .map(|g| format!("{}={}|{}", g.name, g.now, g.nodes.join(",")))
        .collect();
    format!(
        "ok={} run={} mode={}/{} tun={}/{} auto={} ports={}",
        state.daemon_ok,
        state.running,
        state.takeover,
        state.routing,
        state.tun_capable,
        state.tun_reason,
        autostart,
        groups.join(";"),
    )
}

fn build_menu(app: &AppHandle, state: &TrayState) -> Result<Menu<Wry>, tauri::Error> {
    let enabled = state.daemon_ok;
    let connect_label = if state.running { "斷線" } else { "連線" };
    let toggle = MenuItem::with_id(app, TRAY_TOGGLE_CONN, connect_label, enabled, None::<&str>)?;
    let separator_head = PredefinedMenuItem::separator(app)?;

    let sysproxy = CheckMenuItem::with_id(
        app,
        TRAY_MODE_SYSPROXY,
        "系統代理",
        enabled,
        state.takeover == "sysproxy",
        None::<&str>,
    )?;
    let tun_label = match state.tun_reason.as_str() {
        "not_elevated" => "TUN 模式（需管理員權限）",
        "not_root" => "TUN 模式（需要 root）",
        "wintun_missing" => "TUN 模式（缺少 wintun.dll）",
        _ => "TUN 模式",
    };
    let tun = CheckMenuItem::with_id(
        app,
        TRAY_MODE_TUN,
        tun_label,
        enabled && state.tun_capable,
        state.takeover == "tun",
        None::<&str>,
    )?;
    let port_only = CheckMenuItem::with_id(
        app,
        TRAY_MODE_PORT,
        "僅本機埠",
        enabled,
        state.takeover == "port",
        None::<&str>,
    )?;

    let rule = CheckMenuItem::with_id(
        app,
        TRAY_ROUTING_RULE,
        "規則",
        enabled,
        state.routing == "rule",
        None::<&str>,
    )?;
    let global = CheckMenuItem::with_id(
        app,
        TRAY_ROUTING_GLOBAL,
        "全域",
        enabled,
        state.routing == "global",
        None::<&str>,
    )?;
    let direct = CheckMenuItem::with_id(
        app,
        TRAY_ROUTING_DIRECT,
        "直連",
        enabled,
        state.routing == "direct",
        None::<&str>,
    )?;
    let routing = Submenu::with_id_and_items(
        app,
        "tray_routing_menu",
        "路由模式",
        enabled,
        &[&rule, &global, &direct],
    )?;

    let mut items: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = vec![
        &toggle,
        &separator_head,
        &sysproxy,
        &tun,
        &port_only,
        &routing,
    ];

    let node_menu = node_submenu(app, state)?;
    let separator_before_nodes = PredefinedMenuItem::separator(app)?;
    if let Some(node_menu) = &node_menu {
        items.push(&separator_before_nodes);
        items.push(node_menu);
    }

    let autostart = CheckMenuItem::with_id(
        app,
        TRAY_AUTOSTART,
        "開機自動啟動",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let copy_env = MenuItem::with_id(
        app,
        TRAY_COPY_ENV,
        if cfg!(windows) {
            "複製 PowerShell 代理命令"
        } else {
            "複製終端代理命令"
        },
        enabled && state.mixed_port > 0,
        None::<&str>,
    )?;
    let separator_tail = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, TRAY_SHOW, "打開主視窗", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT, "退出 XBond", true, None::<&str>)?;
    let separator_end = PredefinedMenuItem::separator(app)?;

    items.push(&separator_tail);
    items.push(&autostart);
    items.push(&copy_env);
    items.push(&separator_end);
    items.push(&show);
    items.push(&quit);

    Menu::with_items(app, &items)
}

fn node_submenu(app: &AppHandle, state: &TrayState) -> Result<Option<Submenu<Wry>>, tauri::Error> {
    if !state.running || state.groups.is_empty() {
        return Ok(None);
    }
    let mut group_menus: Vec<Submenu<Wry>> = Vec::with_capacity(state.groups.len());
    for (gi, group) in state.groups.iter().enumerate() {
        let mut node_items: Vec<CheckMenuItem<Wry>> = Vec::with_capacity(group.nodes.len());
        for (ni, node) in group.nodes.iter().enumerate() {
            node_items.push(CheckMenuItem::with_id(
                app,
                format!("{TRAY_NODE_PREFIX}{gi}/{ni}"),
                node,
                true,
                *node == group.now,
                None::<&str>,
            )?);
        }
        let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = node_items
            .iter()
            .map(|item| item as &dyn tauri::menu::IsMenuItem<Wry>)
            .collect();
        group_menus.push(Submenu::with_id_and_items(
            app,
            format!("tray_group/{gi}"),
            &group.name,
            true,
            &refs,
        )?);
    }
    let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = group_menus
        .iter()
        .map(|menu| menu as &dyn tauri::menu::IsMenuItem<Wry>)
        .collect();
    Ok(Some(Submenu::with_id_and_items(
        app,
        "tray_nodes_menu",
        "節點",
        true,
        &refs,
    )?))
}

fn state_icon(app: &AppHandle, state: &TrayState, connecting: bool) -> Option<Image<'static>> {
    let base = app.default_window_icon()?;
    let rgba = base.rgba();
    let (width, height) = (base.width(), base.height());
    // Connected keeps the brand icon untouched; every other state tints the
    // icon by luminance so the silhouette stays recognizable at 16px.
    let tint: Option<[u8; 3]> = if !state.daemon_ok {
        Some([225, 68, 58])
    } else if connecting {
        Some([224, 147, 20])
    } else if !state.running {
        Some([150, 150, 150])
    } else {
        None
    };
    let Some(color) = tint else {
        return Some(Image::new_owned(rgba.to_vec(), width, height));
    };
    let mut data = rgba.to_vec();
    for px in data.chunks_exact_mut(4) {
        let luma = (px[0] as u32 * 299 + px[1] as u32 * 587 + px[2] as u32 * 114) / 1000;
        for (channel, weight) in px.iter_mut().take(3).zip(color) {
            *channel = ((luma * weight as u32) / 255).min(255) as u8;
        }
    }
    Some(Image::new_owned(data, width, height))
}

fn proxy_env_command(port: u16) -> String {
    let base = format!("http://127.0.0.1:{port}");
    #[cfg(windows)]
    {
        format!("$env:HTTP_PROXY=\"{base}\"; $env:HTTPS_PROXY=\"{base}\"")
    }
    #[cfg(not(windows))]
    {
        format!("export http_proxy={base} https_proxy={base} all_proxy={base}")
    }
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}
