package net.xbond.app

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import java.io.File

/**
 * Hosts the shared web UI (packages/client-ui, served by the in-process
 * LocalAPI at http://127.0.0.1:<port>/) in a WebView. The UI drives the
 * tunnel through the LocalAPI contract exactly as it drives the desktop
 * daemon; nothing here knows about subscriptions or nodes.
 *
 * Boot sequence: extract the packaged UI assets into the data dir, make sure
 * the VPN service exists (it owns the TunnelService and therefore the
 * LocalAPI), wait for the LocalAPI address file, then load the UI. VPN
 * consent is asked up front — the LocalAPI /up cannot show system dialogs
 * from a service, so by the time the user presses connect it is granted.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
        }
        webView.webViewClient = android.webkit.WebViewClient()
        setContentView(webView)

        // Assets before the service: the LocalAPI serves them from the data
        // dir, so they must be in place when the UI requests the index.
        extractWebAssets()

        // Drop the previous process's address file so the poll below waits
        // for the fresh port instead of loading a dead one.
        File(filesDir, "localapi.addr").delete()

        // The service owns the TunnelService and its in-process LocalAPI;
        // ENSURE starts it without touching the tunnel.
        startService(
            Intent(this, XBondVpnService::class.java)
                .setAction(XBondVpnService.ACTION_ENSURE),
        )

        // Consent asked up front (see class doc); result ignored — a denied
        // consent surfaces later as the LocalAPI /up 409.
        if (VpnService.prepare(this) != null) {
            startActivityForResult(VpnService.prepare(this), REQUEST_CONSENT)
        }

        pollAndLoad(0)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        val uri = intent?.data ?: return
        val scheme = uri.scheme?.lowercase()
        if (scheme == "xbond" || scheme == "clash") {
            val urlString = uri.toString()
            val js = "window.dispatchEvent(new CustomEvent('xbond-deep-link', { detail: ${org.json.JSONObject.quote(urlString)} }));"
            webView.evaluateJavascript(js, null)
        }
    }

    private fun pollAndLoad(attempt: Int) {
        val addr = File(filesDir, "localapi.addr")
        if (addr.exists()) {
            val port = addr.readText().trim().substringAfterLast(':')
            webView.loadUrl("http://127.0.0.1:$port/")
            handler.postDelayed({ handleDeepLink(intent) }, 1200)
            return
        }
        if (attempt < 20) {
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
        // Consent result is not acted on: prepare() is re-checked whenever
        // the tunnel starts.
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val REQUEST_CONSENT = 1
    }
}
