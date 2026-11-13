use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

// Set by lib.rs when the updater plugin is actually registered. Local
// `package:desktop` bundles ship without updater keys; their UI reports
// installer-managed updates instead.
static PLUGIN_REGISTERED: AtomicBool = AtomicBool::new(false);

pub fn mark_registered() {
    PLUGIN_REGISTERED.store(true, Ordering::Relaxed);
}

const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Default)]
pub struct UpdateState {
    inner: Mutex<UpdateStatus>,
}

#[derive(Default)]
struct UpdateStatus {
    phase: Phase,
    update: Option<Update>,
    reconciling_daemon: bool,
    daemon_error: bool,
    machine_update_error: bool,
}

#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum Phase {
    #[default]
    Idle,
    Checking,
    Current,
    Available,
    Downloading {
        received: u64,
        total: Option<u64>,
    },
    Installing,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    enabled: bool,
    #[serde(flatten)]
    phase: Phase,
    version: Option<String>,
    daemon_error: bool,
    machine_update_error: bool,
    reconciling_daemon: bool,
}

fn enabled() -> bool {
    PLUGIN_REGISTERED.load(Ordering::Relaxed)
        && (!cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some())
}

fn release_asset(update: &Update) -> bool {
    let (os, extension) = match std::env::consts::OS {
        "windows" => ("windows", "exe"),
        "macos" => ("darwin", "app.tar.gz"),
        "linux" => ("linux", "AppImage"),
        _ => return false,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        _ => return false,
    };
    let tag = format!("v{}", update.version);
    update.download_url.as_str()
        == format!(
            "https://github.com/openxbond/xbond/releases/download/{tag}/xbond-desktop-{tag}-{os}-{arch}.{extension}"
        )
}

// Install beacon read from the shared data-dir file the Go daemon writes
// (internal/telemetry). The shell has no Go runtime, so the data-dir
// derivation mirrors paths.go for the three desktop platforms. A missing or
// malformed file (daemon never ran, hand-edited) omits the header instead of
// sending a broken beacon.
fn install_header(app: &AppHandle) -> Option<String> {
    let id = std::fs::read_to_string(install_id_path()?).ok()?;
    let id = id.trim();
    if id.len() != 32
        || !id
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return None;
    }
    // Go names the platform "darwin"; keep the beacon values aligned with it.
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    Some(format!(
        "id={id}; app={}; os={os}; arch={}",
        app.package_info().version,
        std::env::consts::ARCH
    ))
}

fn install_id_path() -> Option<std::path::PathBuf> {
    if let Some(dir) = std::env::var_os("XBOND_DATA_DIR") {
        return Some(std::path::PathBuf::from(dir).join("install-id"));
    }
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var_os("LOCALAPPDATA")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(|home| std::path::PathBuf::from(home).join("AppData").join("Local"))
            })?;
        Some(base.join("xbond").join("install-id"))
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::path::PathBuf::from(std::env::var_os("HOME")?);
        Some(home.join("Library/Application Support/xbond/install-id"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
            return Some(std::path::PathBuf::from(xdg).join("xbond/install-id"));
        }
        let home = std::path::PathBuf::from(std::env::var_os("HOME")?);
        Some(home.join(".local/share/xbond/install-id"))
    }
}

#[tauri::command]
pub fn desktop_update_status(state: State<'_, UpdateState>) -> UpdateSnapshot {
    let status = state.inner.lock().unwrap_or_else(|err| err.into_inner());
    UpdateSnapshot {
        enabled: enabled(),
        phase: status.phase,
        version: status.update.as_ref().map(|update| update.version.clone()),
        daemon_error: status.daemon_error,
        machine_update_error: status.machine_update_error,
        reconciling_daemon: status.reconciling_daemon,
    }
}

