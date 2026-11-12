//! Native tray surface. Daily connect/disconnect, takeover mode, routing
//! mode and node switching happen here without opening the window — the
//! tray polls LocalAPI directly (see `localapi.rs`) so it stays functional
//! while the window is hidden. Closing the window never stops the proxy
//! (daemon-runtime spec); quitting the GUI is an explicit transaction that
//! asks first and stops the supervised service only on confirmation —
//! always through the CLI's supervisor verbs, never a bare stop.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{image::Image, AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_clipboard_manager::ClipboardExt as _;
use tauri_plugin_dialog::{DialogExt as _, MessageDialogButtons};
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

#[derive(Debug, Clone, Copy)]
pub struct TrayI18n {
    pub connect: &'static str,
    pub disconnect: &'static str,
    pub connecting: &'static str,
    pub disconnecting: &'static str,
    pub disconnected: &'static str,
    pub connected: &'static str,
    pub daemon_down: &'static str,
    pub sysproxy: &'static str,
    pub tun: &'static str,
    pub tun_short: &'static str,
    pub tun_needs_admin: &'static str,
    pub tun_needs_root: &'static str,
    pub tun_missing_wintun: &'static str,
    pub port_only: &'static str,
    pub port_short: &'static str,
    pub routing_menu: &'static str,
    pub rule: &'static str,
    pub global: &'static str,
    pub direct: &'static str,
    pub nodes: &'static str,
    pub autostart: &'static str,
    pub copy_env_pwsh: &'static str,
    pub copy_env_sh: &'static str,
    pub show_window: &'static str,
    pub quit: &'static str,
    pub notify_offline_title: &'static str,
    pub notify_offline_body: &'static str,
    pub notify_copied_env: &'static str,
    pub notify_connect_failed: &'static str,
    pub notify_disconnect_failed: &'static str,
    pub notify_takeover_failed: &'static str,
    pub notify_routing_failed: &'static str,
    pub notify_node_failed: &'static str,
    pub quit_confirm_title: &'static str,
    pub quit_confirm_connected: &'static str,
    pub quit_confirm_idle: &'static str,
    pub quit_confirm_ok: &'static str,
    pub quit_confirm_cancel: &'static str,
    pub notify_stop_failed: &'static str,
}

pub const ZH_HK: TrayI18n = TrayI18n {
    connect: "連線",
    disconnect: "斷線",
    connecting: "正在連線…",
    disconnecting: "正在斷線…",
    disconnected: "未連線",
    connected: "已連線",
    daemon_down: "核心離線",
    sysproxy: "系統代理",
    tun: "TUN 模式",
    tun_short: "TUN",
    tun_needs_admin: "TUN 模式（需管理員權限）",
    tun_needs_root: "TUN 模式（需要 root）",
    tun_missing_wintun: "TUN 模式（缺少 wintun.dll）",
    port_only: "僅本機埠",
    port_short: "僅埠",
    routing_menu: "路由模式",
    rule: "規則",
    global: "全域",
    direct: "直連",
    nodes: "節點",
    autostart: "開機自動啟動",
    copy_env_pwsh: "複製 PowerShell 代理命令",
    copy_env_sh: "複製終端代理命令",
    show_window: "打開主視窗",
    quit: "退出 XBond",
    notify_offline_title: "XBond 核心離線",
    notify_offline_body: "後台服務失去回應；重新打開 XBond 可嘗試恢復。",
    notify_copied_env: "代理環境變數已複製到剪貼簿。",
    notify_connect_failed: "連線失敗",
    notify_disconnect_failed: "斷線失敗",
    notify_takeover_failed: "接管模式切換失敗",
    notify_routing_failed: "路由模式切換失敗",
    notify_node_failed: "切換節點失敗",
    quit_confirm_title: "退出 XBond",
    quit_confirm_connected: "連線仍在運行。退出將斷開連線、還原系統代理並停止後台服務；下次啟動 XBond 時服務會自動恢復。",
    quit_confirm_idle: "後台服務仍在運行。退出將停止後台服務；下次啟動 XBond 時會自動恢復。",
    quit_confirm_ok: "退出並停止",
    quit_confirm_cancel: "取消",
    notify_stop_failed: "停止後台服務失敗，已取消退出",
};

