package net.xbond.app

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import net.xbond.app.xbond.StartupSplash

/**
 * Thin launcher activity over the Tauri shell. Everything native lives in
 * the xbond plugin (net.xbond.app.xbond); this class exists because the
 * system back gesture is the one hook a plugin cannot own: the web UI owns
 * the semantics (close a sheet, leave a second-level view, then fall back
 * to the background) via `window.__xbondHandleBack`, and unhandled backs
 * move the task to the background instead of destroying the activity.
 *
 * Deliberately NO enableEdgeToEdge(): below Android 15 it lays the webview
 * under the system bars while WebView there still reports
 * env(safe-area-inset-*) as 0, so content would slide beneath the status
 * bar; on 15+ edge-to-edge is enforced anyway and the call is a no-op. The
 * bars follow the theme through XbondPlugin.syncSystemBars.
 *
 * Startup splash: the cold-start splash (Theme.XBond.Starting) stays on
 * screen until the web UI reports the daemon connection settled through the
 * plugin's `startup_complete` command (StartupSplash.settled), with a
 * watchdog cap so a webview that never boots still gets past the splash.
 *
 * REGENERATION NOTE: `tauri android init` rewrites this file — re-apply the
 * installSplashScreen/onWebViewCreate/back handling below (see
 * docs/specs/mobile-android.md).
 */
class MainActivity : TauriActivity() {

  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    // installSplashScreen() must run before super.onCreate and expects the
    // activity theme Theme.XBond.Starting (postSplashScreenTheme swaps back
    // to Theme.XBond once the splash dismisses).
    val splash = installSplashScreen()
    splash.setKeepOnScreenCondition { !StartupSplash.settled }
    Handler(Looper.getMainLooper()).postDelayed(
      { StartupSplash.settled = true },
      SPLASH_WATCHDOG_MS,
    )
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    val currentWebView = webView
    if (currentWebView == null) {
      moveTaskToBack(true)
      return
    }
    currentWebView.evaluateJavascript(
      "(typeof window.__xbondHandleBack === 'function' ? window.__xbondHandleBack() : false)",
    ) { result ->
      val handled = result?.trim()?.equals("true") ?: false
      if (!handled) moveTaskToBack(true)
    }
  }

  private companion object {
    /** 上报路径由 web UI 的 startup hand-off 承担；此 cap 只兜 webview
     * 起不来的死局，比前端 8s 上报 cap 略宽，避免抢先收掉 splash。 */
    const val SPLASH_WATCHDOG_MS = 10_000L
  }
}
