use serde_json::Value;
use tauri::{AppHandle, Runtime};

use crate::{Result, XbondExt};

#[tauri::command]
pub async fn get_localapi_config<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    app.xbond().get_localapi_config()
}

#[tauri::command]
pub async fn startup_complete<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.xbond().startup_complete()
}

#[tauri::command]
pub async fn request_vpn_consent<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    app.xbond().request_vpn_consent()
}

#[tauri::command]
pub async fn list_installed_apps<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    app.xbond().list_installed_apps()
}

#[tauri::command]
pub async fn get_split_tunnel_config<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    app.xbond().get_split_tunnel_config()
}

#[tauri::command]
pub async fn set_split_tunnel_config<R: Runtime>(app: AppHandle<R>, json: String) -> Result<bool> {
    app.xbond().set_split_tunnel_config(&json)
}

#[tauri::command]
pub async fn check_for_updates<R: Runtime>(app: AppHandle<R>, manual: bool) -> Result<()> {
    app.xbond().check_for_updates(manual)
}

#[tauri::command]
pub async fn get_preference<R: Runtime>(app: AppHandle<R>, key: String) -> Result<Option<String>> {
    app.xbond().get_preference(&key)
}

#[tauri::command]
pub async fn set_preference<R: Runtime>(
    app: AppHandle<R>,
    key: String,
    value: String,
) -> Result<bool> {
    app.xbond().set_preference(&key, &value)
}

#[tauri::command]
pub async fn sync_system_bars<R: Runtime>(
    app: AppHandle<R>,
    is_dark: bool,
    color: Option<String>,
) -> Result<()> {
    app.xbond().sync_system_bars(is_dark, color.as_deref())
}

#[tauri::command]
pub async fn deliver_account_callback<R: Runtime>(
    app: AppHandle<R>,
    code: String,
    state: String,
) -> Result<bool> {
    app.xbond().deliver_account_callback(&code, &state)
}

#[tauri::command]
pub async fn save_text_file<R: Runtime>(
    app: AppHandle<R>,
    contents: String,
    file_name: String,
    mime_type: String,
) -> Result<bool> {
    app.xbond()
        .save_text_file(&contents, &file_name, &mime_type)
}

#[tauri::command]
pub async fn share_text_file<R: Runtime>(
    app: AppHandle<R>,
    contents: String,
    file_name: String,
    mime_type: String,
) -> Result<bool> {
    app.xbond()
        .share_text_file(&contents, &file_name, &mime_type)
}

#[tauri::command]
pub async fn perform_haptic<R: Runtime>(app: AppHandle<R>, kind: String) -> Result<()> {
    app.xbond().perform_haptic(&kind)
}

#[tauri::command]
pub async fn get_notification_permission_state<R: Runtime>(app: AppHandle<R>) -> Result<String> {
    app.xbond().get_notification_permission_state()
}

#[tauri::command]
pub async fn request_notification_permission<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    app.xbond().request_notification_permission()
}

#[tauri::command]
pub async fn open_notification_settings<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    app.xbond().open_notification_settings()
}