pub const ZH_CN: TrayI18n = TrayI18n {
    connect: "连接",
    disconnect: "断开连接",
    connecting: "正在连接…",
    disconnecting: "正在断开…",
    disconnected: "未连接",
    connected: "已连接",
    daemon_down: "核心离线",
    sysproxy: "系统代理",
    tun: "TUN 模式",
    tun_short: "TUN",
    tun_needs_admin: "TUN 模式（需管理员权限）",
    tun_needs_root: "TUN 模式（需要 root）",
    tun_missing_wintun: "TUN 模式（缺少 wintun.dll）",
    port_only: "仅本机端口",
    port_short: "仅端口",
    routing_menu: "路由模式",
    rule: "规则",
    global: "全局",
    direct: "直连",
    nodes: "节点",
    autostart: "开机自启动",
    copy_env_pwsh: "复制 PowerShell 代理命令",
    copy_env_sh: "复制终端代理命令",
    show_window: "打开主窗口",
    quit: "退出 XBond",
    notify_offline_title: "XBond 核心离线",
    notify_offline_body: "后台服务失去响应；重新打开 XBond 可尝试恢复。",
    notify_copied_env: "代理环境变量已复制到剪贴板。",
    notify_connect_failed: "连接失败",
    notify_disconnect_failed: "断开连接失败",
    notify_takeover_failed: "接管模式切换失败",
    notify_routing_failed: "路由模式切换失败",
    notify_node_failed: "切换节点失败",
    quit_confirm_title: "退出 XBond",
    quit_confirm_connected: "连接仍在运行。退出将断开连接、还原系统代理并停止后台服务；下次启动 XBond 时服务会自动恢复。",
    quit_confirm_idle: "后台服务仍在运行。退出将停止后台服务；下次启动 XBond 时会自动恢复。",
    quit_confirm_ok: "退出并停止",
    quit_confirm_cancel: "取消",
    notify_stop_failed: "停止后台服务失败，已取消退出",
};

pub const EN_US: TrayI18n = TrayI18n {
    connect: "Connect",
    disconnect: "Disconnect",
    connecting: "Connecting…",
    disconnecting: "Disconnecting…",
    disconnected: "Disconnected",
    connected: "Connected",
    daemon_down: "Core Offline",
    sysproxy: "System Proxy",
    tun: "TUN Mode",
    tun_short: "TUN",
    tun_needs_admin: "TUN Mode (Admin Required)",
    tun_needs_root: "TUN Mode (Root Required)",
    tun_missing_wintun: "TUN Mode (Missing wintun.dll)",
    port_only: "Local Port Only",
    port_short: "Port Only",
    routing_menu: "Routing Mode",
    rule: "Rule",
    global: "Global",
    direct: "Direct",
    nodes: "Nodes",
    autostart: "Launch on Startup",
    copy_env_pwsh: "Copy PowerShell Proxy Command",
    copy_env_sh: "Copy Terminal Proxy Command",
    show_window: "Open XBond",
    quit: "Quit XBond",
    notify_offline_title: "XBond Core Offline",
    notify_offline_body: "Backend service stopped responding. Reopen XBond to recover.",
    notify_copied_env: "Proxy environment variables copied to clipboard.",
    notify_connect_failed: "Connection Failed",
    notify_disconnect_failed: "Disconnection Failed",
    notify_takeover_failed: "Failed to Switch Takeover Mode",
    notify_routing_failed: "Failed to Switch Routing Mode",
    notify_node_failed: "Failed to Switch Node",
    quit_confirm_title: "Quit XBond",
    quit_confirm_connected: "A connection is still running. Quitting disconnects it, restores your system proxy and stops the background service; it starts again the next time you open XBond.",
    quit_confirm_idle: "The background service is still running. Quitting stops it; it starts again the next time you open XBond.",
    quit_confirm_ok: "Quit and Stop",
    quit_confirm_cancel: "Cancel",
    notify_stop_failed: "Failed to stop the background service; quit cancelled",
};

