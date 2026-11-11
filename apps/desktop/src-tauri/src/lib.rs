mod commands;
mod daemon;
mod localapi;
mod tray;
mod updater;

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
            // A second launch carrying a deep link hands it over and comes
            // to front; anything else just focuses the existing window.
            if let Some(url) = commands::extract_import_url(&args) {
                commands::queue_import(app, url);
            } else if let Some(callback) = commands::extract_auth_callback(&args) {
                commands::complete_auth_callback(app, callback);
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(updater::UpdateState::default())
        // Global reveal/hide hotkey is registered in setup via on_shortcut.
        // The plugin dispatches every event to BOTH the builder handler and
        // the shortcut's own handler, so a with_handler here would toggle
        // twice per press: show, then immediately re-show, never hide.
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            app.manage(commands::ShellState::default());
            if daemon::packaged() {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }

            // Frameless main window on Windows/Linux: the webview draws its
            // own titlebar (drag region + window controls); macOS keeps
            // native traffic lights via titleBarStyle Overlay in config.
            // Applied while the window is still hidden (visible:false in
            // config), so no frame flash reaches the screen.
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
            }

            if let Err(e) = tray::setup_tray(app.handle()) {
                eprintln!("[XBond Desktop] Failed to setup tray: {e}");
            }

            // xbond:// / clash:// links arriving while this instance runs.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    let raw = url.as_str();
                    if let Some(import) = commands::import_url_from_deep_link(raw) {
                        commands::queue_import(&handle, import);
                    } else if let Some(callback) = commands::auth_callback_from_deep_link(raw) {
                        commands::complete_auth_callback(&handle, callback);
                    }
                }
            });

            #[cfg(desktop)]
            {
                // Register the schemes for dev runs and currentUser NSIS
                // installs without installer hooks (HKCU on Windows). macOS
                // declares schemes in the bundle Info.plist instead, where
                // runtime registration is unsupported.
                #[cfg(any(target_os = "windows", target_os = "linux"))]
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
            } else if let Some(callback) = commands::extract_auth_callback(&argv) {
                commands::complete_auth_callback(app.handle(), callback);
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

            updater::on_launch(app.handle().clone());

            // An explicit quit stops the supervised daemon, so a fresh
            // launch reconciles the runtime back up — one supervisor verb
            // through the bundled CLI; the GUI itself still never spawns a
            // rival daemon (daemon-runtime spec).
            std::thread::spawn(|| {
                daemon::launch_ensure();
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Closing the window must not take the proxy down (AC-10);
                // tray behavior follows the user's closeToTray preference.
                if window.label() == "main" {
                    let app = window.app_handle();
                    if app.state::<commands::ShellState>().close_to_tray() {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        // Tray disabled: closing the window is an explicit
                        // quit and runs the same ask-first, stop-on-confirm
                        // flow as the tray entry.
                        api.prevent_close();
                        tray::quit(app);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_desktop_info,
            commands::show_main_window,
            commands::close_main_window,
            commands::minimize_main_window,
            commands::toggle_maximize_main_window,
            commands::is_main_window_maximized,
            commands::get_close_to_tray,
            commands::set_close_to_tray,
            commands::get_tray_language,
            commands::set_tray_language,
            commands::take_pending_import,
            commands::read_clipboard_text,
            commands::write_clipboard_text,
            commands::open_external_url,
            commands::get_autostart,
            commands::set_autostart,
            daemon::get_localapi_config,
            updater::desktop_update_status,
            updater::check_desktop_update,
            updater::install_desktop_update,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build XBond desktop app")
        .run(|app, event| {
            // OS-level quit requests (macOS Cmd+Q, session managers) join the
            // same ask-first flow; the exit the confirmed stop triggers is
            // marked so it passes straight through.
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
                if !tray::quit_in_progress() {
                    api.prevent_exit();
                    tray::quit(app);
                }
            }
        });
}
