use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalAPIConfig {
    pub addr: String,
    pub token: String,
    pub is_running: bool,
}

pub fn get_data_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("XBOND_DATA_DIR") {
        if !custom.trim().is_empty() {
            return PathBuf::from(custom);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(local_app_data).join("xbond");
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            return PathBuf::from(user_profile)
                .join("AppData")
                .join("Local")
                .join("xbond");
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("xbond");
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            return PathBuf::from(xdg).join("xbond");
        }
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("xbond");
        }
    }

    PathBuf::from(".xbond")
}

pub fn read_credentials() -> Option<(String, String)> {
    let data_dir = get_data_dir();
    let addr_path = data_dir.join("localapi.addr");
    let token_path = data_dir.join("localapi.token");

    if addr_path.exists() && token_path.exists() {
        let addr = std::fs::read_to_string(addr_path).ok()?.trim().to_string();
        let token = std::fs::read_to_string(token_path).ok()?.trim().to_string();
        if !addr.is_empty() && !token.is_empty() {
            return Some((addr, token));
        }
    }
    None
}

/// TCP-connect probe: the LocalAPI port listening is the cheapest honest
/// signal that the daemon process is alive — credential files can outlive a
/// crashed daemon and must not short-circuit startup.
fn daemon_alive(addr: &str) -> bool {
    use std::net::TcpStream;
    match addr.parse::<std::net::SocketAddr>() {
        Ok(sock) => TcpStream::connect_timeout(&sock, Duration::from_millis(800)).is_ok(),
        Err(_) => false,
    }
}

/// Serializes daemon (re)starts: the setup hook and the frontend self-heal
/// both funnel into ensure_daemon, and overlapping calls must not spawn rival
/// daemons that fight over the state lock — the loser exits with "another
/// xbond daemon instance owns this state directory", which is how even a
/// healthy launch can print a lock error.
static ENSURE_LOCK: Mutex<()> = Mutex::new(());

/// Unix-millis timestamp of the last ensure that ended without a usable
/// daemon. The frontend self-heal re-invokes ensure_daemon every ~10s while
/// the status poll fails, so without a cooldown a live daemon holding the
/// state lock (hung, or mid-shutdown) turns every retry into a doomed spawn
/// whose stderr spams the console with the lock error. Adoption through the
/// creds probe is never cooldown-gated — only spawning is.
static LAST_FAILED_SPAWN: AtomicU64 = AtomicU64::new(0);
const SPAWN_COOLDOWN_MS: u64 = 30_000;

