package net.xbond.app.xbond

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.core.view.WindowCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import mobile.Mobile

/**
 * The platform surface the shared web UI consumes through the Tauri `xbond`
 * plugin (packages/client-ui/src/platform/android-bridge.ts): the LocalAPI
 * endpoint it drives the tunnel through, per-app VPN data, the self-hosted
 * update check, preference persistence and system bar theming.
 *
 * Lifecycle: on webview load the plugin makes sure the VPN service (owner of
 * the TunnelService and therefore the in-process LocalAPI) exists, then
 * starts the daily update check. The UI itself is served by Tauri from the
 * bundled assets and learns the LocalAPI endpoint through getLocalAPIConfig;
 * the old extract/poll/loadUrl boot dance is gone with the local-origin
 * webview.
 */
@TauriPlugin
class XbondPlugin(private val activity: Activity) : Plugin(activity) {

    private var updates: AppUpdates? = null
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

    override fun load(webView: android.webkit.WebView) {
        super.load(webView)
        updates = AppUpdates(activity)

        // Drop the previous process's address file only if the service is not
        // already active, so getLocalAPIConfig waits for a fresh port instead
        // of answering with a dead one.
        if (XBondVpnService.active == null) {
            File(activity.filesDir, "localapi.addr").delete()
        }

        // The service owns the TunnelService and its in-process LocalAPI;
        // ENSURE starts it without touching the tunnel. We also bind to it so
        // Android keeps it alive while the activity is in the background.
        val vpnIntent = Intent(activity, XBondVpnService::class.java).apply {
            action = XBondVpnService.ACTION_ENSURE
        }
        activity.startService(vpnIntent)
        activity.bindService(vpnIntent, serviceConnection, Context.BIND_AUTO_CREATE)

        registerNetworksMonitor()

        updates?.checkInBackground()
    }

    override fun onResume() {
        super.onResume()
        // The unknown-sources consent screen returns through onResume (the
        // invoke-bound activity result belongs to the webview activity), so
        // the pending install continues here either way.
        updates?.onActivityResumed()
    }

    override fun onDestroy() {
        if (vpnBound) {
            runCatching { activity.unbindService(serviceConnection) }
            vpnBound = false
        }
        updates?.close()
        super.onDestroy()
    }

    /** Loopback endpoint and token of the in-process LocalAPI; the UI boot
     * retries until the freshly started service has written both files. */
    @Command
    fun getLocalAPIConfig(invoke: Invoke) {
        val addrFile = File(activity.filesDir, "localapi.addr")
        val tokenFile = File(activity.filesDir, "localapi.token")
        if (!addrFile.exists() || !tokenFile.exists()) {
            invoke.reject("localapi endpoint not ready")
            return
        }
        val result = JSObject()
        result.put("addr", addrFile.readText().trim())
        result.put("token", tokenFile.readText().trim())
        invoke.resolve(result)
    }

    /** Installed apps for the per-app VPN picker. */
    @Command
    fun listInstalledApps(invoke: Invoke) {
        invoke.resolveObject(SplitTunnelPrefs.listInstalledApps(activity))
    }

    /** Startup hand-off: the web UI reports the daemon connection settled;
     * MainActivity releases the native splash keep-on-screen on this flag. */
    @Command
    fun startupComplete(invoke: Invoke) {
        StartupSplash.settled = true
        invoke.resolve()
    }

    /** Saved split-tunnel config: { mode, packages }. */
    @Command
    fun getSplitTunnelConfig(invoke: Invoke) {
        val (mode, packages) = SplitTunnelPrefs.read(activity)
        invoke.resolveObject(
            mapOf("mode" to mode, "packages" to packages.toSortedSet()),
        )
    }

