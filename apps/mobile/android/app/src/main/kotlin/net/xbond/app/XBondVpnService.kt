package net.xbond.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.annotation.StringRes
import java.io.File
import mobile.TunnelService

/**
 * XBond Android VpnService: owns the TUN interface and hands its file
 * descriptor to the gomobile `mobile.TunnelService`, which runs the dual-
 * core engine (mihomo primary, sing-box secondary, picked by subscription
 * format) in userspace over that descriptor.
 *
 * Layering contract (docs/specs/mobile-android.md):
 *  - The platform side owns prepare/permission, the builder (address, routes,
 *    per-app split), the foreground notification, and protect() — supplied to
 *    Go through [mobile.PlatformBridge].
 *  - The Go side owns the core lifecycle, derivation, and the controller
 *    endpoint. [TunnelService.start] receives the descriptor and never
 *    returns it; only [stopAndShutdown] closes the interface.
 *  - The fd stays valid across subscription reloads ([TunnelService.reload]
 *    restarts only the core), so content updates never bounce the VPN.
 *
 * This file needs the gomobile AAR (`pnpm mobile:bind:android` →
 * xbond-mobile.aar) on the app's compile classpath; it cannot compile
 * standalone. Real-device acceptance (prepare prompt, sleep/network
 * switches, Always-On) is a separate mobile slice.
 */
class XBondVpnService : VpnService() {

    private var vpnInterface: ParcelFileDescriptor? = null
    private var tunnel: TunnelService? = null
    private var lastConfig: String = ""
    private var lastDisallowed: Array<String> = emptyArray()
    private var lastAllowed: Array<String> = emptyArray()

    companion object {
        var active: XBondVpnService? = null
            private set

        /** Latest Go-side status JSON, or null while no service runs. */
        fun statusJSON(): String? = active?.statusJSONInternal()

        /**
         * Rebuilds the running tunnel over the freshly saved per-app config;
         * a no-op when the tunnel is down (the next connect reads it). Safe
         * to call from the JS bridge on the main thread — the rebuild runs
         * on its own worker.
         */
        fun reloadIfConnected() {
            val service = active ?: return
            Thread { service.rebuildInterfaceForSplitTunnel() }.start()
        }

        const val TAG = "XBondVpnService"
        const val ACTION_START = "net.xbond.app.START"
        const val ACTION_STOP = "net.xbond.app.STOP"
        /** Starts the service without touching the tunnel: the UI host keeps
         * the TunnelService (and its in-process LocalAPI) alive. */
        const val ACTION_ENSURE = "net.xbond.app.ENSURE"
        const val EXTRA_CONFIG = "config"
        /** Package names excluded from the VPN (split tunneling). */
        const val EXTRA_DISALLOWED = "disallowedPackages"
        /** When non-empty, ONLY these packages ride the VPN. */
        const val EXTRA_ALLOWED = "allowedPackages"
        const val NOTIFICATION_ID = 1
        const val CHANNEL_ID = "xbond_vpn"

        /**
         * Permission contract for the future UI activity: returns the
         * intent to launch when the user must confirm VPN permission
         * (non-null means "ask first"), null once prepared.
         */
        fun prepare(context: android.content.Context): Intent? =
            VpnService.prepare(context)
    }

    private val localBinder = LocalBinder()

    inner class LocalBinder : Binder() {
        fun getService(): XBondVpnService = this@XBondVpnService
    }

    override fun onBind(intent: Intent?): IBinder? {
        if (intent?.action == SERVICE_INTERFACE) {
            return super.onBind(intent)
        }
        return localBinder
    }

