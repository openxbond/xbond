package net.xbond.app.xbond

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import android.view.HapticFeedbackConstants
import androidx.activity.result.ActivityResult
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import app.tauri.PermissionState
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

private const val NOTIFICATION_PERMISSION_ALIAS = "notifications"

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
@TauriPlugin(
    permissions = [
        Permission(
            strings = [Manifest.permission.POST_NOTIFICATIONS],
            alias = NOTIFICATION_PERMISSION_ALIAS,
        ),
    ],
)
class XbondPlugin(private val activity: Activity) : Plugin(activity) {

    private var updates: AppUpdates? = null
    private var vpnBound = false
    @Volatile
    private var pendingSaveText: String? = null

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

        // Drop the previous process's discovery files only if the service is not
        // already active, so getLocalAPIConfig waits for a fresh pair instead
        // of answering with a dead port or stale token.
        if (XBondVpnService.active == null) {
            File(activity.filesDir, "localapi.addr").delete()
            File(activity.filesDir, "localapi.token").delete()
        }

        // The service owns the TunnelService and its in-process LocalAPI;
        // ENSURE starts it without touching the tunnel. We also bind to it so
        // Android keeps it alive while the activity is in the background.
        val vpnIntent = Intent(activity, XBondVpnService::class.java).apply {
            action = XBondVpnService.ACTION_ENSURE
        }
        activity.startService(vpnIntent)
        activity.bindService(vpnIntent, serviceConnection, Context.BIND_AUTO_CREATE)

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
        val addr = runCatching { addrFile.readText().trim() }.getOrDefault("")
        val token = runCatching { tokenFile.readText().trim() }.getOrDefault("")
        if (addr.isEmpty() || token.isEmpty()) {
            invoke.reject("localapi endpoint not ready")
            return
        }
        val result = JSObject()
        result.put("addr", addr)
        result.put("token", token)
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
     * Tactile feedback for key state changes (connection up/down, failures).
     * View-level haptics need no VIBRATE permission — navigator.vibrate is
     * silenced by Android WebView, so this is the only reliable path. `kind`
     * maps tap→VIRTUAL_KEY, confirm→CONFIRM, error→REJECT; CONFIRM/REJECT are
     * API 30+, older devices fall back to VIRTUAL_KEY/LONG_PRESS. Resolves
     * once queued; the web side fire-and-forgets and never awaits.
     */
    @Command
    fun performHaptic(invoke: Invoke) {
        val args = invoke.parseArgs(HapticArgs::class.java)
        val constant = when (args.kind) {
            "confirm" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
                    HapticFeedbackConstants.CONFIRM
                else HapticFeedbackConstants.VIRTUAL_KEY
            "error" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
                    HapticFeedbackConstants.REJECT
                else HapticFeedbackConstants.LONG_PRESS
            else -> HapticFeedbackConstants.VIRTUAL_KEY
        }
        activity.runOnUiThread {
            activity.window.decorView.performHapticFeedback(constant)
        }
        invoke.resolve()
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

    private fun isNotificationsGranted(): Boolean {
        val enabled = NotificationManagerCompat.from(activity).areNotificationsEnabled()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return enabled
        }
        val granted = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        return enabled && granted
    }

    /**
     * Reports the notification authorization state: "granted", "denied"
     * (permanently declined or disabled in system settings), or "prompt"
     * (runtime prompt can still be shown on Android 13+).
     */
    @Command
    fun getNotificationPermissionState(invoke: Invoke) {
        val state = when {
            isNotificationsGranted() -> "granted"
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU -> "denied"
            ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED -> "denied"
            getPermissionState(NOTIFICATION_PERMISSION_ALIAS) == PermissionState.DENIED -> "denied"
            else -> "prompt"
        }
        invoke.resolveObject(state)
    }