pub const KO: TrayI18n = TrayI18n {
    connect: "연결",
    disconnect: "연결 해제",
    connecting: "연결 중…",
    disconnecting: "연결 해제 중…",
    disconnected: "연결 안 됨",
    connected: "연결됨",
    daemon_down: "코어 오프라인",
    sysproxy: "시스템 프록시",
    tun: "TUN 모드",
    tun_short: "TUN",
    tun_needs_admin: "TUN 모드 (관리자 권한 필요)",
    tun_needs_root: "TUN 모드 (root 필요)",
    tun_missing_wintun: "TUN 모드 (wintun.dll 없음)",
    port_only: "로컬 포트 전용",
    port_short: "포트 전용",
    routing_menu: "라우팅 모드",
    rule: "규칙",
    global: "전역",
    direct: "직접 연결",
    nodes: "노드",
    autostart: "시작 시 자동 실행",
    copy_env_pwsh: "PowerShell 프록시 명령어 복사",
    copy_env_sh: "터미널 프록시 명령어 복사",
    show_window: "XBond 열기",
    quit: "XBond 종료",
    notify_offline_title: "XBond 코어 오프라인",
    notify_offline_body: "백엔드 서비스가 응답하지 않습니다. XBond를 다시 열어 복구하세요.",
    notify_copied_env: "프록시 환경 변수가 클립보드에 복사되었습니다.",
    notify_connect_failed: "연결 실패",
    notify_disconnect_failed: "연결 해제 실패",
    notify_takeover_failed: "인수 모드 전환 실패",
    notify_routing_failed: "라우팅 모드 전환 실패",
    notify_node_failed: "노드 전환 실패",
    quit_confirm_title: "XBond 종료",
    quit_confirm_connected: "연결이 아직 실행 중입니다. 종료하면 연결이 끊기고 시스템 프록시가 복원되며 백그라운드 서비스가 중지됩니다. XBond를 다시 열면 자동으로 시작됩니다.",
    quit_confirm_idle: "백그라운드 서비스가 아직 실행 중입니다. 종료하면 서비스가 중지됩니다. XBond를 다시 열면 자동으로 시작됩니다.",
    quit_confirm_ok: "종료하고 중지",
    quit_confirm_cancel: "취소",
    notify_stop_failed: "백그라운드 서비스 중지 실패로 종료를 취소했습니다",
};

pub const FA: TrayI18n = TrayI18n {
    connect: "اتصال",
    disconnect: "قطع اتصال",
    connecting: "در حال اتصال…",
    disconnecting: "در حال قطع اتصال…",
    disconnected: "متصل نیست",
    connected: "متصل شد",
    daemon_down: "هسته آفلاین",
    sysproxy: "پروکسی سیستم",
    tun: "حالت TUN",
    tun_short: "TUN",
    tun_needs_admin: "حالت TUN (نیاز به مدیر)",
    tun_needs_root: "حالت TUN (نیاز به root)",
    tun_missing_wintun: "حالت TUN (فایل wintun.dll موجود نیست)",
    port_only: "فقط درگاه محلی",
    port_short: "فقط درگاه",
    routing_menu: "حالت مسیریابی",
    rule: "قاعده",
    global: "سراسری",
    direct: "مستقیم",
    nodes: "گره‌ها",
    autostart: "اجرا هنگام راه‌اندازی",
    copy_env_pwsh: "کپی دستور پروکسی PowerShell",
    copy_env_sh: "کپی دستور پروکسی ترمینال",
    show_window: "باز کردن XBond",
    quit: "خروج از XBond",
    notify_offline_title: "هسته XBond آفلاین است",
    notify_offline_body: "سرویس پس‌زمینه پاسخ نمی‌دهد. برای بازیابی XBond را دوباره باز کنید.",
    notify_copied_env: "متغیرهای محیطی پروکسی در بریده‌دان کپی شد.",
    notify_connect_failed: "اتصال ناموفق بود",
    notify_disconnect_failed: "قطع اتصال ناموفق بود",
    notify_takeover_failed: "تغییر حالت کنترل ناموفق بود",
    notify_routing_failed: "تغییر حالت مسیریابی ناموفق بود",
    notify_node_failed: "تغییر گره ناموفق بود",
    quit_confirm_title: "خروج از XBond",
    quit_confirm_connected: "اتصال همچنان فعال است. با خروج، اتصال قطع می‌شود، پروکسی سیستم بازنشانی و سرویس پس‌زمینه متوقف می‌شود؛ دفعهٔ بعد که XBond را باز کنید دوباره راه‌اندازی می‌شود.",
    quit_confirm_idle: "سرویس پس‌زمینه همچنان فعال است. با خروج متوقف می‌شود؛ دفعهٔ بعد که XBond را باز کنید دوباره راه‌اندازی می‌شود.",
    quit_confirm_ok: "خروج و توقف",
    quit_confirm_cancel: "انصراف",
    notify_stop_failed: "توقف سرویس پس‌زمینه ناموفق بود؛ خروج لغو شد",
};