pub fn packaged() -> bool {
    option_env!("XBOND_DESKTOP_RELEASE") == Some("1")
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledDaemonUpdate {
    machine_update_error: Option<String>,
}

pub fn reconcile_packaged_daemon() -> Result<Option<String>, String> {
    let current = std::env::current_exe().map_err(|err| err.to_string())?;
    let executable = current.with_file_name(if cfg!(windows) {
        "xbond-daemon.exe"
    } else {
        "xbond-daemon"
    });
    let mut command = std::process::Command::new(executable);
    command.args(["daemon", "apply-bundled-update"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let output = command.output().map_err(|err| err.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    let update: BundledDaemonUpdate =
        serde_json::from_slice(&output.stdout).map_err(|err| err.to_string())?;
    Ok(update.machine_update_error)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn spawn_on_cooldown() -> bool {
    let last = LAST_FAILED_SPAWN.load(Ordering::Relaxed);
    last != 0 && now_millis().saturating_sub(last) < SPAWN_COOLDOWN_MS
}

fn record_failed_spawn() {
    LAST_FAILED_SPAWN.store(now_millis(), Ordering::Relaxed);
}

/// The honest tail of ensure_daemon: the daemon writes its credential files
/// only after the LocalAPI listener is bound (server.go binds before writing
/// localapi.addr), so a connectable addr is the real "running" signal —
/// stale files left by a dead daemon always fail the probe and must not be
/// reported as running.
fn resolve_config() -> LocalAPIConfig {
    match read_credentials() {
        Some((addr, token)) if daemon_alive(&addr) => LocalAPIConfig {
            addr,
            token,
            is_running: true,
        },
        _ => LocalAPIConfig {
            addr: "127.0.0.1:5001".to_string(),
            token: String::new(),
            is_running: false,
        },
    }
}

/// Waits up to 3 seconds for the daemon to publish credentials after a
/// lifecycle command claims it started.
fn wait_for_daemon() -> Option<LocalAPIConfig> {
    for _ in 0..15 {
        std::thread::sleep(Duration::from_millis(200));
        if let Some((addr, token)) = read_credentials() {
            if daemon_alive(&addr) {
                return Some(LocalAPIConfig {
                    addr,
                    token,
                    is_running: true,
                });
            }
        }
    }
    None
}

/// True when the supervised daemon is currently serving: credential files
/// exist and the loopback port answers. Stale files from a dead daemon do
/// not count.
pub(crate) fn daemon_running() -> bool {
    read_credentials()
        .map(|(addr, _)| daemon_alive(&addr))
        .unwrap_or(false)
}

fn sidecar_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_owned()
    }
}

/// Ordered CLI candidates for supervisor verbs. Packaged builds reach for the
/// sidecar beside the app; dev runs prefer the binary in dist/cli that
/// `pnpm cli:build` emits.
pub(crate) fn cli_candidates() -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    if packaged() {
        if let Ok(current) = std::env::current_exe() {
            if let Some(parent) = current.parent() {
                paths.push(parent.join(sidecar_name("xbond-daemon")));
                paths.push(parent.join(sidecar_name("xbond")));
            }
        }
    } else {
        paths.push(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../dist/cli")
                .join(sidecar_name("xbond")),
        );
        if let Ok(current) = std::env::current_exe() {
            if let Some(parent) = current.parent() {
                paths.push(parent.join(sidecar_name("xbond-daemon")));
                paths.push(parent.join(sidecar_name("xbond")));
            }
        }
    }
    paths
}

/// Runs one `xbond daemon <verb>` through the bundled CLI. Lifecycle always
/// goes through the supervisor this way — the shell never spawns or stops
/// the daemon itself — and the CLI reports bounded, honest results; failures
/// carry its stderr so callers can surface a real reason.
pub(crate) fn cli_verb(verb: &[&str]) -> Result<String, String> {
    let bin = cli_candidates()
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| "xbond CLI not found beside the app or at the workspace root".to_string())?;
    let mut command = std::process::Command::new(&bin);
    command.args(verb);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().map_err(|err| err.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}

/// Stops the supervised daemon: the CLI's graceful path runs the LocalAPI
/// shutdown endpoint (engine stopped, system proxy restored, credentials
/// cleaned) and waits for the process to exit.
pub(crate) fn stop_service() -> Result<(), String> {
    cli_verb(&["daemon", "stop"]).map(|_| ())
}

/// Launch-time bring-up. An explicit quit stops the supervised daemon, so a
/// fresh GUI launch reconciles the runtime with one supervisor verb — only
/// `daemon start`, never a bare spawn, and registration stays an explicit
/// install.
pub fn launch_ensure() {
    if daemon_running() {
        return;
    }
    if let Err(err) = cli_verb(&["daemon", "start"]) {
        eprintln!("[XBond Desktop] launch daemon start failed: {err}");
        return;
    }
    if wait_for_daemon().is_none() {
        eprintln!(
            "[XBond Desktop] daemon start claimed success but the daemon never became reachable"
        );
    }
}

pub fn ensure_daemon() -> Result<LocalAPIConfig, String> {
    // The release sidecar reconciles registration and runtime on launch.
    // Reads must preserve a stopped service and must never start from the
    // immutable application bundle (or an ephemeral AppImage mount).
    if packaged() {
        return Ok(resolve_config());
    }

    if let Some((addr, token)) = read_credentials() {
        if daemon_alive(&addr) {
            return Ok(LocalAPIConfig {
                addr,
                token,
                is_running: true,
            });
        }
        // Stale files from a dead daemon: fall through and (re)start.
    }

    // Queue behind an in-flight ensure instead of spawning a rival daemon.
    let _ensure_guard = ENSURE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    if spawn_on_cooldown() {
        return Ok(resolve_config());
    }

    // The desktop app and the CLI are peers over one shared xbond daemon;
    // the GUI is a LocalAPI client, never a daemon parent. Lifecycle goes
    // through the per-user supervisor (HKCU Run / LaunchAgent / systemd
    // --user — none of them need elevation): `daemon start` covers the
    // registered case, and a fresh install registers first, so the daemon
    // is always supervised and closing the window never takes the proxy
    // down. There is deliberately no bare detached spawn here — the
    // daemon-runtime spec keeps every daemon behind a supervisor.
    let exe_name = if cfg!(windows) { "xbond.exe" } else { "xbond" };
    let mut candidate_paths = Vec::new();

    // Tauri dev runs from src-tauri.
    #[cfg(debug_assertions)]
    candidate_paths.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../dist/cli")
            .join(exe_name),
    );

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidate_paths.insert(0, parent.join(exe_name));
        }
    }

    let mut binary_path = None;
    for p in candidate_paths {
        if p.exists() {
            binary_path = Some(p);
            break;
        }
    }

    if let Some(bin) = binary_path {
        #[cfg(windows)]
        fn no_window(cmd: &mut std::process::Command) {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let lifecycle = |args: &[&str]| -> Result<std::process::Output, std::io::Error> {
            let mut cmd = std::process::Command::new(&bin);
            cmd.args(args);
            #[cfg(windows)]
            no_window(&mut cmd);
            cmd.output()
        };

        match lifecycle(&["daemon", "start"]) {
            Ok(out) if out.status.success() => {
                if let Some(cfg) = wait_for_daemon() {
                    return Ok(cfg);
                }
                eprintln!(
                    "[XBond Desktop] daemon start claimed success but the daemon never became reachable"
                );
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                if stderr.contains("not installed") {
                    // First launch with no registration: `daemon install`
                    // registers with the user-scope supervisor and starts it.
                    match lifecycle(&["daemon", "install"]) {
                        Ok(out) if out.status.success() => {
                            if let Some(cfg) = wait_for_daemon() {
                                return Ok(cfg);
                            }
                            eprintln!(
                                "[XBond Desktop] daemon install claimed success but the daemon never became reachable"
                            );
                        }
                        Ok(out) => eprintln!(
                            "[XBond Desktop] daemon install failed: {}",
                            String::from_utf8_lossy(&out.stderr).trim()
                        ),
                        Err(e) => {
                            eprintln!("[XBond Desktop] daemon install could not run: {e}")
                        }
                    }
                } else {
                    eprintln!("[XBond Desktop] daemon start failed: {}", stderr.trim());
                }
            }
            Err(e) => {
                eprintln!("[XBond Desktop] daemon start could not run: {e}");
            }
        }

        // The ensure did not produce a usable daemon within this ensure's
        // window: back off lifecycle commands — the frontend self-heal may
        // re-invoke much sooner than a retry would be worth.
        record_failed_spawn();
    } else {
        // A silent skip here reads as "XBond is broken" in the UI: the shell
        // has no way to register or start the local daemon without the CLI.
        eprintln!(
            "[XBond Desktop] no xbond CLI found next to the app or at the workspace root; \
             build it with `pnpm cli:build` so the daemon can be registered and started"
        );
    }

    Ok(resolve_config())
}

#[tauri::command]
pub fn get_localapi_config() -> LocalAPIConfig {
    // Re-ensure on every read: the daemon may have died or been reinstalled
    // since setup, and this is the hook that lets the frontend self-heal
    // instead of serving stale credential files. Tests must not spawn
    // processes, so the ensure path is compiled out there.
    #[cfg(not(test))]
    if let Ok(cfg) = ensure_daemon() {
        return cfg;
    }
    resolve_config()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_data_dir_not_empty() {
        let dir = get_data_dir();
        assert!(!dir.as_os_str().is_empty());
    }

    #[test]
    fn test_localapi_config_fallback() {
        let cfg = get_localapi_config();
        assert!(!cfg.addr.is_empty());
    }
}
