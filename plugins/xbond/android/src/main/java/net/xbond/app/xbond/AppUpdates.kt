package net.xbond.app.xbond

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import mobile.Mobile
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import javax.net.ssl.HttpsURLConnection

internal class AppUpdates(private val activity: Activity) {
    private val executor = Executors.newSingleThreadExecutor()
    private val prefs = activity.getSharedPreferences("app-updates", Activity.MODE_PRIVATE)
    private var busy = false
    private var closed = false
    private var pendingInstall: File? = null
    private var progressView: ProgressDialogView? = null
    private var activeTask: Future<*>? = null
    @Volatile
    private var activeConnection: HttpsURLConnection? = null
    @Volatile
    private var downloadCancelled = false

    private class ProgressDialogView(
        val dialog: AlertDialog,
        val bar: ProgressBar,
        val status: TextView,
    )

    /** The installed app's versionCode (the release build number contract:
     * (major*10000+minor*100+patch)*100+99, so a stable release upgrades past
     * every rc.N candidate of the same base); the plugin library's own
     * BuildConfig version does not track the app. */
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
        if (closed) return
        if (busy) {
            if (manual) progressView?.dialog?.show()
            return
        }
        if (manual) message(R.string.update_checking)
        work(manual, ::findUpdate, { update ->
            if (update == null) {
                if (manual) message(R.string.update_current)
                return@work
            }
            AlertDialog.Builder(activity)
                .setTitle(activity.getString(R.string.update_available, update.version))
                .setMessage(update.notes.take(4000).ifBlank { activity.getString(R.string.update_confirm) })
                .setNegativeButton(android.R.string.cancel, null)
                .setPositiveButton(R.string.update_download) { _, _ -> download(update) }
                .show()
        })
    }

    private fun download(update: Release) {
        if (closed) return
        if (busy) {
            progressView?.dialog?.show()
            return
        }
        downloadCancelled = false
        showProgressDialog(update)
        work(
            manual = true,
            job = { fetchApk(update) },
            success = { apk ->
                dismissProgressDialog()
                openInstaller(apk)
            },
            failure = { error ->
                dismissProgressDialog()
                if (error !is CancellationException) {
                    message(R.string.update_failed)
                }
            },
        )
    }

    private fun showProgressDialog(update: Release) {
        dismissProgressDialog()
        val density = activity.resources.displayMetrics.density
        val padH = (24 * density).toInt()
        val padV = (16 * density).toInt()
        val gap = (10 * density).toInt()
        val bar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            max = 100
        }
        val status = TextView(activity).apply {
            text = activity.getString(R.string.update_downloading)
            setPadding(0, gap, 0, 0)
        }
        val container = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padH, padV, padH, padV / 2)
            addView(bar)
            addView(status)
        }
        val dialog = AlertDialog.Builder(activity)
            .setTitle(activity.getString(R.string.update_available, update.version))
            .setView(container)
            .setCancelable(false)
            .setNegativeButton(android.R.string.cancel) { _, _ -> cancelDownload() }
            .create()
        dialog.setCanceledOnTouchOutside(false)
        dialog.show()
        progressView = ProgressDialogView(dialog, bar, status)
    }

    private fun dismissProgressDialog() {
        runCatching { progressView?.dialog?.dismiss() }
        progressView = null
    }

    private fun cancelDownload() {
        downloadCancelled = true
        activeTask?.cancel(true)
        val conn = activeConnection
        if (conn != null) {
            Thread { runCatching { conn.disconnect() } }.start()
        }
        dismissProgressDialog()
    }

    private fun postProgress(received: Long, total: Long) {
        activity.runOnUiThread {
            val view = progressView ?: return@runOnUiThread
            if (total > 0) {
                val pct = ((received.coerceAtMost(total) * 100L) / total).toInt().coerceIn(0, 100)
                view.bar.isIndeterminate = false
                view.bar.progress = pct
            } else {
                view.bar.isIndeterminate = true
            }
            view.status.text = formatProgressText(received, total)
        }
    }

    private fun formatProgressText(received: Long, total: Long): String {
        val mib = 1024.0 * 1024.0
        return if (total > 0) {
            val clamped = received.coerceAtMost(total)
            val pct = ((clamped * 100L) / total).toInt().coerceIn(0, 100)
            String.format(Locale.US, "%.2f MiB / %.2f MiB (%d%%)", clamped / mib, total / mib, pct)
        } else if (received > 0) {
            String.format(Locale.US, "%.2f MiB", received / mib)
        } else {
            activity.getString(R.string.update_downloading)
        }
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
        downloadCancelled = true
        activeTask?.cancel(true)
        val conn = activeConnection
        if (conn != null) {
            Thread { runCatching { conn.disconnect() } }.start()
        }
        dismissProgressDialog()
        executor.shutdownNow()
    }

    private fun <T> work(
        manual: Boolean,
        job: () -> T,
        success: (T) -> Unit,
        failure: ((Throwable) -> Unit)? = null,
    ) {
        busy = true
        activeTask = executor.submit {
            val result = runCatching(job)
            activity.runOnUiThread {
                busy = false
                activeTask = null
                if (closed || activity.isFinishing || activity.isDestroyed) return@runOnUiThread
                result.onSuccess(success).onFailure { err ->
                    if (failure != null) {
                        failure(err)
                    } else if (manual && err !is CancellationException) {
                        message(R.string.update_failed)
                    }
                }
            }
        }
    }

    private fun message(resource: Int) {
        Toast.makeText(activity, resource, Toast.LENGTH_SHORT).show()
    }

    private fun findUpdate(): Release? {
        val parse = { input: InputStream, _: Long ->
            JSONObject(input.readBounded(MAX_MANIFEST).toString(Charsets.UTF_8))
        }
        // 云端清单优先（它会记录这次更新检查）；GitHub Pages 是无云环境的
        // 回退，不带安装信标。信标缺文件（核心还没起过）就不带，不编数据。
        val envelope = try {
            read(CLOUD_MANIFEST_URL, emptySet(), installHeader(), parse)
        } catch (first: Exception) {
            read(MANIFEST_URL, emptySet(), null, parse)
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
        val base = parts[0] * 10_000 + parts[1] * 100 + parts[2]
        require(parts.all { it <= 99 } && build == base * 100 + 99)
        if (build <= versionCode) return null

        // 清单带全部 ABI 的 per-ABI 资产；设备首个支持 ABI 必在其中之一
        // （Build.SUPPORTED_ABIS 已按设备偏好排序），缺条目是发版错误，
        // 直接失败，不静默回落别的包。
        val assets = release.getJSONObject("assets")
        val abi = Build.SUPPORTED_ABIS.first { assets.has("android-$it") }
        val asset = assets.getJSONObject("android-$abi")
        val name = "xbond-android-v$version-$abi.apk"
        val url = "$RELEASES_URL/v$version/$name"
        require(asset.getString("name") == name && asset.getString("url") == url)
        val sha256 = asset.getString("sha256")
        require(sha256.matches(Regex("[0-9a-f]{64}")))
        return Release(version, build, release.optString("notes"), url, sha256)
    }

    private fun downloadUrls(original: String): List<String> =
        listOf(original) + GITHUB_MIRRORS.map { "$it/$original" }

    private fun fetchApk(update: Release): File {
        val directory = File(activity.cacheDir, "updates")
        check(directory.isDirectory || directory.mkdirs())
        val part = File.createTempFile("download-", ".apk", directory)
        try {
            var lastError: Throwable? = null
            for (candidateUrl in downloadUrls(update.url)) {
                if (downloadCancelled || Thread.currentThread().isInterrupted) {
                    throw CancellationException("Update download cancelled")
                }
                postProgress(0L, -1L)
                val redirects = buildSet {
                    addAll(ASSET_REDIRECTS)
                    addAll(GITHUB_MIRROR_HOSTS)
                    if (URL(candidateUrl).host in GITHUB_MIRROR_HOSTS) add("github.com")
                }
                try {
                    val digest = MessageDigest.getInstance("SHA-256")
                    read(candidateUrl, redirects) { input, contentLength ->
                        postProgress(0L, contentLength)
                        part.outputStream().buffered().use { output ->
                            val buffer = ByteArray(64 * 1024)
                            var total = 0L
                            var lastUiAt = 0L
                            while (true) {
                                if (downloadCancelled || Thread.currentThread().isInterrupted) {
                                    throw CancellationException("Update download cancelled")
                                }
                                val count = input.read(buffer)
                                if (count < 0) break
                                total += count
                                check(total <= MAX_APK && !Thread.currentThread().isInterrupted)
                                digest.update(buffer, 0, count)
                                output.write(buffer, 0, count)
                                val now = SystemClock.elapsedRealtime()
                                if (now - lastUiAt >= 120L) {
                                    lastUiAt = now
                                    postProgress(total, contentLength)
                                }
                            }
                            postProgress(total, contentLength)
                        }
                    }
                    require(digest.digest().hex() == update.sha256)
                    verifyPackage(part, update)
                    val apk = File(directory, "xbond-${update.build}.apk")
                    check(part.renameTo(apk))
                    directory.listFiles()?.filter { it != apk && it.name.startsWith("xbond-") }?.forEach { it.delete() }
                    return apk
                } catch (err: CancellationException) {
                    throw err
                } catch (err: Exception) {
                    lastError = err
                }
            }
            throw lastError ?: IllegalStateException("Update download failed")
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

    /** 匿名安装信标，读 Go 核心在数据目录（filesDir）写的同一个 install-id
     * 文件（internal/telemetry），两边对同一台设备报同一个安装。 */
    private fun installHeader(): String? {
        val id = runCatching {
            File(activity.filesDir, "install-id").readText().trim()
        }.getOrNull()
        if (id == null || !id.matches(Regex("[0-9a-f]{32}"))) return null
        @Suppress("DEPRECATION")
        val app = runCatching {
            activity.packageManager.getPackageInfo(activity.packageName, 0).versionName
        }.getOrNull() ?: return null
        val abi = Build.SUPPORTED_ABIS.firstOrNull() ?: return null
        val arch = when (abi) {
            "arm64-v8a" -> "arm64"
            "armeabi-v7a" -> "arm"
            "x86_64" -> "amd64"
            "x86" -> "386"
            else -> abi
        }
        return listOf(
            "id=$id",
            "app=$app",
            "os=android",
            "osv=${Build.VERSION.RELEASE}",
            "arch=$arch",
        ).joinToString("; ")
    }

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

    private fun <T> read(address: String, allowedRedirects: Set<String>, beacon: String? = null, consume: (InputStream, Long) -> T): T {
        var url = URL(address)
        repeat(5) {
            if (downloadCancelled || Thread.currentThread().isInterrupted) {
                throw CancellationException("Update download cancelled")
            }
            val connection = (url.openConnection() as HttpsURLConnection).apply {
                connectTimeout = 10_000
                readTimeout = 15_000
                instanceFollowRedirects = false
                useCaches = false
                setRequestProperty("Cache-Control", "no-cache")
                if (beacon != null) setRequestProperty("X-XBond-Install", beacon)
            }
            activeConnection = connection
            try {
                val status = connection.responseCode
                if (status == 200) {
                    val length = connection.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L
                    return connection.inputStream.buffered().use { consume(it, length) }
                }
                check(status in 300..399)
                val next = URL(url, connection.getHeaderField("Location") ?: error("Missing redirect"))
                check(next.protocol == "https" && next.userInfo == null && next.host in allowedRedirects)
                url = next
            } finally {
                if (activeConnection === connection) activeConnection = null
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
        private const val CLOUD_MANIFEST_URL = "https://www.xbond.net/api/clients/update/release.json"
        private const val MANIFEST_URL = "https://openxbond.github.io/xbond/release.json"
        private const val RELEASES_URL = "https://github.com/openxbond/xbond/releases/download"
        private val ASSET_REDIRECTS = setOf("release-assets.githubusercontent.com", "objects.githubusercontent.com")
        private val GITHUB_MIRRORS = listOf("https://gh-proxy.com", "https://ghproxy.imciel.com", "https://ghfast.top")
        private val GITHUB_MIRROR_HOSTS = setOf("gh-proxy.com", "ghproxy.imciel.com", "ghfast.top")
        private val SEMVER = Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")
    }
}