impl TrayI18n {
    pub fn for_lang(lang: &str) -> &'static Self {
        let l = lang.trim().to_lowercase().replace('-', "_");
        if l.starts_with("zh_cn") || l.starts_with("zh_hans") || l == "zh" {
            &ZH_CN
        } else if l.starts_with("zh") {
            &ZH_HK
        } else if l.starts_with("ko") {
            &KO
        } else if l.starts_with("fa") {
            &FA
        } else {
            &EN_US
        }
    }
}

fn detect_initial_language() -> String {
    for var in &["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(val) = std::env::var(var) {
            let lower = val.to_lowercase();
            if lower.contains("zh_cn") || lower.contains("zh-cn") || lower.contains("zh_hans") {
                return "zh_CN".to_string();
            }
            if lower.contains("zh") {
                return "zh_HK".to_string();
            }
            if lower.contains("ko") {
                return "ko".to_string();
            }
            if lower.contains("fa") {
                return "fa".to_string();
            }
            if lower.contains("en") {
                return "en_US".to_string();
            }
        }
    }
    "zh_HK".to_string()
}

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
    lang: Mutex<String>,
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
        lang: Mutex::new(detect_initial_language()),
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

/// Update active language and refresh tray items immediately.
pub fn update_language(app: &AppHandle, lang: &str) {
    if let Some(shared) = app.try_state::<TrayShared>() {
        *shared.lang.lock().unwrap_or_else(|e| e.into_inner()) = lang.to_string();
        refresh_tray(app);
    }
}

/// Guards the run-loop exit interception: the confirmed stop path flips this
/// before calling app.exit(0) so its own exit request sails through.
static QUIT_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

pub(crate) fn quit_in_progress() -> bool {
    QUIT_IN_PROGRESS.load(Ordering::Relaxed)
}

fn exit_app(app: &AppHandle) {
    QUIT_IN_PROGRESS.store(true, Ordering::Relaxed);
    let _ = app.save_window_state(crate::window_state_flags());
    app.exit(0);
}

