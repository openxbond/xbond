package net.xbond.app.xbond

/**
 * Startup splash hand-off flag shared with the app module: the thin launcher
 * activity keeps the native splash on screen while the flag is false, and the
 * web UI releases it through the `startup_complete` plugin command once the
 * daemon connection settles (or the activity's watchdog times out). Lives in
 * the plugin because the app module depends on the plugin, never the reverse.
 */
object StartupSplash {
    @Volatile
    var settled: Boolean = false
}
