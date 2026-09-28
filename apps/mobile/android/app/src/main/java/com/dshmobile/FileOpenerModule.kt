package com.dshmobile

import android.content.ActivityNotFoundException
import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import java.io.File
import java.util.concurrent.Executors

/**
 * Hands one remote file to an application on this phone.
 *
 * The bridge carries bytes, not files, so opening a PDF or a .docx with the
 * phone's own apps means materializing it first: the JS side fetches the bytes
 * it needs, this writes them into the app cache and fires the system's
 * ACTION_VIEW through the FileProvider the updater already installed, letting
 * any reader, office suite, or media player take over. Nothing about the file is
 * shared beyond that one read grant.
 */
class FileOpenerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "DshFileOpener"

  @ReactMethod
  fun openWithApp(name: String, mimeType: String, base64: String, promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前没有可用的前台页面。")
      return
    }
    executor.execute {
      val target: File
      val uri: android.net.Uri
      try {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        val directory = File(reactContext.cacheDir, "open")
        if (!directory.exists() && !directory.mkdirs()) {
          promise.reject("OPEN_FAILED", "无法创建缓存目录。")
          return@execute
        }
        target = File(directory, safeName(name))
        target.writeBytes(bytes)
        uri = FileProvider.getUriForFile(
          reactContext,
          "${reactContext.packageName}.fileprovider",
          target,
        )
      } catch (error: Exception) {
        promise.reject("OPEN_FAILED", error.message ?: "写入临时文件失败。")
        return@execute
      }
      UiThreadUtil.runOnUiThread {
        val view = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, mimeType.ifEmpty { "*/*" })
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
          activity.startActivity(Intent.createChooser(view, null))
          promise.resolve(true)
        } catch (_: ActivityNotFoundException) {
          promise.reject("NO_APP", "手机上找不到能打开这种文件的应用。")
        } catch (error: Exception) {
          promise.reject("OPEN_FAILED", error.message ?: "打开失败。")
        }
      }
    }
  }

  /** A cache-file name that cannot escape the directory it is written into. */
  private fun safeName(name: String): String {
    val base = name.split('/', '\\').lastOrNull().orEmpty()
    val cleaned = base.replace(Regex("[^A-Za-z0-9._\\-\\u4e00-\\u9fff]"), "_")
    return if (cleaned.isEmpty() || cleaned == "." || cleaned == "..") "file" else cleaned
  }
}