    /**
     * Requests runtime POST_NOTIFICATIONS permission on Android 13+.
     * Never throws when declined; resolves false so VPN connect continues.
     */
    @Command
    fun requestNotificationPermission(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            invoke.resolveObject(NotificationManagerCompat.from(activity).areNotificationsEnabled())
            return
        }
        val permGranted = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (permGranted) {
            invoke.resolveObject(NotificationManagerCompat.from(activity).areNotificationsEnabled())
            return
        }
        requestPermissionForAlias(
            NOTIFICATION_PERMISSION_ALIAS,
            invoke,
            "notificationPermissionCallback",
        )
    }

    @PermissionCallback
    fun notificationPermissionCallback(invoke: Invoke) {
        invoke.resolveObject(isNotificationsGranted())
    }

    /** Opens the system app notification settings screen. */
    @Command
    fun openNotificationSettings(invoke: Invoke) {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            }
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", activity.packageName, null)
            }
        }
        val opened = runCatching {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            true
        }.onFailure { err ->
            Log.w(TAG, "openNotificationSettings failed: ${err.message}")
        }.getOrDefault(false)
        invoke.resolveObject(opened)
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
            invoke.resolve()
        } else {
            invoke.resolveObject(value)
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
        if (saved && args.key == "app_lang") {
            XBondVpnService.refreshNotificationIfActive()
        }
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
     * Shares text content (logs, bug report) through the system share sheet.
     * Writes to a cache file and grants read permission via the app
     * FileProvider (covers the cache path).
     */
    @Command
    fun shareTextFile(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(TextFileArgs::class.java)
            val dir = File(activity.cacheDir, "exports")
            dir.mkdirs()
            val safeName = sanitizeFileName(args.fileName)
            val file = File(dir, safeName)
            file.writeText(args.contents, Charsets.UTF_8)
            val uri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                file,
            )
            val send = Intent(Intent.ACTION_SEND).apply {
                type = args.mimeType.ifBlank { "text/plain" }
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, safeName)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData = android.content.ClipData.newRawUri(safeName, uri)
            }
            val chooser = Intent.createChooser(send, null).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(chooser)
            invoke.resolveObject(true)
        } catch (e: Exception) {
            Log.e(TAG, "shareTextFile failed: ${e.message}")
            invoke.reject(e.message ?: "share failed")
        }
    }

    /**
     * Saves text content to a user-chosen location via ACTION_CREATE_DOCUMENT.
     * The user can pick Downloads, a cloud provider, etc. Resolves true when
     * written, false when the user cancels.
     */
    @Command
    fun saveTextFile(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(TextFileArgs::class.java)
            pendingSaveText = args.contents
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = args.mimeType.ifBlank { "text/plain" }
                putExtra(Intent.EXTRA_TITLE, sanitizeFileName(args.fileName))
            }
            startActivityForResult(invoke, intent, "saveTextFileResult")
        } catch (e: Exception) {
            pendingSaveText = null
            Log.e(TAG, "saveTextFile failed: ${e.message}")
            invoke.reject(e.message ?: "save failed")
        }
    }

    @ActivityCallback
    fun saveTextFileResult(invoke: Invoke, result: ActivityResult) {
        val contents = pendingSaveText
        pendingSaveText = null
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.resolveObject(false)
            return
        }
        val uri: Uri? = result.data?.data
        if (uri == null || contents == null) {
            invoke.resolveObject(false)
            return
        }
        Thread {
            val ok = runCatching {
                activity.contentResolver.openOutputStream(uri, "wt")?.use { out ->
                    out.write(contents.toByteArray(Charsets.UTF_8))
                } ?: error("cannot open output stream")
                true
            }.onFailure { Log.e(TAG, "saveTextFile write failed: ${it.message}") }
                .getOrDefault(false)
            invoke.resolveObject(ok)
        }.start()
    }

    private fun sanitizeFileName(name: String): String {
        val clean = name.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1F]"), "_").trim()
        return if (clean.isEmpty()) "export.txt" else clean
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
    class HapticArgs {
        var kind: String = "tap"
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

    @InvokeArg
    class TextFileArgs {
        lateinit var contents: String
        lateinit var fileName: String
        var mimeType: String = "text/plain"
    }

    private companion object {
        const val TAG = "XbondPlugin"
        const val PREFS_UI = "xbond_ui_preferences"
    }
}