    fun ensureDiscoveryFiles() {
        val t = tunnel ?: return
        val port = t.localAPIPort()
        val token = t.localAPIToken()
        if (port > 0 && token.isNotEmpty()) {
            runCatching {
                File(filesDir, "localapi.addr").writeText("127.0.0.1:$port")
                File(filesDir, "localapi.token").writeText(token)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        active = this
        tunnel = TunnelService(PlatformBridgeImpl(), LogListener())
        ensureDiscoveryFiles()
    }

    private fun statusJSONInternal(): String? = try {
        tunnel?.getStatusJSON()
    } catch (e: Exception) {
        null
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                lastConfig = intent.getStringExtra(EXTRA_CONFIG) ?: lastConfig
                lastDisallowed =
                    intent.getStringArrayExtra(EXTRA_DISALLOWED) ?: lastDisallowed
                lastAllowed =
                    intent.getStringArrayExtra(EXTRA_ALLOWED) ?: lastAllowed
                startTunnel()
            }
            ACTION_STOP -> stopAndShutdown()
            ACTION_ENSURE -> {
                ensureDiscoveryFiles()
            }
            // START_STICKY restart after process death redelivers a null
            // intent. Nothing in-tree pushes EXTRA_CONFIG, so lastConfig is
            // always empty and the tunnel is not re-established here: the
            // service (and its LocalAPI) comes back, and the UI or the tile
            // re-establishes the tunnel through /up.
            null -> {
                ensureDiscoveryFiles()
                if (lastConfig.isNotEmpty()) startTunnel()
            }
        }
        return START_STICKY
    }

