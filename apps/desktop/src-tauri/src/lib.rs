mod commands;
mod daemon;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            if let Err(e) = tray::setup_tray(app.handle()) {
                eprintln!("[XBond Desktop] Failed to setup tray: {e}");
            }
            let _ = daemon::ensure_daemon();
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_desktop_info,
            daemon::get_localapi_config,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build XBond desktop app")
        .run(|_app_handle, _event| {});
}
