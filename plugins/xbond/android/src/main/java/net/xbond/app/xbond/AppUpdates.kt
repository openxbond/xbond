package net.xbond.app.xbond

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.widget.Toast
import androidx.core.content.FileProvider
import mobile.Mobile
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

internal class AppUpdates(private val activity: Activity) {
    private val executor = Executors.newSingleThreadExecutor()
    private val prefs = activity.getSharedPreferences("app-updates", Activity.MODE_PRIVATE)
    private var busy = false
    private var closed = false
    private var pendingInstall: File? = null

    /** The installed app's versionCode (the release build number contract,
     * major*10000+minor*100+patch); the plugin library's own BuildConfig
     * version does not track the app. */
    private val versionCode: Long
        get() = runCatching {
            @Suppress("DEPRECATION")
            val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
            if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
        }.getOrDefault(0L)

    fun checkInBackground() {
        if (BuildConfig.RELEASE_PUBLIC_KEY.isEmpty()) return
        val now = System.currentTimeMillis()
        val last = prefs.getLong("lastCheck", 0)
        if (now - last in 0 until DAY_MS) return
        prefs.edit().putLong("lastCheck", now).apply()
        check(manual = false)
    }

    fun check(manual: Boolean) {
        if (BuildConfig.RELEASE_PUBLIC_KEY.isEmpty()) {
            if (manual) message(R.string.update_development)
            return
        }
        if (busy || closed) return
        if (manual) message(R.string.update_checking)
        work(manual, ::findUpdate) success@{ update ->
            if (update == null) {
                if (manual) message(R.string.update_current)
                return@success
            }
            AlertDialog.Builder(activity)
                .setTitle(activity.getString(R.string.update_available, update.version))
                .setMessage(update.notes.take(4000).ifBlank { activity.getString(R.string.update_confirm) })
                .setNegativeButton(android.R.string.cancel, null)
                .setPositiveButton(R.string.update_download) { _, _ -> download(update) }
                .show()
        }
    }

    private fun download(update: Release) {
        if (busy || closed) return
        message(R.string.update_downloading)
        work(true, { fetchApk(update) }, ::openInstaller)
    }

    private fun openInstaller(apk: File) {
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            pendingInstall = apk
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
            // No startActivityForResult from a plugin: the consent screen
            // returns through onActivityResumed, which continues the install.
            if (runCatching { activity.startActivity(intent) }.isFailure) {
                pendingInstall = null
                message(R.string.update_failed)
            }
            return
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", apk)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (runCatching { activity.startActivity(intent) }.isFailure) message(R.string.update_failed)
    }

    /** The unknown-sources consent screen returns through onResume; continue
     * a pending install (or report the denial) exactly like the old activity
     * onActivityResult path did. */
    fun onActivityResumed() {
        val apk = pendingInstall ?: return
        pendingInstall = null
        if (Build.VERSION.SDK_INT >= 26 && activity.packageManager.canRequestPackageInstalls()) {
            openInstaller(apk)
        } else {
            message(R.string.update_permission_denied)
        }
    }

    fun close() {
        closed = true
        executor.shutdownNow()
    }