    private fun startTunnel() {
        if (lastConfig.isEmpty()) {
            Log.e(TAG, "START without configuration; ignoring")
            stopSelf()
            return
        }
        // Re-START with new content is a config swap: tear the previous
        // tunnel down first instead of double-establishing (the core would
        // reject the second start and the catch would tear down everything).
        runCatching { tunnel?.stop() }
        vpnInterface?.close()
        vpnInterface = null
        try {
            goForeground(R.string.notification_establishing)

            val pfd = buildVpnInterface() ?: run {
                Log.e(TAG, "Failed to establish VPN interface (not prepared?)")
                goForeground(R.string.notification_needs_permission)
                return
            }

            vpnInterface = pfd
            // Hand the core a dup of the descriptor: sing-tun closes the fd
            // it adopts when the core stops, while the platform side keeps
            // the original — closing vpnInterface destroys the interface on
            // every teardown path without ever double-closing (fdsan aborts
            // the process on a same-fd double close).
            val coreFd = ParcelFileDescriptor.dup(pfd.fileDescriptor).detachFd()
            Log.i(TAG, "Established VPN interface with fd=${pfd.fd} (core dup=$coreFd)")

            tunnel?.start(lastConfig, coreFd)
            goForeground(R.string.notification_active)
            Log.i(TAG, "Core started over core dup fd=$coreFd")
        } catch (e: Exception) {
            Log.e(TAG, "Error starting VPN tunnel: ${e.message}", e)
            tunnel?.stop()
            vpnInterface?.close()
            vpnInterface = null
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    /** Shared VPN builder: address, DNS, routes and the per-app split. */
    private fun buildVpnInterface(): ParcelFileDescriptor? {
        val builder = Builder()
            .setSession("XBond")
            .setMtu(1500)
            .addAddress("172.19.0.1", 30)
            // mihomo binds its in-tunnel DNS server on the first address of
            // the fake-ip segment (198.18.0.1/30, derived from
            // dns.fake-ip-range) and its IPv6 counterpart (fdfe:dcba:9876::1);
            // both must exist on the interface or the TUN listener fails and
            // the core silently runs mixed-only.
            .addAddress("198.18.0.1", 30)
            .addAddress("fdfe:dcba:9876::1", 126)
            .addDnsServer("172.19.0.2")
            .addRoute("0.0.0.0", 0)
        applySplitTunnel(builder)
        return builder.establish()
    }

    /**
     * Split tunneling: an explicit Intent override wins (start action with
     * extras), otherwise the per-app config the user saved in the UI. The
     * app itself is ALWAYS excluded from the tunnel — its own sockets (core
     * out-bound dial, update downloads, cloud sync) must take the physical
     * network, otherwise they loop back into the core (self-DNS recursion,
     * dead dial). Individual adds are guarded — a stale package name must
     * never fail the whole establish().
     */
    private fun applySplitTunnel(builder: Builder) {
        if (lastAllowed.isNotEmpty()) {
            for (pkg in lastAllowed) {
                if (pkg != packageName) runCatching { builder.addAllowedApplication(pkg) }
            }
            return
        }
        if (lastDisallowed.isNotEmpty()) {
            runCatching { builder.addDisallowedApplication(packageName) }
            for (pkg in lastDisallowed) runCatching { builder.addDisallowedApplication(pkg) }
            return
        }
        val (mode, packages) = SplitTunnelPrefs.read(this)
        when (mode) {
            SplitTunnelPrefs.MODE_ALLOW -> {
                if (packages.isEmpty()) return
                // Android VpnService.Builder: addAllowedApplication and addDisallowedApplication are mutually exclusive.
                // In allowlist mode, anything not added is automatically excluded, including packageName itself.
                for (pkg in packages) {
                    if (pkg != packageName) runCatching { builder.addAllowedApplication(pkg) }
                }
            }
            SplitTunnelPrefs.MODE_DISALLOW -> {
                runCatching { builder.addDisallowedApplication(packageName) }
                for (pkg in packages) runCatching { builder.addDisallowedApplication(pkg) }
            }
            else -> {
                runCatching { builder.addDisallowedApplication(packageName) }
            }
        }
    }

    /**
     * Live per-app config swap while the tunnel runs: establish the new
     * interface first (keeping the old tunnel up on failure), then stop the
     * core, swap the interface and re-apply through the same runtime path
     * LocalAPI /up uses. The system VPN icon never leaves the shade.
     */
    private fun rebuildInterfaceForSplitTunnel() {
        synchronized(this) {
            if (vpnInterface == null) return
            try {
                val newPfd = buildVpnInterface()
                if (newPfd == null) {
                    Log.e(TAG, "Split-tunnel reload failed to establish a new interface; keeping the old one")
                    return
                }
                runCatching { tunnel?.stop() }
                vpnInterface?.close()
                vpnInterface = newPfd
                val coreFd = ParcelFileDescriptor.dup(newPfd.fileDescriptor).detachFd()
                tunnel?.startActive(coreFd)
                goForeground(R.string.notification_active)
                Log.i(TAG, "Split-tunnel reload rebuilt the interface (fd=${newPfd.fd})")
            } catch (e: Exception) {
                // 舊接口已關、新核心沒起來：不再維持「active」的假象，收斂到
                // 乾淨的斷開態，通知與磁貼如實回退——用戶從 UI 或磁貼再連。
                Log.e(TAG, "Split-tunnel reload failed: ${e.message}", e)
                stopTunnelResources()
            }
        }
    }

    private fun stopAndShutdown() {
        stopTunnelResources()
        stopSelf()
        Log.i(TAG, "VPN tunnel stopped")
    }

    private fun stopTunnelResources() {
        try {
            // Order matters: stop the core first (it reads from the fd),
            // then close the descriptor.
            tunnel?.stop()
        } catch (e: Exception) {
            Log.e(TAG, "Core stop failed: ${e.message}", e)
        }
        try {
            vpnInterface?.close()
            vpnInterface = null
        } catch (e: Exception) {
            Log.e(TAG, "Interface close failed: ${e.message}", e)
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        runCatching {
            android.service.quicksettings.TileService.requestListeningState(
                this,
                android.content.ComponentName(this, XBondTileService::class.java),
            )
        }
    }

    private fun goForeground(
        @StringRes message: Int,
    ) {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "XBond VPN",
                NotificationManager.IMPORTANCE_LOW,
            )
            manager.createNotificationChannel(channel)
        }

        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stopIntent = PendingIntent.getService(
            this,
            0,
            Intent(this, XBondVpnService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val disconnectAction = Notification.Action.Builder(
            android.R.drawable.ic_menu_close_clear_cancel,
            getString(R.string.notification_disconnect),
            stopIntent,
        ).build()

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val notification: Notification = builder
            .setContentTitle("XBond")
            .setContentText(getString(message))
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(openIntent)
            .addAction(disconnectAction)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        runCatching {
            android.service.quicksettings.TileService.requestListeningState(
                this,
                android.content.ComponentName(this, XBondTileService::class.java),
            )
        }
    }

    override fun onRevoke() {
        // Permission revoked by the user or another VPN took over: full
        // teardown, and the sticky restart must not resurrect without
        // permission.
        lastConfig = ""
        stopAndShutdown()
        super.onRevoke()
    }

    override fun onDestroy() {
        try {
            tunnel?.stop()
        } finally {
            vpnInterface?.close()
            vpnInterface = null
            active = null
        }
        super.onDestroy()
    }

    /** Bridges Go core callbacks onto this service's protect()/notifications. */
    private inner class PlatformBridgeImpl : mobile.PlatformBridge {
        override fun dataDir(): String = filesDir.absolutePath

        // gomobile maps Go (int32, error) to a Java (int, throws Exception)
        // method: protect failures surface as exceptions to the core.
        override fun protectSocket(fd: Int) {
            if (!protect(fd)) {
                throw Exception("protect(socket) was rejected")
            }
        }

        override fun onStateChanged(state: Int, message: String?) {
            Log.i(TAG, "core state $state: ${message ?: ""}")
        }

        override fun onTraffic(uploadBytes: Long, downloadBytes: Long) {
            // Surface usage through the notification in the app slice; the
            // service only needs the callback wired for gomobile.
        }

        // Account OAuth: the Go side hands the auth URL here, the platform
        // browser takes over (RFC 8252 loopback callback lands on this
        // device, where the embedded listener catches it).
        override fun openURL(url: String?) {
            val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            this@XBondVpnService.startActivity(intent)
        }

        // LocalAPI /up: establish the VPN here and hand the fd to the Go
        // runtime apply. Runs on a JNI thread; consent (VpnService.prepare)
        // is the caller's problem — when it is needed this throws and the
        // LocalAPI answers 409, and the UI slice drives the interactive flow.
        override fun requestConnect() {
            // Mirrors the Go mobile package's StateConnected (not exported by
            // gomobile): getState() 2 = connected, and /up is idempotent then.
            if (tunnel?.getState() == 2) {
                return
            }
            val consent = VpnService.prepare(this@XBondVpnService)
            if (consent != null) {
                // Bring the system dialog up right over the app: the LocalAPI
                // answers 409 and the user resolves the dialog, then simply
                // taps Connect again.
                consent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                this@XBondVpnService.startActivity(consent)
                throw Exception("VPN consent required")
            }
            goForeground(R.string.notification_establishing)

            // 重連可能是 rebuildInterfaceForSplitTunnel 失敗留下的半啓動狀態：
            // 先按 startTunnel 的換序拆掉舊隧道與接口，避免覆寫 vpnInterface
            // 時把舊 fd 和舊接口整個漏掉。
            runCatching { tunnel?.stop() }
            vpnInterface?.close()
            vpnInterface = null

            val pfd = buildVpnInterface() ?: run {
                throw Exception("Failed to establish VPN interface (not prepared?)")
            }
            vpnInterface = pfd
            // Ownership split (see startTunnel): the core gets a dup it may
            // close; the original stays ours and its close destroys the
            // interface on every teardown path.
            val coreFd = ParcelFileDescriptor.dup(pfd.fileDescriptor).detachFd()
            Log.i(TAG, "Established VPN interface with fd=${pfd.fd} (core dup=$coreFd)")

            tunnel?.startActive(coreFd)
            goForeground(R.string.notification_active)
            Log.i(TAG, "Core started over core dup fd=$coreFd")
        }

        // LocalAPI /down: the tunnel and interface go away; the service
        // itself stays (the UI host keeps the LocalAPI alive).
        override fun requestDisconnect() {
            stopTunnelResources()
        }
    }

    private inner class LogListener : mobile.StatusListener {
        override fun onLog(level: String?, message: String?) {
            Log.d(TAG, "[${level ?: "log"}] ${message ?: ""}")
        }
    }
}
