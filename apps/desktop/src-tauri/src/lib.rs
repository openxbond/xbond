mod commands;
mod daemon;
mod localapi;
mod tray;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt as _, ShortcutState};
use tauri_plugin_window_state::StateFlags;

/// What the shell persists and restores for the main window. VISIBLE is
/// deliberately excluded: the webview shows the window itself after first
/// render (anti-flash), so a restored visibility flag must never beat it.
pub(crate) fn window_state_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second launch carrying an import link hands it over and comes
            // to front; anything else just focuses the existing window.
            if let Some(url) = commands::extract_import_url(&args) {
                commands::queue_import(app, url);
            } else {
                commands::show_main_window(app.clone());
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Global reveal/hide hotkey: works while the window is
                    // hidden and the webview idle.
                    if event.state() == ShortcutState::Pressed {
                        tray::toggle_main_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            app.manage(commands::ShellState::default());

            if let Err(e) = tray::setup_tray(app.handle()) {
                eprintln!("[XBond Desktop] Failed to setup tray: {e}");
            }

            // xbond:// / clash:// links arriving while this instance runs.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(import) = commands::import_url_from_deep_link(url.as_str()) {
                        commands::queue_import(&handle, import);
                    }
                }
            });

            #[cfg(desktop)]
            {
                // Register the schemes for dev runs and currentUser NSIS
                // installs without installer hooks (HKCU on Windows).
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("[XBond Desktop] Failed to register deep-link schemes: {e}");
                }
                if let Err(e) = app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+X", |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        tray::toggle_main_window(app);
                    }
                }) {
                    eprintln!("[XBond Desktop] Failed to register global shortcut: {e}");
                }
            }

            // Cold start: the OS passes the deep link as argv.
            let argv: Vec<String> = std::env::args().skip(1).collect();
            if let Some(url) = commands::extract_import_url(&argv) {
                commands::queue_import(app.handle(), url);
            }

            // Anti-flash fallback: normally the webview shows the window
            // after first render; if the frontend never comes up (dev server
            // down, broken bundle), fail visible instead of invisible.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(5));
                if !commands::main_window_shown() {
                    eprintln!("[XBond Desktop] Webview did not report ready in 5s; forcing window visible");
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });

            let _ = daemon::ensure_daemon();
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Closing the window must not take the proxy down (AC-10);
                // tray behavior follows the user's closeToTray preference.
                if window.label() == "main" && window.app_handle().state::<commands::ShellState>().close_to_tray() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_desktop_info,
            commands::show_main_window,
            commands::get_close_to_tray,
            commands::set_close_to_tray,
            commands::take_pending_import,
            commands::read_clipboard_text,
            commands::write_clipboard_text,
            commands::get_autostart,
            commands::set_autostart,
            daemon::get_localapi_config,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build XBond desktop app")
        .run(|_app_handle, _event| {});
}