/// Quit the GUI. Closing the window only ever hides to the tray, so an
/// explicit quit is where honesty happens (daemon-runtime spec): if the
/// supervised daemon is still serving, ask first — confirming disconnects
/// (the CLI's graceful stop restores the system proxy and stops the engine)
/// and stops the service, then exits. The service is brought back by the
/// next launch's `daemon start`. A stop failure cancels the quit and
/// notifies, so an exit can never strand an invisible proxy.
pub fn quit(app: &AppHandle) {
    let shared = app.state::<TrayShared>();
    let lang = shared
        .lang
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let i18n = TrayI18n::for_lang(&lang);

    if !crate::daemon::daemon_running() {
        exit_app(app);
        return;
    }

    let connected = crate::localapi::fetch_status()
        .map(|status| status.engine.running)
        .unwrap_or(false);
    let body = if connected {
        i18n.quit_confirm_connected
    } else {
        i18n.quit_confirm_idle
    };
    let app = app.clone();
    app.dialog()
        .message(body)
        .title(i18n.quit_confirm_title)
        .buttons(MessageDialogButtons::OkCancelCustom(
            i18n.quit_confirm_ok.into(),
            i18n.quit_confirm_cancel.into(),
        ))
        .show(move |confirmed| {
            if !confirmed {
                return;
            }
            std::thread::spawn(move || match crate::daemon::stop_service() {
                Ok(()) => exit_app(&app),
                Err(err) => {
                    eprintln!("[XBond Desktop] daemon stop during quit failed: {err}");
                    notify(&app, i18n.notify_stop_failed, &err);
                }
            });
        });
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
            crate::commands::show_main_window(app.clone());
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
        sub_name: status
            .active_sub
            .as_ref()
            .map(|s| s.name.clone())
            .unwrap_or_default(),
        node_now: String::new(),
        groups: Vec::new(),
    };
    if let Ok(proxies) = crate::localapi::fetch_proxies() {
        fill_groups(&mut state, proxies);
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

    let shared = app.state::<TrayShared>();
    let lang = shared
        .lang
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let i18n = TrayI18n::for_lang(&lang);

    // Only a daemon loss is worth interrupting the user for: a core going
    // idle can be a peer's own disconnect (CLI, web UI), not an incident.
    let mut prev_alive = shared.prev_alive.lock().unwrap_or_else(|e| e.into_inner());
    if *prev_alive == Some(true) && !state.daemon_ok {
        notify(app, i18n.notify_offline_title, i18n.notify_offline_body);
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
    display_tray(app, &state, i18n, &lang);
}

/// Render icon, tooltip and (when changed) menu from a snapshot plus the
/// live intent, without touching the network.
fn display_tray(app: &AppHandle, state: &TrayState, i18n: &TrayI18n, lang: &str) {
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
        let tip = tooltip(state, connecting, disconnecting, i18n);
        let mut last_tip = shared.tooltip.lock().unwrap_or_else(|e| e.into_inner());
        if *last_tip != tip {
            shared.tray.set_tooltip(Some(tip.clone())).ok();
            *last_tip = tip;
        }
    }

    let fingerprint = menu_fingerprint(state, lang, app);
    let mut last = shared
        .menu_fingerprint
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if *last != fingerprint {
        match build_menu(app, state, i18n) {
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
/// immediately triggers a notification toast.
fn run_action<F>(app: &AppHandle, err_title: &str, action: F)
where
    F: FnOnce() -> Result<(), String> + Send + 'static,
{
    let handle = app.clone();
    let err_title = err_title.to_string();
    std::thread::spawn(move || {
        if let Err(e) = action() {
            eprintln!("[XBond Desktop] Tray action failed: {e}");
            notify(&handle, &err_title, &format!("{e}"));
        }
        refresh_tray(&handle);
    });
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    let shared = app.state::<TrayShared>();
    let lang = shared
        .lang
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let i18n = TrayI18n::for_lang(&lang);

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
            display_tray(app, &state, i18n, &lang);
            run_action(
                app,
                if want_running {
                    i18n.notify_connect_failed
                } else {
                    i18n.notify_disconnect_failed
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
            run_action(app, i18n.notify_takeover_failed, move || {
                crate::localapi::set_mode(&mode, "")
            });
        }
        TRAY_ROUTING_RULE | TRAY_ROUTING_GLOBAL | TRAY_ROUTING_DIRECT => {
            let routing = id.trim_start_matches("tray_routing_").to_string();
            run_action(app, i18n.notify_routing_failed, move || {
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
                Ok(()) => notify(app, "XBond", i18n.notify_copied_env),
                Err(e) => eprintln!("[XBond Desktop] Failed to write clipboard: {e}"),
            }
        }
        TRAY_AUTOSTART => {
            match app.autolaunch().is_enabled() {
                Ok(enabled) => {
                    if let Err(e) = crate::commands::set_autostart(app.clone(), !enabled) {
                        eprintln!("[XBond Desktop] Failed to toggle autostart: {e}");
                    }
                }
                Err(e) => eprintln!("[XBond Desktop] Failed to read autostart: {e}"),
            }
            let shared = app.state::<TrayShared>();
            let state = shared
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            display_tray(app, &state, i18n, &lang);
        }
        TRAY_SHOW => {
            crate::commands::show_main_window(app.clone());
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
    let lang = shared
        .lang
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let i18n = TrayI18n::for_lang(&lang);
    let groups = &shared
        .state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .groups;
    let Some(group) = groups.get(gi) else { return };
    let Some(node) = group.nodes.get(ni) else {
        return;
    };
    let (group, node) = (group.name.clone(), node.clone());
    run_action(app, i18n.notify_node_failed, move || {
        crate::localapi::select_node(&group, &node)
    });
}

fn tooltip(state: &TrayState, connecting: bool, disconnecting: bool, i18n: &TrayI18n) -> String {
    if !state.daemon_ok {
        return format!("XBond — {}", i18n.daemon_down);
    }
    if disconnecting {
        return format!("XBond — {}", i18n.disconnecting);
    }
    if connecting {
        return format!("XBond — {}", i18n.connecting);
    }
    if !state.running {
        return format!("XBond — {}", i18n.disconnected);
    }
    let takeover = match state.takeover.as_str() {
        "sysproxy" => i18n.sysproxy,
        "tun" => i18n.tun_short,
        "port" => i18n.port_short,
        _ => "",
    };
    let routing = match state.routing.as_str() {
        "rule" => i18n.rule,
        "global" => i18n.global,
        "direct" => i18n.direct,
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
        return format!("XBond — {}", i18n.connected);
    }
    format!("XBond — {}", parts.join(" · "))
}

fn menu_fingerprint(state: &TrayState, lang: &str, app: &AppHandle) -> String {
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);
    let groups: Vec<String> = state
        .groups
        .iter()
        .map(|g| format!("{}={}|{}", g.name, g.now, g.nodes.join(",")))
        .collect();
    format!(
        "lang={} ok={} run={} mode={}/{} tun={}/{} auto={} groups={}",
        lang,
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

fn build_menu(
    app: &AppHandle,
    state: &TrayState,
    i18n: &TrayI18n,
) -> Result<Menu<Wry>, tauri::Error> {
    let enabled = state.daemon_ok;
    let connect_label = if state.running {
        i18n.disconnect
    } else {
        i18n.connect
    };
    let toggle = MenuItem::with_id(app, TRAY_TOGGLE_CONN, connect_label, enabled, None::<&str>)?;
    let separator_head = PredefinedMenuItem::separator(app)?;

    let sysproxy = CheckMenuItem::with_id(
        app,
        TRAY_MODE_SYSPROXY,
        i18n.sysproxy,
        enabled,
        state.takeover == "sysproxy",
        None::<&str>,
    )?;
    let tun_label = match state.tun_reason.as_str() {
        "not_elevated" => i18n.tun_needs_admin,
        "not_root" => i18n.tun_needs_root,
        "wintun_missing" => i18n.tun_missing_wintun,
        _ => i18n.tun,
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
        i18n.port_only,
        enabled,
        state.takeover == "port",
        None::<&str>,
    )?;

    let rule = CheckMenuItem::with_id(
        app,
        TRAY_ROUTING_RULE,
        i18n.rule,
        enabled,
        state.routing == "rule",
        None::<&str>,
    )?;
    let global = CheckMenuItem::with_id(
        app,
        TRAY_ROUTING_GLOBAL,
        i18n.global,
        enabled,
        state.routing == "global",
        None::<&str>,
    )?;
    let direct = CheckMenuItem::with_id(
        app,
        TRAY_ROUTING_DIRECT,
        i18n.direct,
        enabled,
        state.routing == "direct",
        None::<&str>,
    )?;
    let routing = Submenu::with_id_and_items(
        app,
        "tray_routing_menu",
        i18n.routing_menu,
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

    let node_menu = node_submenu(app, state, i18n)?;
    let separator_before_nodes = PredefinedMenuItem::separator(app)?;
    if let Some(node_menu) = &node_menu {
        items.push(&separator_before_nodes);
        items.push(node_menu);
    }

    let autostart = CheckMenuItem::with_id(
        app,
        TRAY_AUTOSTART,
        i18n.autostart,
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let copy_env = MenuItem::with_id(
        app,
        TRAY_COPY_ENV,
        if cfg!(windows) {
            i18n.copy_env_pwsh
        } else {
            i18n.copy_env_sh
        },
        enabled && state.mixed_port > 0,
        None::<&str>,
    )?;
    let separator_tail = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, TRAY_SHOW, i18n.show_window, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT, i18n.quit, true, None::<&str>)?;
    let separator_end = PredefinedMenuItem::separator(app)?;

    items.push(&separator_tail);
    items.push(&autostart);
    items.push(&copy_env);
    items.push(&separator_end);
    items.push(&show);
    items.push(&quit);

    Menu::with_items(app, &items)
}

fn node_submenu(
    app: &AppHandle,
    state: &TrayState,
    i18n: &TrayI18n,
) -> Result<Option<Submenu<Wry>>, tauri::Error> {
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
        i18n.nodes,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tray_i18n_selection() {
        assert_eq!(TrayI18n::for_lang("zh_CN").connect, "连接");
        assert_eq!(TrayI18n::for_lang("zh-cn").connect, "连接");
        assert_eq!(TrayI18n::for_lang("zh_HK").connect, "連線");
        assert_eq!(TrayI18n::for_lang("zh-TW").connect, "連線");
        assert_eq!(TrayI18n::for_lang("en_US").connect, "Connect");
        assert_eq!(TrayI18n::for_lang("en").connect, "Connect");
        assert_eq!(TrayI18n::for_lang("ko").connect, "연결");
        assert_eq!(TrayI18n::for_lang("fa").connect, "اتصال");
        assert_eq!(TrayI18n::for_lang("unknown").connect, "Connect");
    }
}
