use tauri::Runtime;

use super::Xbond;

impl<R: Runtime> Xbond<R> {
    /// Loopback endpoint and token of the in-process LocalAPI, as written by
    /// the VPN service that owns the TunnelService.
    pub fn get_localapi_config(&self) -> super::Result<serde_json::Value> {
        self.mobile_plugin_handle
            .run_mobile_plugin("getLocalAPIConfig", serde_json::json!({}))
            .map_err(Into::into)
    }

    /// Startup hand-off: the web UI reports the daemon connection settled;
    /// the platform releases its native splash keep-on-screen. iOS has no
    /// splash object to hold (the storyboard dismisses at first frame), so
    /// the Swift side answers with an empty resolve.
    pub fn startup_complete(&self) -> super::Result<()> {
        self.mobile_plugin_handle
            .run_mobile_plugin::<serde_json::Value>("startupComplete", serde_json::json!({}))
            .map(|_| ())
            .map_err(Into::into)
    }

    /// Installed apps JSON for the per-app VPN picker.
    pub fn list_installed_apps(&self) -> super::Result<serde_json::Value> {
        self.mobile_plugin_handle
            .run_mobile_plugin("listInstalledApps", serde_json::json!({}))
            .map_err(Into::into)
    }

    /// Saved split-tunnel config: `{ mode, packages }`.
    pub fn get_split_tunnel_config(&self) -> super::Result<serde_json::Value> {
        self.mobile_plugin_handle
            .run_mobile_plugin("getSplitTunnelConfig", serde_json::json!({}))
            .map_err(Into::into)
    }

    /// Persists `{ mode, packages }`; rebuilds the VPN interface live when
    /// the tunnel runs. Answers `false` only when the platform rejected the
    /// payload.
    pub fn set_split_tunnel_config(&self, json: &str) -> super::Result<bool> {
        self.mobile_plugin_handle
            .run_mobile_plugin("setSplitTunnelConfig", serde_json::json!({ "json": json }))
            .map_err(Into::into)
            .and_then(|value| serde_json::from_value(value).map_err(Into::into))
    }

    /// Manual update check from the settings page (fire and forget).
    pub fn check_for_updates(&self, manual: bool) -> super::Result<()> {
        self.mobile_plugin_handle
            .run_mobile_plugin::<serde_json::Value>(
                "checkForUpdates",
                serde_json::json!({ "manual": manual }),
            )
            .map(|_| ())
            .map_err(Into::into)
    }

    /// Key-value preference persistence for UI settings (language, theme);
    /// survives origin resets and cross-origin dev sessions.
    pub fn get_preference(&self, key: &str) -> super::Result<Option<String>> {
        self.mobile_plugin_handle
            .run_mobile_plugin("getPreference", serde_json::json!({ "key": key }))
            .map(|value| match value {
                serde_json::Value::Null => None,
                serde_json::Value::String(value) => Some(value),
                other => Some(other.to_string()),
            })
            .map_err(Into::into)
    }

    pub fn set_preference(&self, key: &str, value: &str) -> super::Result<bool> {
        self.mobile_plugin_handle
            .run_mobile_plugin(
                "setPreference",
                serde_json::json!({ "key": key, "value": value }),
            )
            .map_err(Into::into)
            .and_then(|value| serde_json::from_value(value).map_err(Into::into))
    }

    /// Theme sync: the UI reports its resolved scheme and surface color so
    /// the status and gesture bars never render as a detached gray strip.
    pub fn sync_system_bars(&self, is_dark: bool, color: Option<&str>) -> super::Result<()> {
        self.mobile_plugin_handle
            .run_mobile_plugin::<serde_json::Value>(
                "syncSystemBars",
                serde_json::json!({ "isDark": is_dark, "color": color }),
            )
            .map(|_| ())
            .map_err(Into::into)
    }

    /// Delivers an OAuth code/state pair to the in-process LocalAPI
    /// (`/localapi/v0/account/callback`), retrying through the cold-start
    /// race. Answers `true` when the daemon accepted the delivery.
    pub fn deliver_account_callback(&self, code: &str, state: &str) -> super::Result<bool> {
        self.mobile_plugin_handle
            .run_mobile_plugin(
                "deliverAccountCallback",
                serde_json::json!({ "code": code, "state": state }),
            )
            .map_err(Into::into)
            .and_then(|value| serde_json::from_value(value).map_err(Into::into))
    }
}
