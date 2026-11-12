use serde::{Deserialize, Serialize};
use std::{fs, io};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(default)]
pub(crate) struct DesktopPreferences {
    pub autostart_initialized: bool,
    pub close_to_tray: bool,
    pub silent_start: bool,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            autostart_initialized: false,
            close_to_tray: true,
            silent_start: true,
        }
    }
}

impl DesktopPreferences {
    pub fn load() -> Result<Self, String> {
        let path = crate::daemon::get_data_dir().join("desktop-preferences.json");
        match fs::read(&path) {
            Ok(data) => serde_json::from_slice(&data).map_err(|err| err.to_string()),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(err) => Err(err.to_string()),
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let dir = crate::daemon::get_data_dir();
        let path = dir.join("desktop-preferences.json");
        let temporary = dir.join("desktop-preferences.tmp");
        let data = serde_json::to_vec(self).map_err(|err| err.to_string())?;
        fs::create_dir_all(dir)
            .and_then(|()| fs::write(&temporary, data))
            .and_then(|()| fs::rename(temporary, path))
            .map_err(|err| err.to_string())
    }
}
