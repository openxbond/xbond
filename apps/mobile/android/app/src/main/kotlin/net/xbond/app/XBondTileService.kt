package net.xbond.app

import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Android Quick Settings Tile: allows the user to quickly connect or
 * disconnect the XBond VPN directly from the system notification shade
 * without opening the full UI.
 */
class XBondTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        updateTileState()
    }

    override fun onClick() {
        super.onClick()
        val tile = qsTile ?: return
        if (tile.state == Tile.STATE_ACTIVE) {
            // Disconnect VPN
            startService(
                Intent(this, XBondVpnService::class.java)
                    .setAction(XBondVpnService.ACTION_STOP),
            )
            tile.state = Tile.STATE_INACTIVE
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                tile.subtitle = "Disconnected"
            }
            tile.updateTile()
        } else {
            // Check if VPN permission has been granted
            if (XBondVpnService.prepare(this) == null) {
                startService(
                    Intent(this, XBondVpnService::class.java)
                        .setAction(XBondVpnService.ACTION_START),
                )
                tile.state = Tile.STATE_ACTIVE
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    tile.subtitle = "Connected"
                }
                tile.updateTile()
            } else {
                // Needs user consent: bring MainActivity to front
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
        }
    }

    private fun updateTileState() {
        val tile = qsTile ?: return
        val status = XBondVpnService.statusJSON()
        val isRunning = status?.contains("\"running\":true") == true
        tile.state = if (isRunning) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = if (isRunning) "Connected" else "Disconnected"
        }
        tile.updateTile()
    }
}
