package net.xbond.app

import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Android Quick Settings tile: drives the tunnel through the in-process
 * LocalAPI exactly like the shared web UI does. Nothing here knows about
 * subscriptions or nodes; the tile flips states only from what the core
 * actually reports — a tap never claims a state the core has not confirmed.
 *
 * Connect flow: make sure the VPN service (which owns the TunnelService and
 * its LocalAPI) is alive, wait for the addr/token pair the server writes on
 * construction, then POST /up with the token. The Go side runs the real
 * runtime apply; when VPN consent is missing the bridge raises the system
 * dialog and /up answers 409 — the user resolves it in the app and taps the
 * tile again. Disconnect: POST /down, which tears the tunnel down while the
 * service (and the UI host's origin) stays alive, per the layering contract.
 */
class XBondTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        updateTileState()
    }

    override fun onClick() {
        super.onClick()
        if (isTunnelRunning()) {
            driveAsync("/localapi/v0/down")
            return
        }
        // No consent yet: the system dialog cannot be answered well from the
        // shade, so hand the user to the app, which drives consent on boot.
        if (XBondVpnService.prepare(this) != null) {
            openMainActivity()
            return
        }
        driveAsync("/localapi/v0/up")
    }

    private fun openMainActivity() {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val pendingIntent = android.app.PendingIntent.getActivity(
                this,
                0,
                intent,
                android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            startActivityAndCollapse(pendingIntent)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    /** Runs the LocalAPI call off the main thread (TileService callbacks run
     * on main; NetworkOnMainThreadException otherwise), making sure the
     * in-process server exists, then refreshes the tile from the real core
     * state afterwards — never from the call's promise. */
    private fun driveAsync(path: String) {
        Thread {
            val endpoint = ensureLocalAPIEndpoint()
            if (endpoint != null) {
                postLocalAPI(endpoint, path)
            }
            requestListeningState()
        }.start()
    }

    /** Returns the loopback endpoint of the in-process LocalAPI, starting the
     * VPN service if the process (and with it the server) is gone. A dead
     * service leaves a stale addr/token pair behind; a live one keeps its
     * pair current, so stale files are only dropped in the dead case. */
    private fun ensureLocalAPIEndpoint(): Pair<String, String>? {
        if (XBondVpnService.statusJSON() == null) {
            File(filesDir, "localapi.addr").delete()
            File(filesDir, "localapi.token").delete()
            startService(
                Intent(this, XBondVpnService::class.java)
                    .setAction(XBondVpnService.ACTION_ENSURE),
            )
            if (!waitForLocalAPIFiles()) return null
        }
        val addr = runCatching { File(filesDir, "localapi.addr").readText().trim() }.getOrNull()
        val token = runCatching { File(filesDir, "localapi.token").readText().trim() }.getOrNull()
        if (addr.isNullOrBlank() || token.isNullOrBlank()) return null
        val port = addr.substringAfterLast(':')
        if (port.isEmpty()) return null
        return port to token
    }

    /** Waits for the fresh addr/token pair (MainActivity waits the same way
     * on boot). Returns true when both files are readable. */
    private fun waitForLocalAPIFiles(): Boolean {
        repeat(20) {
            val addr = runCatching { File(filesDir, "localapi.addr").readText() }.getOrNull()
            val token = runCatching { File(filesDir, "localapi.token").readText() }.getOrNull()
            if (!addr.isNullOrBlank() && !token.isNullOrBlank()) return true
            runCatching { Thread.sleep(250) }
        }
        return false
    }

    /** One POST to the LocalAPI. The addr file is written after the listener
     * is bound (the kernel backlog accepts before Serve), so a single attempt
     * suffices; failures surface as an unchanged tile state. */
    private fun postLocalAPI(endpoint: Pair<String, String>, path: String) {
        try {
            val connection = (URL("http://127.0.0.1:${endpoint.first}$path").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 3_000
                readTimeout = 30_000
                doOutput = true
                setRequestProperty("X-XBond-Token", endpoint.second)
            }
            val status = connection.responseCode
            connection.disconnect()
            Log.i(TAG, "LocalAPI $path -> $status")
        } catch (e: Exception) {
            Log.e(TAG, "LocalAPI $path failed: ${e.message}")
        }
    }

    private fun requestListeningState() {
        runCatching {
            TileService.requestListeningState(
                this,
                ComponentName(this, XBondTileService::class.java),
            )
        }
    }

    private fun isTunnelRunning(): Boolean {
        val status = XBondVpnService.statusJSON() ?: return false
        // MobileStatusOutput 的頂層 running 字段（state==StateConnected 且核心
        // IsRunning）；不用子串嗅探，JSON 形狀變化不該左右磁貼狀態。
        return runCatching {
            org.json.JSONObject(status).optBoolean("running", false)
        }.getOrDefault(false)
    }

    private fun updateTileState() {
        val tile = qsTile ?: return
        val running = isTunnelRunning()
        tile.state = if (running) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = getString(
                if (running) R.string.tile_connected else R.string.tile_disconnected,
            )
        }
        tile.updateTile()
    }

    private companion object {
        const val TAG = "XBondTileService"
    }
}
