package com.dshmobile

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class UpdaterModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "DshUpdater"

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
      var connection: HttpURLConnection? = null
      try {
        connection = URL(downloadUrl).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 60_000
        connection.instanceFollowRedirects = true
        connection.requestMethod = "GET"
        connection.connect()
        if (connection.url.protocol != "https") throw IllegalStateException("更新地址重定向到了非 HTTPS 地址。")
        if (connection.responseCode !in 200..299) throw IllegalStateException("下载失败：HTTP ${connection.responseCode}")
        val directory = File(reactContext.cacheDir, "updates").apply { mkdirs() }
        val temporary = File(directory, "dsh-mobile-update.apk.part")
        val target = File(directory, "dsh-mobile-update.apk")
        connection.inputStream.use { input ->
          temporary.outputStream().use { output ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var total = 0L
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              total += read
              if (total > MAX_APK_BYTES) throw IllegalStateException("更新包超过 150 MB 限制。")
              output.write(buffer, 0, read)
            }
          }
        }
        if (!temporary.renameTo(target)) throw IllegalStateException("无法保存更新包。")
        activity.runOnUiThread {
          try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
              val settingsIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                data = Uri.parse("package:${activity.packageName}")
              }
              activity.startActivity(settingsIntent)
              promise.reject("INSTALL_PERMISSION_REQUIRED", "请允许本应用安装未知来源应用后重试。")
              return@runOnUiThread
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
      } catch (error: Exception) {
        promise.reject("UPDATE_DOWNLOAD_FAILED", error.message ?: "更新下载失败。", error)
      } finally {
        connection?.disconnect()
      }
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
    private const val MAX_APK_BYTES = 150L * 1024L * 1024L
  }
}
