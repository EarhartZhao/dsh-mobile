package com.dshmobile

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class UpdaterModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "DshUpdater"

  /**
   * Sends one download-progress tick to the JS side, which renders the bar in
   * the update dialog. Emitting from this background thread is safe: the
   * emitter queues onto the JS thread. A failure to emit must never abort the
   * download, so it is swallowed.
   */
  private fun emitProgress(received: Long, total: Long, retrying: Boolean = false) {
    try {
      val payload: WritableMap = Arguments.createMap()
      payload.putDouble("received", received.toDouble())
      payload.putDouble("total", total.toDouble())
      payload.putBoolean("retrying", retrying)
      reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(PROGRESS_EVENT, payload)
    } catch (_: Exception) {
      // The dialog is a courtesy, not the download itself.
    }
  }

  @ReactMethod
  fun downloadAndInstall(downloadUrl: String, promise: Promise) {
    if (!downloadUrl.startsWith("https://")) {
      promise.reject("UPDATE_URL_INVALID", "更新地址必须使用 HTTPS。")
      return
    }
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前没有可用的前台页面。")
      return
    }
    executor.execute {
      try {
        val target = download(downloadUrl)
        // The activity is looked up again after the download: minutes can pass,
        // and the one captured at the start may be gone by then.
        val foreground = reactContext.currentActivity
        if (foreground == null) promise.reject("NO_ACTIVITY", "下载完成，但当前没有可用的前台页面。")
        else foreground.runOnUiThread { install(foreground, target, promise) }
      } catch (error: Exception) {
        promise.reject("UPDATE_DOWNLOAD_FAILED", error.message ?: "更新下载失败。", error)
      }
    }
  }

  /**
   * Downloads the APK into the app cache, resuming after a failure instead of
   * starting the transfer over.
   *
   * A ~80 MB APK over a mobile link stalls often enough that discarding the
   * partial file turns one hiccup into an endless「下载中…」. The release asset
   * host answers range requests (`206` + `Content-Range`), so every retry
   * continues from the last byte received, and the reason for a final failure
   * reaches the dialog rather than staying a spinner.
   * @returns the finished APK file.
   */
  private fun download(url: String): File {
    val directory = File(reactContext.cacheDir, "updates").apply { mkdirs() }
    val partial = File(directory, "dsh-mobile-update.apk.part")
    val target = File(directory, "dsh-mobile-update.apk")
    var total = 0L
    var lastError: Exception? = null
    for (attempt in 1..MAX_ATTEMPTS) {
      try {
        total = downloadOnce(url, partial, total)
        if (target.exists() && !target.delete()) throw IOException("无法清理上一次的更新包。")
        if (!partial.renameTo(target)) throw IOException("无法保存更新包。")
        return target
      } catch (error: Exception) {
        lastError = error
        if (attempt >= MAX_ATTEMPTS) break
        // Say so: a bar that stops moving reads as a hang, and the retry is
        // the normal path on a flaky link, not an error the owner must fix.
        emitProgress(partial.length(), total, retrying = true)
        try {
          Thread.sleep(RETRY_DELAY_MS * attempt)
        } catch (interrupted: InterruptedException) {
          Thread.currentThread().interrupt()
          throw interrupted
        }
      }
    }
    throw lastError ?: IOException("更新下载失败。")
  }

  /** One transfer attempt; {@code partial} carries the bytes already received. */
  private fun downloadOnce(url: String, partial: File, knownTotal: Long): Long {
    val already = if (partial.exists()) partial.length() else 0L
    var connection: HttpURLConnection? = null
    try {
      connection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = CONNECT_TIMEOUT_MS
        // A stall is exactly what「很久也没有下载成功」looks like: the socket
        // is open but no byte arrives. Fail that read, then resume from here.
        readTimeout = STALL_TIMEOUT_MS
        instanceFollowRedirects = true
        requestMethod = "GET"
        setRequestProperty("user-agent", "dsh-mobile-updater")
        if (already > 0L) setRequestProperty("range", "bytes=$already-")
      }
      connection.connect()
      if (connection.url.protocol != "https") throw IOException("更新地址重定向到了非 HTTPS 地址。")
      val code = connection.responseCode
      if (code == HTTP_RANGE_NOT_SATISFIABLE) {
        // Nothing left to send. Only trust that when it adds up to the size we
        // were promised; otherwise the partial file is not the real thing.
        if (knownTotal > 0L && already == knownTotal) return knownTotal
        throw IOException("续传失败：服务器拒绝了区间 $already-。")
      }
      if (code != HTTP_OK && code != HTTP_PARTIAL) throw IOException("下载失败：HTTP $code")
      val resuming = code == HTTP_PARTIAL && already > 0L
      if (resuming && rangeStart(connection.getHeaderField("content-range")) != already) {
        // Splicing bytes from a different offset would corrupt the APK, so
        // drop the partial file and let the retry start clean.
        partial.delete()
        throw IOException("服务器返回的续传区间与请求不一致。")
      }
      if (!resuming && already > 0L) partial.delete()
      val total = if (resuming) {
        rangeTotal(connection.getHeaderField("content-range")).takeIf { it > 0L }
          ?: connection.contentLengthLong.takeIf { it > 0L }
          ?: knownTotal
      } else {
        // -1 (chunked, unknown size) is reported as 0: the dialog then counts
        // bytes instead of a percentage it cannot compute.
        connection.contentLengthLong.coerceAtLeast(0L)
      }
      var received = if (resuming) already else 0L
      emitProgress(received, total)
      connection.inputStream.use { input ->
        FileOutputStream(partial, resuming).use { output ->
          val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
          // One event per whole percent (or per whole MB when the size is
          // unknown): a per-chunk emit only floods the JS thread.
          var lastPercent = -1
          var lastMegaByte = received / BYTE_PROGRESS_STEP
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            received += read
            if (received > MAX_APK_BYTES) throw IOException("更新包超过 150 MB 限制。")
            if (total > 0L) {
              val percent = ((received * 100L) / total).toInt()
              if (percent != lastPercent) {
                lastPercent = percent
                emitProgress(received, total)
              }
            } else {
              val megaByte = received / BYTE_PROGRESS_STEP
              if (megaByte != lastMegaByte) {
                lastMegaByte = megaByte
                emitProgress(received, 0L)
              }
            }
          }
        }
      }
      if (total > 0L && received < total) throw IOException("连接提前结束（$received/$total 字节）。")
      emitProgress(received, total)
      return total
    } finally {
      connection?.disconnect()
    }
  }

  /** Byte offset a `Content-Range: bytes START-END/TOTAL` header starts at. */
  private fun rangeStart(header: String?): Long =
    header?.substringAfter("bytes ", "")?.substringBefore('-')?.trim()?.toLongOrNull() ?: -1L

  /** Total size a `Content-Range: bytes START-END/TOTAL` header declares. */
  private fun rangeTotal(header: String?): Long =
    header?.substringAfterLast('/', "")?.trim()?.toLongOrNull() ?: -1L

  /** Opens the system installer for a finished APK. Runs on the UI thread. */
  private fun install(activity: android.app.Activity, target: File, promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
          data = Uri.parse("package:${activity.packageName}")
        })
        promise.reject("INSTALL_PERMISSION_REQUIRED", "请允许本应用安装未知来源应用后重试。")
        return
      }
      val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", target)
      val installIntent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(installIntent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("INSTALL_FAILED", "无法打开系统安装器。", error)
    }
  }

  @ReactMethod
  fun openInstallSettings(promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前没有可用的前台页面。")
      return
    }
    try {
      activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
        data = Uri.parse("package:${activity.packageName}")
      })
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("SETTINGS_FAILED", "无法打开安装权限设置。", error)
    }
  }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }

  companion object {
    /** Event name the JS side listens on (`DeviceEventEmitter`). */
    const val PROGRESS_EVENT = "DshUpdaterProgress"
    private const val MAX_APK_BYTES = 150L * 1024L * 1024L
    /** How many times one download may be resumed before it is reported failed. */
    private const val MAX_ATTEMPTS = 4
    private const val CONNECT_TIMEOUT_MS = 15_000
    /** No byte for this long is a stall, not a slow link. */
    private const val STALL_TIMEOUT_MS = 30_000
    private const val RETRY_DELAY_MS = 1_500L
    /** Progress granularity when the total size is unknown: one event per MB. */
    private const val BYTE_PROGRESS_STEP = 1024L * 1024L
    private const val HTTP_OK = 200
    private const val HTTP_PARTIAL = 206
    private const val HTTP_RANGE_NOT_SATISFIABLE = 416
  }
}