    private fun <T> work(manual: Boolean, job: () -> T, success: (T) -> Unit) {
        busy = true
        executor.execute {
            val result = runCatching(job)
            activity.runOnUiThread {
                busy = false
                if (closed || activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                result.onSuccess(success).onFailure { if (manual) message(R.string.update_failed) }
            }
        }
    }

    private fun message(resource: Int) {
        Toast.makeText(activity, resource, Toast.LENGTH_SHORT).show()
    }

    private fun findUpdate(): Release? {
        val envelope = read(MANIFEST_URL, emptySet()) { input ->
            JSONObject(input.readBounded(MAX_MANIFEST).toString(Charsets.UTF_8))
        }
        val payload = decode(envelope.getString("payload"))
        val signature = decode(envelope.getString("signature"))
        val publicKey = decode(BuildConfig.RELEASE_PUBLIC_KEY)
        require(Mobile.verifyReleaseSignature(payload, signature, publicKey))
        val release = JSONObject(payload.toString(Charsets.UTF_8))
        val version = release.getString("version")
        val build = release.getInt("build")
        val semver = SEMVER.matchEntire(version) ?: error("Invalid release version")
        val parts = semver.groupValues.drop(1).map { it.toInt() }
        require(parts.all { it <= 99 } && build == parts[0] * 10_000 + parts[1] * 100 + parts[2])
        if (build <= versionCode) return null

        val asset = release.getJSONObject("assets").getJSONObject("android-universal")
        val name = "xbond-android-v$version.apk"
        val url = "$RELEASES_URL/v$version/$name"
        require(asset.getString("name") == name && asset.getString("url") == url)
        val sha256 = asset.getString("sha256")
        require(sha256.matches(Regex("[0-9a-f]{64}")))
        return Release(version, build, release.optString("notes"), url, sha256)
    }

    private fun fetchApk(update: Release): File {
        val directory = File(activity.cacheDir, "updates")
        check(directory.isDirectory || directory.mkdirs())
        val part = File.createTempFile("download-", ".apk", directory)
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            read(update.url, ASSET_REDIRECTS) { input ->
                part.outputStream().buffered().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        check(total <= MAX_APK && !Thread.currentThread().isInterrupted)
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                }
            }
            require(digest.digest().hex() == update.sha256)
            verifyPackage(part, update)
            val apk = File(directory, "xbond-${update.build}.apk")
            check(part.renameTo(apk))
            directory.listFiles()?.filter { it != apk && it.name.startsWith("xbond-") }?.forEach { it.delete() }
            return apk
        } finally {
            part.delete()
        }
    }

    @Suppress("DEPRECATION")
    private fun verifyPackage(apk: File, update: Release) {
        val manager = activity.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        val installed = manager.getPackageInfo(activity.packageName, flags)
        val candidate = manager.getPackageArchiveInfo(apk.absolutePath, flags)
            ?: error("Invalid APK")
        require(candidate.packageName == installed.packageName && candidate.versionName == update.version)
        val version = if (Build.VERSION.SDK_INT >= 28) candidate.longVersionCode else candidate.versionCode.toLong()
        require(version == update.build.toLong())
        val expected = signers(installed)
        require(expected.isNotEmpty() && signers(candidate) == expected)
    }

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        return signatures.orEmpty().map {
            MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).hex()
        }.toSet()
    }

    private fun ByteArray.hex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun decode(encoded: String): ByteArray = Base64.decode(encoded, Base64.NO_WRAP)

    private fun InputStream.readBounded(limit: Int): ByteArray {
        // Android's native library supports API 24. Avoid newer InputStream APIs.
        val result = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = read(buffer)
            if (count < 0) return result.toByteArray()
            check(result.size() + count <= limit)
            result.write(buffer, 0, count)
        }
    }

    private fun <T> read(address: String, allowedRedirects: Set<String>, consume: (InputStream) -> T): T {
        var url = URL(address)
        repeat(5) {
            val connection = (url.openConnection() as HttpsURLConnection).apply {
                connectTimeout = 10_000
                readTimeout = 30_000
                instanceFollowRedirects = false
                useCaches = false
                setRequestProperty("Cache-Control", "no-cache")
            }
            try {
                val status = connection.responseCode
                if (status == 200) return connection.inputStream.buffered().use(consume)
                check(status in 300..399)
                val next = URL(url, connection.getHeaderField("Location") ?: error("Missing redirect"))
                check(next.protocol == "https" && next.userInfo == null && next.host in allowedRedirects)
                url = next
            } finally {
                connection.disconnect()
            }
        }
        error("Too many redirects")
    }

    private data class Release(val version: String, val build: Int, val notes: String, val url: String, val sha256: String)

    companion object {
        private const val DAY_MS = 86_400_000L
        private const val MAX_MANIFEST = 512 * 1024
        private const val MAX_APK = 512L * 1024 * 1024
        private const val MANIFEST_URL = "https://openxbond.github.io/xbond/release.json"
        private const val RELEASES_URL = "https://github.com/openxbond/xbond/releases/download"
        private val ASSET_REDIRECTS = setOf("release-assets.githubusercontent.com", "objects.githubusercontent.com")
        private val SEMVER = Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")
    }
}
