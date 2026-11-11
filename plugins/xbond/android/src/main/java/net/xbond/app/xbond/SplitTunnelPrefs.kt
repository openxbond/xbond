package net.xbond.app.xbond

import android.content.Context
import android.content.pm.ApplicationInfo

/**
 * Per-app VPN (split tunneling) persistence: the mode and the selected
 * package set live in SharedPreferences. XBondVpnService reads them every
 * time it builds the interface; the web UI edits them through the
 * MainActivity JS bridge, which triggers a live interface rebuild while the
 * tunnel runs.
 *
 * Modes:
 *  - [MODE_ALL]: every app rides the VPN (no allow/disallow calls).
 *  - [MODE_DISALLOW]: blacklist — the selected apps bypass the VPN.
 *  - [MODE_ALLOW]: whitelist — only the selected apps ride the VPN.
 */
object SplitTunnelPrefs {

    const val MODE_ALL = "all"
    const val MODE_DISALLOW = "disallow"
    const val MODE_ALLOW = "allow"

    private const val PREFS = "xbond_vpn_prefs"
    private const val KEY_MODE = "mode"
    private const val KEY_PACKAGES = "packages"

    /** Reads the saved config: (mode, packages). Defaults to MODE_ALL. */
    fun read(context: Context): Pair<String, Set<String>> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val mode = prefs.getString(KEY_MODE, MODE_ALL) ?: MODE_ALL
        val packages = prefs.getStringSet(KEY_PACKAGES, emptySet()) ?: emptySet()
        return mode to packages
    }

    fun write(context: Context, mode: String, packages: Set<String>) {
        val normalizedMode = when (mode) {
            MODE_ALLOW, MODE_DISALLOW -> mode
            else -> MODE_ALL
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_MODE, normalizedMode)
            .putStringSet(KEY_PACKAGES, packages)
            .apply()
    }

    /**
     * Installed apps for the per-app picker: user-visible label, package
     * name, system-app flag. The VPN app itself and packages without the
     * INTERNET permission (keyboards, launchers' resource packs) never route
     * through the tunnel and are excluded. Sorted by label for the list UI.
     */
    fun listInstalledApps(context: Context): List<Map<String, Any>> {
        val pm = context.packageManager
        val selfPackage = context.packageName
        val items = mutableListOf<Triple<String, String, Boolean>>()
        for (info in pm.getInstalledApplications(0)) {
            if (info.packageName == selfPackage) continue
            if (pm.checkPermission("android.permission.INTERNET", info.packageName) !=
                android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                continue
            }
            val label = runCatching { info.loadLabel(pm).toString() }.getOrNull()
                ?: info.packageName
            items.add(Triple(label, info.packageName, isSystemApp(info)))
        }
        items.sortWith(compareBy({ it.third }, { it.first.lowercase() }))
        return items.map { (label, pkg, system) ->
            mapOf("label" to label, "packageName" to pkg, "isSystem" to system)
        }
    }

    private fun isSystemApp(info: ApplicationInfo): Boolean =
        (info.flags and ApplicationInfo.FLAG_SYSTEM) != 0
}
