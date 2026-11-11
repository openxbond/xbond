package net.xbond.app

import android.os.Bundle
import android.webkit.WebView

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
 * REGENERATION NOTE: `tauri android init` rewrites this file — re-apply the
 * onWebViewCreate/back handling below (see docs/specs/mobile-android.md).
 */
class MainActivity : TauriActivity() {

  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
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
}
