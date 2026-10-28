use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalAPIConfig {
    pub addr: String,
    pub token: String,
    pub is_running: bool,
}

static SUPERVISED_CHILD: Mutex<Option<Child>> = Mutex::new(None);

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
            return PathBuf::from(user_profile).join("AppData").join("Local").join("xbond");
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join("Library").join("Application Support").join("xbond");
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            return PathBuf::from(xdg).join("xbond");
        }
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(".local").join("share").join("xbond");
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

pub fn ensure_daemon() -> Result<LocalAPIConfig, String> {
    if let Some((addr, token)) = read_credentials() {
        return Ok(LocalAPIConfig {
            addr,
            token,
            is_running: true,
        });
    }

    // Attempt to start xbond daemon if binary exists
    let exe_name = if cfg!(windows) { "xbond.exe" } else { "xbond" };
    let mut candidate_paths = vec![
        PathBuf::from(exe_name),
        PathBuf::from("..").join(exe_name),
    ];

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
        let mut cmd = std::process::Command::new(bin);
        cmd.arg("daemon");

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        match cmd.spawn() {
            Ok(child) => {
                let mut guard = SUPERVISED_CHILD.lock().unwrap();
                *guard = Some(child);

                // Wait up to 3 seconds for credentials to appear
                for _ in 0..15 {
                    std::thread::sleep(Duration::from_millis(200));
                    if let Some((addr, token)) = read_credentials() {
                        return Ok(LocalAPIConfig {
                            addr,
                            token,
                            is_running: true,
                        });
                    }
                }
            }
            Err(e) => {
                eprintln!("[XBond Desktop] Failed to spawn xbond daemon: {e}");
            }
        }
    }

    if let Some((addr, token)) = read_credentials() {
        Ok(LocalAPIConfig {
            addr,
            token,
            is_running: true,
        })
    } else {
        Ok(LocalAPIConfig {
            addr: "127.0.0.1:5001".to_string(),
            token: "".to_string(),
            is_running: false,
        })
    }
}

pub fn stop_supervised_daemon() {
    let mut guard = SUPERVISED_CHILD.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
pub fn get_localapi_config() -> LocalAPIConfig {
    if let Some((addr, token)) = read_credentials() {
        LocalAPIConfig {
            addr,
            token,
            is_running: true,
        }
    } else {
        LocalAPIConfig {
            addr: "127.0.0.1:5001".to_string(),
            token: "".to_string(),
            is_running: false,
        }
    }
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
