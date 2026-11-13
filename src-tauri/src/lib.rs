#[cfg(feature = "desktop")]
mod commands;
#[cfg(feature = "desktop")]
mod daemon;
#[cfg(feature = "desktop")]
mod desktop_preferences;
#[cfg(feature = "desktop")]
mod localapi;
#[cfg(feature = "desktop")]
mod tray;
#[cfg(feature = "desktop")]
mod updater;

#[cfg(feature = "desktop")]
use tauri::Manager;
#[cfg(feature = "desktop")]
use tauri_plugin_autostart::MacosLauncher;
#[cfg(feature = "desktop")]
use tauri_plugin_deep_link::DeepLinkExt as _;
#[cfg(feature = "desktop")]
use tauri_plugin_global_shortcut::{GlobalShortcutExt as _, ShortcutState};
#[cfg(feature = "desktop")]
use tauri_plugin_window_state::StateFlags;

#[cfg(feature = "desktop")]
/// What the shell persists and restores for the main window. VISIBLE is
/// deliberately excluded: the webview shows the window itself after first
/// render (anti-flash), so a restored visibility flag must never beat it.
pub(crate) fn window_state_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

// Windows 10 is the documented minimum (see PRODUCT.md). The NSIS installer
// blocks older systems before copying files; this guard covers executables
// run directly, e.g. copied out of a bundle instead of installed.
#[cfg(target_os = "windows")]
fn ensure_supported_windows() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONSTOP, MB_OK};
    if windows_version::OsVersion::current() < windows_version::OsVersion::new(10, 0, 0, 0) {
        let text: Vec<u16> = "XBond 需要 Windows 10 或更高版本。"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let caption: Vec<u16> = "XBond".encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                caption.as_ptr(),
                MB_ICONSTOP | MB_OK,
            );
        }
        std::process::exit(1);
    }
}

#[cfg(feature = "desktop")]
pub fn run() {
    #[cfg(target_os = "windows")]
    ensure_supported_windows();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second launch carrying a deep link hands it over and comes
            // to front; anything else just focuses the existing window.
            if let Some(url) = commands::extract_import_url(&args) {
                commands::queue_import(app, url);
            } else if let Some(callback) = commands::extract_auth_callback(&args) {
                commands::complete_auth_callback(app, callback);
            } else if !args.iter().any(|arg| arg == commands::AUTOSTART_ARG) {
                commands::show_main_window(app.clone());
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![commands::AUTOSTART_ARG]),
        ))
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
            // The updater plugin panics without a plugins.updater config, so
            // register it only when the build actually carries updater keys
            // (release bundles overlay them via their signing config).
            if daemon::packaged() && app.config().plugins.0.get("updater").is_some() {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                updater::mark_registered();
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

            let tray_available = tray::setup_tray(app.handle())
                .map_err(|err| {
                    eprintln!("[XBond Desktop] Failed to setup tray: {err}");
                })
                .is_ok();
            let argv: Vec<String> = std::env::args().skip(1).collect();
            let preferences =
                desktop_preferences::DesktopPreferences::load().unwrap_or_else(|err| {
                    eprintln!("[XBond Desktop] Failed to read desktop preferences: {err}");
                    Default::default()
                });
            app.manage(commands::ShellState::new(
                preferences,
                tray_available,
                argv.iter().any(|arg| arg == commands::AUTOSTART_ARG),
            ));
            // Splash covers process boot while the hidden main webview
            // resolves the daemon; silent starts must stay fully in the
            // background, so they never surface it (startup_complete or the
            // watchdog below still closes the hidden window either way).
            if !app.state::<commands::ShellState>().start_hidden() {
                if let Some(splash) = app.get_webview_window("splashscreen") {
                    let _ = splash.show();
                }
            }
            if let Err(err) = commands::initialize_autostart(app.handle()) {
                eprintln!("[XBond Desktop] Failed to initialize autostart: {err}");
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

            // Register the schemes for dev runs and currentUser NSIS
            // installs without installer hooks (HKCU on Windows). macOS
            // declares schemes in the bundle Info.plist instead, where
            // runtime registration is unsupported.
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            if let Err(e) = app.deep_link().register_all() {
                eprintln!("[XBond Desktop] Failed to register deep-link schemes: {e}");
            }
            if let Err(e) =
                app.global_shortcut()
                    .on_shortcut("CmdOrCtrl+Shift+X", |app, _shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            tray::toggle_main_window(app);
                        }
                    })
            {
                eprintln!("[XBond Desktop] Failed to register global shortcut: {e}");
            }

            // Cold start: the OS passes the deep link as argv.
            if let Some(url) = commands::extract_import_url(&argv) {
                commands::queue_import(app.handle(), url);
            } else if let Some(callback) = commands::extract_auth_callback(&argv) {
                commands::complete_auth_callback(app.handle(), callback);
            }

            // Complete startup even if the webview never reports settled.
            // Both paths use the same visibility decision; the budget leaves
            // room for the frontend's own 8s hand-off cap plus webview mount
            // time, so the splash never sticks around.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(10));
                commands::startup_complete(handle);
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
                    if app.state::<commands::ShellState>().can_close_to_tray() {
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
            commands::startup_complete,
            commands::close_main_window,
            commands::minimize_main_window,
            commands::toggle_maximize_main_window,
            commands::is_main_window_maximized,
            commands::get_close_to_tray,
            commands::set_close_to_tray,
            commands::get_silent_start,
            commands::set_silent_start,
            commands::set_tray_language,
            commands::take_pending_import,
            commands::read_clipboard_text,
            commands::open_external_url,
            commands::save_text_file,
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
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                commands::show_main_window(app.clone());
            }
            // OS-level quit requests (macOS Cmd+Q, session managers) join the
            // same ask-first flow; the exit the confirmed stop triggers is
            // marked so it passes straight through.
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                if !tray::quit_in_progress() {
                    api.prevent_exit();
                    tray::quit(app);
                }
            }
        });
}

/// Mobile entry point. The generated native shell (gen/android activity,
/// gen/apple app) hosts the webview, which loads the bundled frontendDist
/// assets; every native capability goes through the `xbond` plugin, and
/// LocalAPI credentials arrive via the plugin's `get_localapi_config`.
///
/// The main window is built explicitly: with `app.windows` empty the
/// runtime creates no webview for the launched activity and the app renders
/// a blank shell.
#[cfg(all(mobile, not(feature = "desktop")))]
#[tauri::mobile_entry_point]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_xbond::init())
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default()).build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to build XBond app");
}

// Desktop builds are only valid with the `desktop` feature (tray, window
// state, single instance, autostart, global shortcut, updater). Without it
// the shell would silently lose its window surface, so fail loudly instead.
#[cfg(all(desktop, not(feature = "desktop")))]
compile_error!("XBond desktop builds require `cargo ... --features desktop`");
