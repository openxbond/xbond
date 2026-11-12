use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_clipboard_manager::ClipboardExt as _;
use tauri_plugin_dialog::DialogExt as _;
use tauri_plugin_opener::OpenerExt as _;

use crate::desktop_preferences::DesktopPreferences;

pub(crate) const AUTOSTART_ARG: &str = "--autostart";

pub struct ShellState {
    preferences: Mutex<DesktopPreferences>,
    tray_available: bool,
    start_hidden: bool,
    startup_handled: AtomicBool,
    pending_import: Mutex<Option<String>>,
}

impl ShellState {
    pub(crate) fn new(
        preferences: DesktopPreferences,
        tray_available: bool,
        autostart: bool,
    ) -> Self {
        Self {
            preferences: Mutex::new(preferences),
            tray_available,
            start_hidden: autostart && preferences.silent_start && tray_available,
            startup_handled: AtomicBool::new(false),
            pending_import: Mutex::new(None),
        }
    }

    fn preferences(&self) -> std::sync::MutexGuard<'_, DesktopPreferences> {
        self.preferences.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn update_preferences(
        &self,
        update: impl FnOnce(&mut DesktopPreferences),
    ) -> Result<(), String> {
        let mut preferences = self.preferences();
        let mut next = *preferences;
        update(&mut next);
        next.save()?;
        *preferences = next;
        Ok(())
    }

    pub fn close_to_tray(&self) -> bool {
        self.preferences().close_to_tray
    }

    pub fn can_close_to_tray(&self) -> bool {
        self.tray_available && self.close_to_tray()
    }

    fn should_reveal_at_startup(&self) -> bool {
        !self.startup_handled.swap(true, Ordering::Relaxed) && !self.start_hidden
    }
}

#[tauri::command]
pub fn get_close_to_tray(state: State<'_, ShellState>) -> bool {
    state.close_to_tray()
}

#[tauri::command]
pub fn set_close_to_tray(state: State<'_, ShellState>, value: bool) -> Result<(), String> {
    state.update_preferences(|preferences| preferences.close_to_tray = value)
}

#[tauri::command]
pub fn get_silent_start(state: State<'_, ShellState>) -> bool {
    state.preferences().silent_start
}

#[tauri::command]
pub fn set_silent_start(state: State<'_, ShellState>, value: bool) -> Result<(), String> {
    state.update_preferences(|preferences| preferences.silent_start = value)
}

#[tauri::command]
pub fn set_tray_language(app: AppHandle, lang: String) {
    crate::tray::update_language(&app, &lang);
}

#[tauri::command]
pub fn main_window_ready(app: AppHandle) {
    if app.state::<ShellState>().should_reveal_at_startup() {
        show_main_window(app);
    }
}

pub fn show_main_window(app: AppHandle) {
    app.state::<ShellState>()
        .startup_handled
        .store(true, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn close_main_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
}

/// Titlebar window controls for the frameless chrome on Windows/Linux
/// (app-defined commands keep the capability set to drag-only). Close stays
/// on `close_main_window`, which honors the close-to-tray preference.
#[tauri::command]
pub fn minimize_main_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
}

#[tauri::command]
pub fn toggle_maximize_main_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = if window.is_maximized().unwrap_or(false) {
            window.unmaximize()
        } else {
            window.maximize()
        };
    }
}

/// Maximized flag for the titlebar's maximize/restore glyph; the webview
/// queries this on mount and webview resize events (no window-event ACL).
#[tauri::command]
pub fn is_main_window_maximized(app: AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_maximized().ok())
        .unwrap_or(false)
}

/// Store an import URL handed over from a deep link or a second instance and
/// bring the window forward so the frontend picks it up.
pub(crate) fn queue_import(app: &AppHandle, url: String) {
    {
        let state = app.state::<ShellState>();
        *state
            .pending_import
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(url);
    }
    show_main_window(app.clone());
}

/// Take semantics: each pending import is consumed exactly once by whichever
/// frontend poll arrives first.
#[tauri::command]
pub fn take_pending_import(state: State<'_, ShellState>) -> Option<String> {
    state
        .pending_import
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
}

#[tauri::command]
pub fn read_clipboard_text(app: AppHandle) -> Option<String> {
    app.clipboard().read_text().ok()
}

