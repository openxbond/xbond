use serde::{Deserialize, Serialize};

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
}
