package net.xbond.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Minimal control surface for the emulator slice: config in a text field,
 * prepare-then-start, live status from the running TunnelService. The full
 * React screen (subscription management, policy groups, three-tier status)
 * is a later slice — this exists to compile the VPN layer and make its
 * behavior observable on a device or emulator.
 *
 * Headless smoke entry: `am start -e configB64 <base64 clash/sing-box JSON>`
 * starts the tunnel immediately (VPN consent must already be granted, e.g.
 * via `adb shell cmd appops set net.xbond.app ACTIVATE_VPN allow`).
 */
class MainActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var configInput: EditText
    private lateinit var statusView: TextView

    private val pollStatus = object : Runnable {
        override fun run() {
            statusView.text = XBondVpnService.statusJSON() ?: "service not started"
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val padding = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
        }
        configInput = EditText(this).apply {
            setText(DEFAULT_SMOKE_CONFIG)
            minLines = 6
        }
        root.addView(configInput)
        root.addView(
            Button(this).apply {
                text = "Connect"
                setOnClickListener { connectAndStart() }
            },
        )
        root.addView(
            Button(this).apply {
                text = "Disconnect"
                setOnClickListener { stopTunnel() }
            },
        )
        statusView = TextView(this).apply { setTextIsSelectable(true) }
        root.addView(statusView)
        setContentView(root)

        // Headless smoke path: config delivered as base64 via launch intent,
        // optional egress probe fetched through the tunnel once connected.
        intent?.getStringExtra("configB64")?.let { encoded ->
            try {
                val decoded = String(
                    android.util.Base64.decode(encoded, android.util.Base64.DEFAULT),
                    Charsets.UTF_8,
                )
                configInput.setText(decoded)
                connectAndStart()
            } catch (e: IllegalArgumentException) {
                statusView.text = "invalid configB64: ${e.message}"
            }
        }
        intent?.getStringExtra("probeUrl")?.let { url ->
            Thread {
                // The app's own sockets ride the VPN into the core, so this
                // fetch is a true data-plane check: TUN -> core -> DIRECT.
                for (attempt in 1..6) {
                    Thread.sleep(2000)
                    try {
                        val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                        conn.connectTimeout = 8000
                        conn.readTimeout = 8000
                        val code = conn.responseCode
                        conn.disconnect()
                        android.util.Log.i("XBondProbe", "PROBE $url -> $code")
                        if (code > 0) break
                    } catch (e: Exception) {
                        android.util.Log.i("XBondProbe", "PROBE attempt $attempt failed: ${e.message}")
                    }
                }
            }.start()
        }
        handler.post(pollStatus)
    }

    private fun connectAndStart() {
        val config = configInput.text.toString()
        val prepare = XBondVpnService.prepare(this)
        if (prepare != null) {
            statusView.text = "waiting for VPN consent…"
            startActivityForResult(prepare, REQUEST_CONSENT)
            return
        }
        startTunnel(config)
    }

    private fun startTunnel(config: String) {
        val intent = Intent(this, XBondVpnService::class.java).apply {
            action = XBondVpnService.ACTION_START
            putExtra(XBondVpnService.EXTRA_CONFIG, config)
        }
        startForegroundService(intent)
    }

    private fun stopTunnel() {
        startService(
            Intent(this, XBondVpnService::class.java).apply {
                action = XBondVpnService.ACTION_STOP
            },
        )
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CONSENT && resultCode == RESULT_OK) {
            startTunnel(configInput.text.toString())
        } else if (requestCode == REQUEST_CONSENT) {
            statusView.text = "VPN consent denied"
        }
    }

    override fun onResume() {
        super.onResume()
        handler.post(pollStatus)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(pollStatus)
    }

    private companion object {
        const val REQUEST_CONSENT = 1

        // Loopback-reachable fixture for emulator smokes: the core starts,
        // the tunnel carries traffic, no real nodes are contacted.
        val DEFAULT_SMOKE_CONFIG = """
proxies:
  - name: smoke-edge
    type: trojan
    server: 127.0.0.1
    port: 443
    password: smoke-only
proxy-groups:
  - name: proxy-group
    type: select
    proxies: [smoke-edge]
rules:
  - MATCH,proxy-group
""".trim()
    }
}
