#[cfg(mobile)]
use tauri::plugin::PluginHandle;
use tauri::{plugin::TauriPlugin, Manager, Runtime};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "net.xbond.app.xbond";
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_xbond);

mod commands;
#[cfg(desktop)]
mod desktop;
mod error;
#[cfg(mobile)]
mod mobile;

pub use error::Error;
type Result<T> = std::result::Result<T, Error>;

/// Access to the XBond native capabilities, managed by the plugin as app
/// state. Obtain an instance via [`XbondExt::xbond`]. Every method forwards
/// to the platform plugin implementation (Kotlin on Android, Swift on iOS);
/// desktop targets answer `UnsupportedPlatform` — the shell only registers
/// this plugin on mobile.
pub struct Xbond<R: Runtime> {
    // we use `fn() -> R` to silence the unused generic error
    // while keeping this struct `Send + Sync` without requiring `R` to be
    #[cfg(not(mobile))]
    _marker: std::marker::PhantomData<fn() -> R>,
    #[cfg(mobile)]
    mobile_plugin_handle: PluginHandle<R>,
}

/// Extensions to [`tauri::App`], [`tauri::AppHandle`], [`tauri::WebviewWindow`],
/// [`tauri::Webview`] and [`tauri::Window`] to access the XBond APIs.
pub trait XbondExt<R: Runtime> {
    /// Returns the [`Xbond`] instance managed by the plugin.
    fn xbond(&self) -> &Xbond<R>;
}

impl<R: Runtime, T: Manager<R>> XbondExt<R> for T {
    fn xbond(&self) -> &Xbond<R> {
        self.state::<Xbond<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("xbond")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "XbondPlugin")?;
            #[cfg(target_os = "ios")]
            let handle = api.register_ios_plugin(init_plugin_xbond)?;
            #[cfg(not(mobile))]
            let _handle = ();
            #[cfg(not(mobile))]
            let _ = &api;

            app.manage(Xbond {
                #[cfg(mobile)]
                mobile_plugin_handle: handle,
                #[cfg(not(mobile))]
                _marker: std::marker::PhantomData::<fn() -> R>,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_localapi_config,
            commands::startup_complete,
            commands::list_installed_apps,
            commands::get_split_tunnel_config,
            commands::set_split_tunnel_config,
            commands::check_for_updates,
            commands::get_preference,
            commands::set_preference,
            commands::sync_system_bars,
            commands::deliver_account_callback,
        ])
        .build()
}
