package net.xbond.client

import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log

/**
 * XBond Android VpnService implementation.
 *
 * Integrates with gomobile-generated `mobile.TunnelService` by providing
 * the TUN interface file descriptor and Android `protect(socket)` anti-loopback calls.
 */
class XBondVpnService : VpnService() {

    private var vpnInterface: ParcelFileDescriptor? = null
    private var tunnelService: Any? = null // mobile.TunnelService once bound

    companion object {
        const val TAG = "XBondVpnService"
        const val ACTION_START = "net.xbond.client.START"
        const val ACTION_STOP = "net.xbond.client.STOP"
        const val EXTRA_CONFIG = "config"
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val config = intent.getStringExtra(EXTRA_CONFIG) ?: ""
                startTunnel(config)
            }
            ACTION_STOP -> {
                stopTunnel()
            }
        }
        return START_NOT_STICKY
    }

    private fun startTunnel(config: String) {
        try {
            val builder = Builder()
                .setSession("XBond")
                .setMtu(1500)
                .addAddress("172.19.0.1", 30)
                .addDnsServer("172.19.0.2")
                .addRoute("0.0.0.0", 0)

            val pfd = builder.establish() ?: run {
                Log.e(TAG, "Failed to establish VPN interface")
                return
            }

            vpnInterface = pfd
            val fd = pfd.fd
            Log.i(TAG, "Established VPN interface with fd=$fd")
        } catch (e: Exception) {
            Log.e(TAG, "Error starting VPN tunnel: ${e.message}", e)
        }
    }

    private fun stopTunnel() {
        try {
            vpnInterface?.close()
            vpnInterface = null
            stopSelf()
            Log.i(TAG, "VPN tunnel stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping VPN tunnel: ${e.message}", e)
        }
    }

    override fun onRevoke() {
        Log.i(TAG, "VPN permission revoked by user or system")
        stopTunnel()
        super.onRevoke()
    }

    override fun onDestroy() {
        stopTunnel()
        super.onDestroy()
    }
}
