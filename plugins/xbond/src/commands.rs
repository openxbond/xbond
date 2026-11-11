use serde_json::Value;
use tauri::{AppHandle, Runtime};

use crate::{Result, XbondExt};

#[tauri::command]
pub async fn get_localapi_config<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    app.xbond().get_localapi_config()
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
