package net.xbond.app.xbond

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.system.Os
import android.util.Log
import java.net.NetworkInterface
import mobile.Mobile
import org.json.JSONArray
import org.json.JSONObject

/**
 * Feeds Android's active non-VPN network interfaces and default route to the Go
 * core via `Mobile.setPlatformNetworkInterfaces`. Android 14+ denies untrusted
 * apps netlink RTM_GETLINK so Go's `net.Interfaces()` comes back empty.
 *
 * Owned by [XBondVpnService] rather than the UI Activity so TileService starts
 * and background Wi-Fi <-> cellular handovers keep updating the core, and
 * `unregisterNetworkCallback` runs deterministically in `onDestroy()`.
 */
internal class AndroidNetworkMonitor(private val context: Context) {

    private val appContext = context.applicationContext

    // Request-style callbacks keep tracking the real underlying default network
    // even while our own VPN is active (unlike registerDefaultNetworkCallback,
    // which reports tun0 once VPN connects).
    private val networksRequest = NetworkRequest.Builder()
        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED)
        .build()

    @Volatile
    private var lastDefaultNetwork: Network? = null

    private var registered = false

    private val networksCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            lastDefaultNetwork = network
            pushSnapshot()
        }

        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) =
            pushSnapshot()

        override fun onLinkPropertiesChanged(network: Network, lp: android.net.LinkProperties) =
            pushSnapshot()

        override fun onLost(network: Network) {
            if (lastDefaultNetwork == network) lastDefaultNetwork = null
            pushSnapshot()
        }
    }

    @Synchronized
    fun start() {
        if (registered) return
        runCatching {
            val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
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
            registered = true
            pushSnapshot()
        }.onFailure { Log.w(TAG, "networks monitor unavailable: ${it.message}") }
    }

    @Synchronized
    fun stop() {
        if (!registered) return
        registered = false
        lastDefaultNetwork = null
        runCatching {
            val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return
            cm.unregisterNetworkCallback(networksCallback)
        }.onFailure { Log.w(TAG, "unregister networks monitor failed: ${it.message}") }
    }

    fun pushSnapshot() {
        runCatching {
            val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return
            @Suppress("DEPRECATION")
            val allNetworks = cm.allNetworks
            val entries = mutableListOf<Network>()
            for (network in allNetworks) {
                val caps = cm.getNetworkCapabilities(network) ?: continue
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
                val lp = cm.getLinkProperties(network) ?: continue
                if (lp.interfaceName == null) continue
                entries.add(network)
            }
            if (entries.isEmpty()) {
                // Push an empty array instead of returning early so Go clears
                // any stale default interface when connectivity drops.
                Mobile.setPlatformNetworkInterfaces("[]")
                return
            }

            val defaultNetwork: Network = lastDefaultNetwork?.takeIf { entries.contains(it) }
                ?: entries.first()

            val arr = JSONArray()
            entries.forEachIndexed { slot, network ->
                val caps = cm.getNetworkCapabilities(network) ?: return@forEachIndexed
                val lp = cm.getLinkProperties(network) ?: return@forEachIndexed
                val name = lp.interfaceName ?: return@forEachIndexed
                val jif = runCatching { NetworkInterface.getByName(name) }.getOrNull()

                val obj = JSONObject()
                obj.put("name", name)
                obj.put("index", resolveInterfaceIndex(jif, name, slot + 1))
                obj.put("mtu", jif?.mtu ?: lp.mtu)
                val addrs = JSONArray()
                if (jif != null) {
                    for (ia in jif.interfaceAddresses) {
                        val ip = ia.address.hostAddress?.substringBefore('%') ?: continue
                        addrs.put("$ip/${ia.networkPrefixLength}")
                    }
                } else {
                    for (la in lp.linkAddresses) {
                        val ip = la.address.hostAddress?.substringBefore('%') ?: continue
                        addrs.put("$ip/${la.prefixLength}")
                    }
                }
                obj.put("addresses", addrs)
                val flags = JSONArray()
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
                val dns = JSONArray()
                for (server in lp.dnsServers) {
                    server.hostAddress?.substringBefore('%')?.let { dns.put(it) }
                }
                obj.put("dns", dns)
                obj.put("metered", !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
                arr.put(obj)
            }
            Mobile.setPlatformNetworkInterfaces(arr.toString())
        }.onFailure { Log.w(TAG, "networks snapshot failed: ${it.message}") }
    }

    private fun resolveInterfaceIndex(jif: NetworkInterface?, name: String, fallback: Int): Int {
        jif?.index?.takeIf { it > 0 }?.let { return it }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val idx = runCatching { Os.if_nametoindex(name) }.getOrDefault(0)
            if (idx > 0) return idx
        }
        return fallback
    }

    private companion object {
        const val TAG = "AndroidNetworkMonitor"
    }
}
