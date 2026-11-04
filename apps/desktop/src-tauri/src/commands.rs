use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_clipboard_manager::ClipboardExt as _;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesktopInfo {
    pub platform: String,
    pub arch: String,
    pub version: String,
    pub is_desktop: bool,
}

#[tauri::command]
pub fn get_desktop_info() -> DesktopInfo {
    DesktopInfo {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        is_desktop: true,
    }
}

/// Whether the frontend has rendered and shown the main window at least
/// once; the shell's anti-flash fallback timer reads this (see `run`).
static MAIN_WINDOW_SHOWN: AtomicBool = AtomicBool::new(false);

pub(crate) fn main_window_shown() -> bool {
    MAIN_WINDOW_SHOWN.load(Ordering::Relaxed)
}

pub(crate) fn mark_main_window_shown() {
    MAIN_WINDOW_SHOWN.store(true, Ordering::Relaxed);
}

/// Shell-side preferences the webview pushes down; the webview's localStorage
/// stays the user-facing source, this mirrors what the native close handler
/// must obey while the window is hidden.
#[derive(Default)]
pub struct ShellState {
    close_to_tray: Mutex<bool>,
    pending_import: Mutex<Option<String>>,
}

impl ShellState {
    pub fn close_to_tray(&self) -> bool {
        *self.close_to_tray.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[tauri::command]
pub fn get_close_to_tray(state: State<'_, ShellState>) -> bool {
    state.close_to_tray()
}

#[tauri::command]
pub fn set_close_to_tray(state: State<'_, ShellState>, value: bool) {
    *state
        .close_to_tray
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = value;
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    mark_main_window_shown();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
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

#[tauri::command]
pub fn write_clipboard_text(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enable: bool) -> Result<bool, String> {
    let launch = app.autolaunch();
    let result = if enable {
        launch.enable()
    } else {
        launch.disable()
    };
    result.map_err(|e| e.to_string())?;
    Ok(launch.is_enabled().unwrap_or(enable))
}

#[tauri::command]
pub fn install_system_service() -> Result<(), String> {
    crate::localapi::install_service()
}

/// Extract the subscription URL from a `xbond://` / `clash://` handover URL:
/// `xbond://install-config?url=<percent-encoded https URL>`. Only http(s)
/// payload URLs are accepted — a deep link must never point the import form
/// at file:// or arbitrary schemes.
pub(crate) fn import_url_from_deep_link(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    if !(lower.starts_with("xbond://") || lower.starts_with("clash://")) {
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
    fn test_get_desktop_info() {
        let info = get_desktop_info();
        assert!(info.is_desktop);
        assert!(!info.platform.is_empty());
        assert!(!info.arch.is_empty());
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
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
    fn test_percent_decode() {
        assert_eq!(percent_decode("a%20b+c"), "a b c");
        assert_eq!(percent_decode("%2Fpath"), "/path");
        // Invalid escapes pass through instead of panicking.
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%ZZ"), "%ZZ");
    }
}