/// Opens a link in the user's default browser. The webview has no
/// `target="_blank"` handling, so external links (Cloud console, OAuth page)
/// go through this command; only http(s) is accepted — never arbitrary
/// schemes.
#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("https://") && !lower.starts_with("http://") {
        return Err("only http(s) URLs can be opened".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Save text content through the native save dialog. The webview cannot
/// trigger `<a download>` blob navigation (WebKitGTK and WKWebView have no
/// download handling wired), so file exports (bug report, log dump) go
/// through this command; it writes only to the path the user confirms in
/// the dialog. Returns `false` when the user cancels.
#[tauri::command]
pub async fn save_text_file(
    app: AppHandle,
    contents: String,
    file_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<bool, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let mut dialog = app.dialog().file().set_file_name(file_name);
    if !exts.is_empty() {
        dialog = dialog.add_filter(filter_name, &exts);
    }
    let (tx, rx) = std::sync::mpsc::channel::<Option<Result<std::path::PathBuf, String>>>();
    dialog.save_file(move |path| {
        let _ = tx.send(path.map(|p| p.into_path().map_err(|e| e.to_string())));
    });
    // The callback fires on a helper thread after the user picks a path,
    // which can take minutes — never block the main or executor thread.
    tauri::async_runtime::spawn_blocking(move || match rx.recv() {
        Ok(Some(Ok(path))) => std::fs::write(&path, contents)
            .map(|()| true)
            .map_err(|e| format!("failed to write {}: {e}", path.display())),
        Ok(Some(Err(e))) => Err(e),
        Ok(None) => Ok(false),
        Err(e) => Err(format!("save dialog channel closed: {e}")),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

pub(crate) fn initialize_autostart(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ShellState>();
    if !state.preferences().autostart_initialized {
        app.autolaunch().enable().map_err(|err| err.to_string())?;
        state.update_preferences(|preferences| preferences.autostart_initialized = true)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enable: bool) -> Result<bool, String> {
    let state = app.state::<ShellState>();
    if !state.preferences().autostart_initialized {
        state.update_preferences(|preferences| preferences.autostart_initialized = true)?;
    }
    let launch = app.autolaunch();
    let result = if enable {
        launch.enable()
    } else {
        launch.disable()
    };
    result.map_err(|e| e.to_string())?;
    Ok(launch.is_enabled().unwrap_or(enable))
}

/// Extract the subscription URL from a handover URL:
/// `xbond://install-config?url=<percent-encoded https URL>`, plus the
/// `clash://install-config` and `sing-box://import-remote-profile`
/// compatibility schemes other clients publish. Only http(s) payload URLs
/// are accepted — a deep link must never point the import form at file://
/// or arbitrary schemes.
pub(crate) fn import_url_from_deep_link(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    if !(lower.starts_with("xbond://")
        || lower.starts_with("clash://")
        || lower.starts_with("sing-box://"))
    {
        return None;
    }
    let query = raw.split_once('?')?.1.split('#').next()?; // drop fragment
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        if key.eq_ignore_ascii_case("url") {
            let decoded = percent_decode(value);
            let lower = decoded.to_ascii_lowercase();
            if lower.starts_with("https://") || lower.starts_with("http://") {
                return Some(decoded);
            }
            return None;
        }
    }
    None
}

/// OAuth callback handover: `xbond://callback?code=...&state=...`. The
/// daemon is the only token holder, so the shell forwards the code to the
/// LocalAPI account callback endpoint instead of touching OAuth itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AuthCallback {
    pub code: String,
    pub state: String,
}

/// Strict route match: `xbond://callback` (query optional) and nothing else —
/// `xbond://callback/extra` must not masquerade as the auth landing.
pub(crate) fn auth_callback_from_deep_link(raw: &str) -> Option<AuthCallback> {
    let rest = raw.strip_prefix("xbond://callback")?;
    if !rest.is_empty() && !rest.starts_with('?') {
        return None;
    }
    let query = raw.split_once('?')?.1.split('#').next()?;
    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        let decoded = percent_decode(value);
        if decoded.is_empty() {
            continue;
        }
        if key.eq_ignore_ascii_case("code") {
            code = Some(decoded);
        } else if key.eq_ignore_ascii_case("state") {
            state = Some(decoded);
        }
    }
    Some(AuthCallback {
        code: code?,
        state: state?,
    })
}

/// Same contract for second-instance argv / cold-start command lines.
pub(crate) fn extract_auth_callback(args: &[String]) -> Option<AuthCallback> {
    args.iter()
        .find_map(|arg| auth_callback_from_deep_link(arg))
}

/// Forward the browser's authorization code to the daemon and bring the
/// window forward. The daemon may still be booting when a cold-start link
/// arrives, so delivery retries briefly before giving up.
pub(crate) fn complete_auth_callback(app: &AppHandle, callback: AuthCallback) {
    show_main_window(app.clone());
    std::thread::spawn(move || {
        for attempt in 0..8u32 {
            match crate::localapi::post_account_callback(&callback.code, &callback.state) {
                Ok(()) => return,
                Err(e) => {
                    if attempt == 7 {
                        eprintln!("[XBond Desktop] Account callback delivery failed: {e}");
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

/// Same contract for second-instance argv / cold-start command lines: find
/// the first argument that is a deep link.
pub(crate) fn extract_import_url(args: &[String]) -> Option<String> {
    args.iter().find_map(|arg| import_url_from_deep_link(arg))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = match std::str::from_utf8(&bytes[i + 1..i + 3]) {
                    Ok(hex) => hex,
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                        continue;
                    }
                };
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            // Query values may use + for space.
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_reveal_respects_launch_reason_preference_and_tray() {
        for (autostart, silent_start, tray_available, reveal) in [
            (false, true, true, true),
            (true, true, true, false),
            (true, false, true, true),
            (true, true, false, true),
        ] {
            let state = ShellState::new(
                DesktopPreferences {
                    silent_start,
                    ..Default::default()
                },
                tray_available,
                autostart,
            );
            assert_eq!(state.should_reveal_at_startup(), reveal);
            assert!(!state.should_reveal_at_startup());
            assert_eq!(state.can_close_to_tray(), tray_available);
        }
    }

    #[test]
    fn test_import_url_from_deep_link() {
        assert_eq!(
            import_url_from_deep_link("xbond://install-config?url=https%3A%2F%2Fexample.com%2Fsub"),
            Some("https://example.com/sub".to_string())
        );
        // clash compatibility scheme, unencoded URL
        assert_eq!(
            import_url_from_deep_link(
                "clash://install-config?url=https://example.com/sub?token=abc"
            ),
            Some("https://example.com/sub?token=abc".to_string())
        );
        // encoded query params survive
        assert_eq!(
            import_url_from_deep_link(
                "xbond://install-config?url=https%3A%2F%2Fexample.com%2Fsub%3Fa%3D1%26b%3D2"
            ),
            Some("https://example.com/sub?a=1&b=2".to_string())
        );
        // sing-box compatibility scheme; extra params (name) are ignored
        assert_eq!(
            import_url_from_deep_link(
                "sing-box://import-remote-profile?url=https%3A%2F%2Fexample.com%2Fsub&name=node"
            ),
            Some("https://example.com/sub".to_string())
        );
    }

    #[test]
    fn test_import_url_rejects_non_http_payloads() {
        assert_eq!(
            import_url_from_deep_link("xbond://install-config?url=file:///etc/passwd"),
            None
        );
        assert_eq!(
            import_url_from_deep_link("xbond://install-config?url=javascript:alert(1)"),
            None
        );
        assert_eq!(
            import_url_from_deep_link("sing-box://import-remote-profile?url=file:///etc/passwd"),
            None
        );
        assert_eq!(import_url_from_deep_link("xbond://install-config"), None);
        assert_eq!(import_url_from_deep_link("https://example.com/sub"), None);
    }

    #[test]
    fn test_extract_import_url_from_argv() {
        let args = vec![
            "--flag".to_string(),
            "xbond://install-config?url=https%3A%2F%2Fexample.com%2Fs".to_string(),
        ];
        assert_eq!(
            extract_import_url(&args),
            Some("https://example.com/s".to_string())
        );
        assert_eq!(extract_import_url(&["--flag".to_string()]), None);
    }

    #[test]
    fn test_auth_callback_from_deep_link() {
        let callback = auth_callback_from_deep_link("xbond://callback?code=abc123&state=st-456")
            .expect("valid callback link");
        assert_eq!(
            callback,
            AuthCallback {
                code: "abc123".into(),
                state: "st-456".into(),
            }
        );
        // Percent-encoded values decode; order does not matter.
        assert_eq!(
            auth_callback_from_deep_link("xbond://callback?state=s%20t&code=a%2Bb"),
            Some(AuthCallback {
                code: "a+b".into(),
                state: "s t".into(),
            })
        );
    }

    #[test]
    fn test_auth_callback_rejects_foreign_routes_and_missing_fields() {
        // A different deep-link route must not be mistaken for the callback.
        assert_eq!(
            auth_callback_from_deep_link("xbond://callback/extra?code=a&state=b"),
            None
        );
        assert_eq!(
            auth_callback_from_deep_link("clash://callback?code=a&state=b"),
            None
        );
        // code/state are both required and must be non-empty.
        assert_eq!(
            auth_callback_from_deep_link("xbond://callback?code=a"),
            None
        );
        assert_eq!(
            auth_callback_from_deep_link("xbond://callback?code=&state=b"),
            None
        );
        // Import links stay on their own route.
        assert_eq!(
            auth_callback_from_deep_link(
                "xbond://install-config?url=https%3A%2F%2Fexample.com%2Fs"
            ),
            None
        );
    }

    #[test]
    fn test_percent_decode() {
        assert_eq!(percent_decode("a%20b+c"), "a b c");
        assert_eq!(percent_decode("%2Fpath"), "/path");
        // Invalid escapes pass through instead of panicking.
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%ZZ"), "%ZZ");
    }
}