async fn check(app: &AppHandle, state: &UpdateState, automatic: bool) -> Result<(), String> {
    if !enabled() {
        return Err("Updates are managed by your installer".into());
    }
    {
        let mut status = state.inner.lock().map_err(|err| err.to_string())?;
        if matches!(
            status.phase,
            Phase::Checking | Phase::Downloading { .. } | Phase::Installing
        ) {
            return Ok(());
        }
        let marker = app
            .path()
            .app_cache_dir()
            .map_err(|err| err.to_string())?
            .join("last-update-check");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|err| err.to_string())?
            .as_secs();
        let last = std::fs::read_to_string(&marker)
            .ok()
            .and_then(|value| value.parse::<u64>().ok());
        if automatic && last.is_some_and(|last| now.saturating_sub(last) < CHECK_INTERVAL.as_secs())
        {
            return Ok(());
        }
        if let Some(parent) = marker.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        std::fs::write(&marker, now.to_string()).map_err(|err| err.to_string())?;
        status.phase = Phase::Checking;
        status.update = None;
    }
    let result = async {
        let mut builder = app.updater_builder().header("Cache-Control", "no-cache")?;
        if let Some(beacon) = install_header(app) {
            builder = builder.header("X-XBond-Install", beacon)?;
        }
        builder
            .timeout(Duration::from_secs(30))
            .build()?
            .check()
            .await
    }
    .await;
    let mut status = state.inner.lock().map_err(|err| err.to_string())?;
    match result {
        Ok(Some(update)) if !release_asset(&update) => {
            status.phase = Phase::Failed;
            Err("Unexpected update download URL".into())
        }
        Ok(update) => {
            status.phase = if update.is_some() {
                Phase::Available
            } else {
                Phase::Current
            };
            status.update = update;
            Ok(())
        }
        Err(error) => {
            status.phase = Phase::Failed;
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub async fn check_desktop_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<(), String> {
    check(&app, &state, false).await
}

#[tauri::command]
pub async fn install_desktop_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
    version: String,
) -> Result<(), String> {
    let mut update = {
        let mut status = state.inner.lock().map_err(|err| err.to_string())?;
        if !enabled()
            || status.reconciling_daemon
            || !matches!(status.phase, Phase::Available)
            || status
                .update
                .as_ref()
                .is_none_or(|update| update.version != version)
        {
            return Err("Check for the selected update again".into());
        }
        status.phase = Phase::Downloading {
            received: 0,
            total: None,
        };
        status.update.take().expect("update was checked")
    };
    update.timeout = Some(Duration::from_secs(20 * 60));
    let mut received = 0;
    let result = update
        .download_and_install(
            |chunk, total| {
                received += chunk as u64;
                if let Ok(mut status) = state.inner.lock() {
                    status.phase = Phase::Downloading { received, total };
                }
            },
            || {
                if let Ok(mut status) = state.inner.lock() {
                    status.phase = Phase::Installing;
                }
            },
        )
        .await;
    if let Err(error) = result {
        let mut status = state.inner.lock().map_err(|err| err.to_string())?;
        status.phase = Phase::Failed;
        return Err(error.to_string());
    }
    app.request_restart();
    Ok(())
}

pub fn on_launch(app: AppHandle) {
    if !crate::daemon::packaged() {
        let _ = crate::daemon::ensure_daemon();
        return;
    }
    if let Ok(mut status) = app.state::<UpdateState>().inner.lock() {
        status.reconciling_daemon = true;
    }
    tauri::async_runtime::spawn(async move {
        let state = app.state::<UpdateState>();
        let reconciliation =
            tauri::async_runtime::spawn_blocking(crate::daemon::reconcile_packaged_daemon).await;
        let (daemon_error, machine_update_error) = match reconciliation {
            Ok(Ok(Some(error))) => {
                eprintln!("[XBond Desktop] Machine daemon update failed: {error}");
                (false, true)
            }
            Ok(Ok(None)) => (false, false),
            error => {
                eprintln!("[XBond Desktop] Packaged daemon reconciliation failed: {error:?}");
                (true, false)
            }
        };
        if let Ok(mut status) = state.inner.lock() {
            status.reconciling_daemon = false;
            status.daemon_error = daemon_error;
            status.machine_update_error = machine_update_error;
        }
        if enabled() {
            if let Err(error) = check(&app, &state, true).await {
                eprintln!("[XBond Desktop] Automatic update check failed: {error}");
            }
        }
    });
}
