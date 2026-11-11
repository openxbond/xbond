package net.xbond.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import java.io.File

/**
 * Hosts the shared web UI (packages/client-ui) in a WebView. The UI drives
 * the tunnel through the in-process LocalAPI exactly as it drives the
 * desktop daemon; this activity only adds what the platform must supply:
 * VPN consent, the Android JS bridge (per-app VPN picker, updates, system
 * bar theming), the system back gesture, and local config file picking.
 *
 * Boot sequence: extract the packaged UI assets into the data dir, make sure
 * the VPN service exists (it owns the TunnelService and therefore the
 * LocalAPI), wait for the LocalAPI address file, then load the UI — either
 * the packaged copy or, with a `dev_url` intent extra, the Vite dev server
 * (`pnpm mobile:dev`) which reaches the same LocalAPI through query
 * bootstrap params. VPN consent is requested only when the user actually
 * connects: LocalAPI /up → PlatformBridge.requestConnect() raises the
 * system dialog over the app and answers 409; once the user grants it,
 * tapping Connect again establishes the tunnel.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var updates: AppUpdates
    private val handler = Handler(Looper.getMainLooper())
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var vpnBound = false

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            vpnBound = true
            Log.i(TAG, "bound to XBondVpnService")
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            vpnBound = false
            Log.w(TAG, "unbound from XBondVpnService (disconnected)")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        updates = AppUpdates(this)
        webView = WebView(this)
        // Chrome DevTools inspection (chrome://inspect): the shell never
        // holds app state, so debugging the live page is safe even in release.
        WebView.setWebContentsDebuggingEnabled(true)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
        }
        webView.webViewClient = object : android.webkit.WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: android.webkit.WebResourceRequest?,
            ): Boolean {
                val url = request?.url ?: return false
                val scheme = url.scheme?.lowercase() ?: return false
                if (scheme == "http" || scheme == "https") {
                    val host = url.host ?: ""
                    if (host == "127.0.0.1" || host == "localhost") {
                        return false
                    }
                }
                return try {
                    val intent = Intent(Intent.ACTION_VIEW, url).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    startActivity(intent)
                    true
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to open external url $url: ${e.message}")
                    false
                }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            // Local config import (<input type="file">) in the configuration UI.
            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(
                        Intent.EXTRA_MIME_TYPES,
                        arrayOf(
                            "application/octet-stream",
                            "application/yaml",
                            "text/yaml",
                            "text/x-yaml",
                            "text/plain",
                            "application/json",
                        ),
                    )
                }
                return try {
                    startActivityForResult(
                        Intent.createChooser(intent, null),
                        REQUEST_FILE_CHOOSER,
                    )
                    true
                } catch (e: Exception) {
                    fileChooserCallback = null
                    false
                }
            }
        }
        webView.addJavascriptInterface(XBondBridge(), BRIDGE_NAME)
        setContentView(webView)

        // Assets before the service: the LocalAPI serves them from the data
        // dir, so they must be in place when the UI requests the index.
        extractWebAssets()

        // Drop the previous process's address file only if service is not
        // already active, so the poll below waits for a fresh port instead of loading a dead one.
        if (XBondVpnService.active == null) {
            File(filesDir, "localapi.addr").delete()
        }

        // The service owns the TunnelService and its in-process LocalAPI;
        // ENSURE starts it without touching the tunnel. We also bind to it
        // so Android keeps it alive while the activity is in the background.
        val vpnIntent = Intent(this, XBondVpnService::class.java).apply {
            action = XBondVpnService.ACTION_ENSURE
        }
        startService(vpnIntent)
        bindService(vpnIntent, serviceConnection, Context.BIND_AUTO_CREATE)

        pollAndLoad(0)
        updates.checkInBackground()
    }

    /**
     * System back: the web UI owns the semantics (close a sheet, leave a
     * second-level view, then fall back to the background). The bridge
     * handler answers synchronously — true means handled.
     */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        webView.evaluateJavascript(
            "(typeof window.__xbondHandleBack === 'function' ? window.__xbondHandleBack() : false)",
        ) { result ->
            val handled = result?.trim()?.equals("true") ?: false
            if (!handled) moveTaskToBack(true)
        }
    }

    // 深鏈熱路徑：瀏覽器完成 OAuth 跳回（或分享導入）時 App 已在前台，
    // 系統走 onNewIntent 而非 onCreate——不補上這一環，回調代碼就丟在半路。
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
        // dev_url 熱路徑：mobile:dev 對已在前台的實例只送 onNewIntent，
        // 不重跑 pollAndLoad 就切不過去（packaged 資產不會自己讓位）。
        val devUrl = intent?.getStringExtra("dev_url")
        if (devUrl != null && webView.url?.startsWith(devUrl) != true) {
            pollAndLoad(0)
        }
    }

    private fun handleDeepLink(intent: Intent?) {
        val uri = intent?.data ?: return
        // 只記 scheme 與 host：深鏈 query 裡是 OAuth 憑據，不落日誌。
        Log.d(TAG, "deep link received: ${uri.scheme}://${uri.host}")
        val scheme = uri.scheme?.lowercase() ?: return
        if (scheme != "xbond" && scheme != "clash" && scheme != "sing-box") return
        // OAuth 回調：Activity 是投遞路徑（桌面殼同契約）——解析 code/state
        // 直接交給 LocalAPI，由它校驗 state 並完成換票；WebView 事件照發不誤。
        if (scheme == "xbond" && uri.host == "callback") {
            val code = uri.getQueryParameter("code")
            val state = uri.getQueryParameter("state")
            if (!code.isNullOrEmpty() && !state.isNullOrEmpty()) {
                deliverAccountCallback(code, state)
            }
        }
        val urlString = uri.toString()
        val js = "window.dispatchEvent(new CustomEvent('xbond-deep-link', { detail: ${org.json.JSONObject.quote(urlString)} }));"
        webView.evaluateJavascript(js, null)
    }

    /**
     * 把 OAuth 授權碼投遞給進程內 LocalAPI（工作線程，短重試）：冷啟動深鏈
     * 可能在服務與 LocalAPI 就緒前到達。與桌面殼的投遞語義一致。
     */
    private fun deliverAccountCallback(code: String, state: String) {
        Thread {
            val payload = org.json.JSONObject().apply {
                put("code", code)
                put("state", state)
            }
            for (attempt in 0 until 8) {
                val addrFile = File(filesDir, "localapi.addr")
                val tokenFile = File(filesDir, "localapi.token")
                if (addrFile.exists() && tokenFile.exists()) {
                    try {
                        val addr = addrFile.readText().trim()
                        val token = tokenFile.readText().trim()
                        val connection = (
                            java.net.URL("http://$addr/localapi/v0/account/callback").openConnection()
                                as java.net.HttpURLConnection
                        ).apply {
                            requestMethod = "POST"
                            setRequestProperty("X-XBond-Token", token)
                            setRequestProperty("Content-Type", "application/json")
                            connectTimeout = 2000
                            readTimeout = 5000
                            doOutput = true
                        }
                        connection.outputStream.use { output ->
                            output.write(payload.toString().toByteArray(Charsets.UTF_8))
                        }
                        val ok = connection.responseCode in 200..299
                        if (ok) {
                            Log.i(TAG, "account callback delivered successfully (status ${connection.responseCode})")
                            connection.disconnect()
                            runOnUiThread {
                                webView.evaluateJavascript(
                                    "window.dispatchEvent(new CustomEvent('xbond-account-updated'));",
                                    null,
                                )
                            }
                            return@Thread
                        } else {
                            val err = runCatching {
                                connection.errorStream?.bufferedReader()?.use { it.readText() }
                            }.getOrNull()
                            Log.w(TAG, "account callback rejected (attempt ${attempt + 1}, status ${connection.responseCode}): $err")
                        }
                        connection.disconnect()
                    } catch (e: Exception) {
                        Log.w(TAG, "account callback attempt ${attempt + 1} failed: ${e.message}")
                    }
                }
                Thread.sleep(500)
            }
            Log.e(TAG, "account callback delivery failed after retries")
        }.start()
    }

    private fun pollAndLoad(attempt: Int) {
        val addr = File(filesDir, "localapi.addr")
        val devUrl = intent?.getStringExtra("dev_url")
        if (addr.exists()) {
            if (devUrl != null) {
                // Dev mode: load the Vite server and hand it the LocalAPI
                // endpoint through the URL bootstrap params the shared
                // bootstrap already understands.
                val address = addr.readText().trim()
                val token = File(filesDir, "localapi.token").readText().trim()
                val separator = if (devUrl.contains('?')) "&" else "?"
                webView.loadUrl("$devUrl${separator}localapi_addr=$address&localapi_token=$token")
            } else {
                val port = addr.readText().trim().substringAfterLast(':')
                webView.loadUrl("http://127.0.0.1:$port/")
            }
            handler.postDelayed({ handleDeepLink(intent) }, 1200)
            return
        }
        if (attempt < 50) {
            handler.postDelayed({ pollAndLoad(attempt + 1) }, 200)
        }
    }

    /** Copies the packaged UI into the data dir where the LocalAPI serves
     * it. Version-keyed: the packaged dist hash must differ from the
     * extracted marker or the copy is skipped. */
    private fun extractWebAssets() {
        val outDir = File(filesDir, "web")
        outDir.mkdirs()
        val packagedVersion = runCatching {
            assets.open("web/xbond-dist-version.txt").bufferedReader().use { it.readText() }
        }.getOrNull()
        val marker = File(outDir, "xbond-dist-version.txt")
        if (packagedVersion != null && marker.exists() && marker.readText() == packagedVersion) {
            return
        }
        copyAssetDir("web", outDir)
        if (packagedVersion != null) {
            marker.writeText(packagedVersion)
        }
    }

    private fun copyAssetDir(assetPath: String, target: File) {
        val children = assets.list(assetPath) ?: return
        if (children.isEmpty()) {
            assets.open(assetPath).use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
            return
        }
        target.mkdirs()
        for (child in children) {
            copyAssetDir("$assetPath/$child", File(target, child))
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            AppUpdates.INSTALL_PERMISSION -> updates.permissionReturned()
            REQUEST_FILE_CHOOSER -> {
                val callback = fileChooserCallback
                fileChooserCallback = null
                val uris = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                callback?.onReceiveValue(uris ?: arrayOf())
            }
        }
    }

    override fun onDestroy() {
        if (vpnBound) {
            runCatching { unbindService(serviceConnection) }
            vpnBound = false
        }
        updates.close()
        webView.destroy()
        super.onDestroy()
    }

    /**
     * `window.XBondAndroid`: the platform surface the web UI consumes for
     * what the browser cannot do. Every method answers JSON strings or a
     * boolean; failures answer defaults instead of throwing into the
     * WebView's JavaBridge thread.
     */
    private inner class XBondBridge {

        /** Installed apps JSON for the per-app VPN picker. */
        @JavascriptInterface
        fun getInstalledApps(): String = runCatching {
            SplitTunnelPrefs.listInstalledAppsJSON(this@MainActivity)
        }.getOrDefault("[]")

        /** Saved split-tunnel config JSON: { mode, packages }. */
        @JavascriptInterface
        fun getSplitTunnelConfig(): String =
            SplitTunnelPrefs.readJSON(this@MainActivity)

        /**
         * Persists the split-tunnel config; while the tunnel runs the VPN
         * interface is rebuilt in place so the change applies without a
         * manual reconnect. Answers false only when the payload is unusable.
         */
        @JavascriptInterface
        fun setSplitTunnelConfig(json: String): Boolean {
            return try {
                val obj = org.json.JSONObject(json)
                val mode = obj.optString("mode", SplitTunnelPrefs.MODE_ALL)
                val packages = mutableSetOf<String>()
                val array = obj.optJSONArray("packages")
                if (array != null) {
                    for (i in 0 until array.length()) {
                        val pkg = array.optString(i)
                        if (pkg.isNotEmpty()) packages.add(pkg)
                    }
                }
                SplitTunnelPrefs.write(this@MainActivity, mode, packages)
                XBondVpnService.reloadIfConnected()
                true
            } catch (e: Exception) {
                Log.e(TAG, "setSplitTunnelConfig failed: ${e.message}")
                false
            }
        }

        /** Manual update check from the about card. */
        @JavascriptInterface
        fun checkForUpdates() {
            runOnUiThread { updates.check(manual = true) }
        }

        /** Opens an external URL in the default browser. */
        @JavascriptInterface
        fun openURL(url: String): Boolean {
            return try {
                val uri = Uri.parse(url)
                val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
                true
            } catch (e: Exception) {
                Log.e(TAG, "openURL failed for $url: ${e.message}")
                false
            }
        }

        /**
         * Key-value preference persistence for UI settings (language, theme)
         * to survive origin resets or cross-origin dev sessions.
         */
        @JavascriptInterface
        fun getPreference(key: String): String? = runCatching {
            getSharedPreferences(PREFS_UI, Context.MODE_PRIVATE).getString(key, null)
        }.getOrNull()

        @JavascriptInterface
        fun setPreference(key: String, value: String): Boolean = runCatching {
            getSharedPreferences(PREFS_UI, Context.MODE_PRIVATE)
                .edit()
                .putString(key, value)
                .commit()
        }.getOrDefault(false)

        /**
         * Theme sync: the UI reports its resolved scheme and surface color so
         * the status and gesture bars never render as a detached gray strip.
         */
        @JavascriptInterface
        fun syncSystemBars(isDark: Boolean, colorHex: String?) {
            runOnUiThread {
                val controller = WindowCompat.getInsetsController(window, window.decorView)
                controller.isAppearanceLightStatusBars = !isDark
                controller.isAppearanceLightNavigationBars = !isDark
                val color = colorHex?.let { hex ->
                    runCatching { Color.parseColor(hex) }.getOrNull()
                }
                if (color != null) {
                    window.statusBarColor = color
                    window.navigationBarColor = color
                }
            }
        }
    }

    private companion object {
        const val TAG = "MainActivity"
        const val BRIDGE_NAME = "XBondAndroid"
        const val PREFS_UI = "xbond_ui_preferences"
        const val REQUEST_FILE_CHOOSER = 3
    }
}
