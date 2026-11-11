use serde::Serialize;
use thiserror::Error;

/// The error type returned by the xbond plugin's commands and APIs.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum Error {
    /// Forwarded from a failed call into the mobile plugin runtime.
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
    /// Forwarded from a [`tauri::Error`].
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    /// Forwarded from a [`serde_json::Error`] raised while (de)serializing a
    /// mobile plugin payload.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// The requested capability is not supported on the current platform;
    /// the plugin is only registered on mobile.
    #[error("XBond native capabilities are not supported on this platform")]
    UnsupportedPlatform,
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_str())
    }
}
