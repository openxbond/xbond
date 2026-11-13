use serde_json::Value;

use super::{Error, Xbond};

// The mobile shell is the only consumer of these capabilities; the desktop
// surface (tray, window commands, opener) is separate. The stubs exist so
// the crate compiles for desktop targets and the command/permission schemas
// stay identical across platforms.

impl<R: tauri::Runtime> Xbond<R> {
    pub fn get_localapi_config(&self) -> super::Result<Value> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn startup_complete(&self) -> super::Result<()> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn request_vpn_consent(&self) -> super::Result<bool> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn list_installed_apps(&self) -> super::Result<Value> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn get_split_tunnel_config(&self) -> super::Result<Value> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn set_split_tunnel_config(&self, _json: &str) -> super::Result<bool> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn check_for_updates(&self, _manual: bool) -> super::Result<()> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn get_preference(&self, _key: &str) -> super::Result<Option<String>> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn set_preference(&self, _key: &str, _value: &str) -> super::Result<bool> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn sync_system_bars(&self, _is_dark: bool, _color: Option<&str>) -> super::Result<()> {
        Err(Error::UnsupportedPlatform)
    }

    pub fn deliver_account_callback(&self, _code: &str, _state: &str) -> super::Result<bool> {
        Err(Error::UnsupportedPlatform)
    }
}