    /**
     * Persists the split-tunnel config; while the tunnel runs the VPN
     * interface is rebuilt in place so the change applies without a manual
     * reconnect. Answers false only when the payload is unusable.
     */
    @Command
    fun setSplitTunnelConfig(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(JsonPayloadArgs::class.java)
            val obj = org.json.JSONObject(args.json)
            val mode = obj.optString("mode", SplitTunnelPrefs.MODE_ALL)
            val packages = mutableSetOf<String>()
            val array = obj.optJSONArray("packages")
            if (array != null) {
                for (i in 0 until array.length()) {
                    val pkg = array.optString(i)
                    if (pkg.isNotEmpty()) packages.add(pkg)
                }
            }
            SplitTunnelPrefs.write(activity, mode, packages)
            XBondVpnService.reloadIfConnected()
            invoke.resolveObject(true)
        } catch (e: Exception) {
            Log.e(TAG, "setSplitTunnelConfig failed: ${e.message}")
            invoke.resolveObject(false)
        }
    }

    /**
     * Interactive VPN consent, launched from the ACTIVITY context through
     * the Activity Result API. The system ConfirmDialog resolves the app to
     * authorize via its calling package: a Service-side startActivity has
     * none (and can be aborted by background-activity-launch rules), so the
     * dialog finishes instantly and the flow can never complete. The web UI
     * calls this on the /up 409 ("VPN consent required") and retries the
     * connect when it resolves true. `null` from prepare means already
     * authorized; RESULT_CANCELED (user declined) resolves false.
     */
    @Command
    fun requestVpnConsent(invoke: Invoke) {
        val consent = XBondVpnService.prepare(activity)
        if (consent == null) {
            invoke.resolveObject(true)
            return
        }
        startActivityForResult(invoke, consent, "vpnConsentResult")
    }

    @ActivityCallback
    fun vpnConsentResult(invoke: Invoke, result: ActivityResult) {
        invoke.resolveObject(result.resultCode == Activity.RESULT_OK)
    }

    /** Manual update check from the about card. */
    @Command
    fun checkForUpdates(invoke: Invoke) {
        val args = invoke.parseArgs(CheckUpdatesArgs::class.java)
        val updates = updates
        if (updates == null) {
            invoke.reject("updates not initialized")
            return
        }
        activity.runOnUiThread { updates.check(manual = args.manual) }
        invoke.resolve()
    }

    /**
     * Key-value preference persistence for UI settings (language, theme)
     * to survive origin resets or cross-origin dev sessions.
     */
    @Command
    fun getPreference(invoke: Invoke) {
        val args = invoke.parseArgs(PreferenceKeyArgs::class.java)
        val value = runCatching {
            activity.getSharedPreferences(PREFS_UI, Context.MODE_PRIVATE).getString(args.key, null)
        }.getOrNull()
        if (value == null) {
            invoke.resolve(null as JSObject?)
        } else {
            val result = JSObject()
            result.put("value", value)
            invoke.resolve(result)
        }
    }

    @Command
    fun setPreference(invoke: Invoke) {
        val args = invoke.parseArgs(PreferenceSetArgs::class.java)
        val saved = runCatching {
            activity.getSharedPreferences(PREFS_UI, Context.MODE_PRIVATE)
                .edit()
                .putString(args.key, args.value)
                .commit()
        }.getOrDefault(false)
        invoke.resolveObject(saved)
    }

    /**
     * Theme sync: the UI reports its resolved scheme and surface color (the
     * --background token) so the bars never render as a detached strip. The
     * bar scrims still work below API 35; from 35 on edge-to-edge is enforced
     * and both are no-ops — the transparent bars then show the window
     * background, so that has to carry the surface color instead.
     */
    @Command
    fun syncSystemBars(invoke: Invoke) {
        val args = invoke.parseArgs(SystemBarsArgs::class.java)
        activity.runOnUiThread {
            val window = activity.window
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            controller.isAppearanceLightStatusBars = !args.isDark
            controller.isAppearanceLightNavigationBars = !args.isDark
            val color = args.color?.let { hex ->
                runCatching { Color.parseColor(hex) }.getOrNull()
            }
            if (color != null) {
                window.statusBarColor = color
                window.navigationBarColor = color
                window.setBackgroundDrawable(ColorDrawable(color))
            }
        }
        invoke.resolve()
    }

    /**
     * Delivers an OAuth code/state pair to the in-process LocalAPI (worker
     * thread, short retries): cold-start deep links can arrive before the
     * service and LocalAPI are ready. Same contract as the desktop shell.
     * Answers true when the daemon accepted the delivery; the frontend
     * dispatches its `xbond-account-updated` event from that result.
     */
    @Command
    fun deliverAccountCallback(invoke: Invoke) {
        val args = invoke.parseArgs(AccountCallbackArgs::class.java)
        Thread {
            val delivered = runCatching { deliverWithRetry(args.code, args.state) }
                .onFailure { Log.w(TAG, "account callback delivery failed: ${it.message}") }
                .getOrDefault(false)
            if (!delivered) Log.e(TAG, "account callback delivery failed after retries")
            invoke.resolveObject(delivered)
        }.start()
    }

    private fun deliverWithRetry(code: String, state: String): Boolean {
        val payload = org.json.JSONObject().apply {
            put("code", code)
            put("state", state)
        }
        for (attempt in 0 until 8) {
            val addrFile = File(activity.filesDir, "localapi.addr")
            val tokenFile = File(activity.filesDir, "localapi.token")
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
                        return true
                    }
                    val err = runCatching {
                        connection.errorStream?.bufferedReader()?.use { it.readText() }
                    }.getOrNull()
                    Log.w(TAG, "account callback rejected (attempt ${attempt + 1}, status ${connection.responseCode}): $err")
                    connection.disconnect()
                } catch (e: Exception) {
                    Log.w(TAG, "account callback attempt ${attempt + 1} failed: ${e.message}")
                }
            }
            Thread.sleep(500)
        }
        return false
    }

    @InvokeArg
    class JsonPayloadArgs {
        lateinit var json: String
    }

    @InvokeArg
    class CheckUpdatesArgs {
        var manual: Boolean = false
    }

    @InvokeArg
    class PreferenceKeyArgs {
        lateinit var key: String
    }

    @InvokeArg
    class PreferenceSetArgs {
        lateinit var key: String
        lateinit var value: String
    }

    @InvokeArg
    class SystemBarsArgs {
        var isDark: Boolean = false
        var color: String? = null
    }

    @InvokeArg
    class AccountCallbackArgs {
        lateinit var code: String
        lateinit var state: String
    }

    // Android 14+ denies untrusted apps the netlink RTM_GETLINK that Go's
    // net.Interfaces needs, so the Go core cannot enumerate the interface
    // table itself; feed it from ConnectivityManager instead, mirroring the
    // official sing-box Android client. The table enumerates all networks;
    // the default is tracked by a best-matching callback. Since Android P,
    // registerDefaultNetworkCallback reports our own VPN once it is up, which
    // is why the registration below uses request-style callbacks that keep
    // tracking the real underlying network (see DefaultNetworkListener in
    // SagerNet/sing-box-for-android).
    private val networksRequest = NetworkRequest.Builder()
        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED)
        .build()

    @Volatile
    private var lastDefaultNetwork: Network? = null

    private val networksCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            lastDefaultNetwork = network
            pushNetworksSnapshot()
        }

        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) =
            pushNetworksSnapshot()

        override fun onLinkPropertiesChanged(network: Network, lp: android.net.LinkProperties) =
            pushNetworksSnapshot()

        override fun onLost(network: Network) {
            if (lastDefaultNetwork == network) lastDefaultNetwork = null
            pushNetworksSnapshot()
        }
    }

    private var networksMonitorRegistered = false

    private fun registerNetworksMonitor() {
        if (networksMonitorRegistered) return
        runCatching {
            val cm = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return
            when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
                    cm.registerBestMatchingNetworkCallback(
                        networksRequest,
                        networksCallback,
                        Handler(Looper.getMainLooper()),
                    )

                Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ->
                    cm.requestNetwork(networksRequest, networksCallback)

                Build.VERSION.SDK_INT >= Build.VERSION_CODES.N ->
                    cm.registerDefaultNetworkCallback(networksCallback)

                else ->
                    runCatching { cm.requestNetwork(networksRequest, networksCallback) }
            }
            networksMonitorRegistered = true
            pushNetworksSnapshot()
        }.onFailure { Log.w(TAG, "networks monitor unavailable: ${it.message}") }
    }

    private fun pushNetworksSnapshot() {
        runCatching {
            val cm = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return
            val entries = mutableListOf<Network>()
            for (network in cm.allNetworks) {
                val caps = cm.getNetworkCapabilities(network) ?: continue
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
                val lp = cm.getLinkProperties(network) ?: continue
                if (lp.interfaceName == null) continue
                entries.add(network)
            }
            if (entries.isEmpty()) return

            // The best-matching callback tracks the real default even while
            // our VPN is up (the same reason registerDefaultNetworkCallback
            // cannot be used). Before the first callback fires, mark the
            // first candidate so the parallel dialer always has a default.
            val defaultNetwork: Network = lastDefaultNetwork?.takeIf { entries.contains(it) }
                ?: entries.first()

            val arr = org.json.JSONArray()
            for (network in entries) {
                val caps = cm.getNetworkCapabilities(network) ?: continue
                val lp = cm.getLinkProperties(network) ?: continue
                val name = lp.interfaceName ?: continue
                val jif = runCatching { java.net.NetworkInterface.getByName(name) }.getOrNull()

                val obj = org.json.JSONObject()
                obj.put("name", name)
                obj.put("index", jif?.index ?: 0)
                obj.put("mtu", jif?.mtu ?: lp.mtu)
                val addrs = org.json.JSONArray()
                if (jif != null) {
                    for (ia in jif.interfaceAddresses) addrs.put(ia.address.hostAddress + "/" + ia.networkPrefixLength)
                } else {
                    for (la in lp.linkAddresses) addrs.put(la.toString())
                }
                obj.put("addresses", addrs)
                val flags = org.json.JSONArray()
                for (f in listOf("up", "running", "broadcast", "multicast")) flags.put(f)
                obj.put("flags", flags)
                obj.put("default", network == defaultNetwork)
                obj.put(
                    "type",
                    when {
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                        else -> "other"
                    },
                )
                val dns = org.json.JSONArray()
                for (server in lp.dnsServers) server.hostAddress?.let { dns.put(it) }
                obj.put("dns", dns)
                obj.put("metered", !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
                arr.put(obj)
            }
            Mobile.setPlatformNetworkInterfaces(arr.toString())
        }.onFailure { Log.w(TAG, "networks snapshot failed: ${it.message}") }
    }

    private companion object {
        const val TAG = "XbondPlugin"
        const val PREFS_UI = "xbond_ui_preferences"
    }
}
