package com.dshmobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

/**
 * Picks one file off the phone and hands its bytes to the composer.
 *
 * The Android half of the iOS `DshFilePicker`: the bridge carries bytes, never
 * files, so the composer's plus menu gets the same `{name, mimeType, size, data}`
 * shape on both platforms and uploads it through the ordinary file-upload path.
 * `ACTION_OPEN_DOCUMENT` (rather than `GET_CONTENT`) is the system picker, so the
 * reader picks from the same "最近" view the gallery branch already opens.
 */
class FilePickerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private var pending: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "DshFilePicker"

  @ReactMethod
  fun pickFile(promise: Promise) {
    if (pending != null) {
      promise.reject("PICKER_BUSY", "另一个文件选择器正在运行。")
      return
    }
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前没有可用的前台页面。")
      return
    }
    pending = promise
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    try {
      activity.startActivityForResult(intent, REQUEST_CODE)
    } catch (error: Exception) {
      pending = null
      promise.reject("PICKER_FAILED", "无法打开文件选择器。", error)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_CODE) return
    val promise = pending ?: return
    pending = null
    val uri = if (resultCode == Activity.RESULT_OK) data?.data else null
    if (uri == null) {
      promise.resolve(null)
      return
    }
    try {
      promise.resolve(readFile(uri))
    } catch (error: FileTooLargeException) {
      promise.reject("FILE_TOO_LARGE", error.message)
    } catch (error: Exception) {
      promise.reject("READ_FAILED", "无法读取所选文件。", error)
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun readFile(uri: Uri): WritableNativeMap {
    val resolver = reactContext.contentResolver
    val bytes = resolver.openInputStream(uri)?.use(::readCapped)
      ?: throw IllegalStateException("所选文件没有内容。")
    val result = WritableNativeMap()
    result.putString("name", displayName(uri) ?: uri.lastPathSegment ?: "file")
    result.putString("mimeType", resolver.getType(uri) ?: "application/octet-stream")
    result.putInt("size", bytes.size)
    result.putString("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
    return result
  }

  /**
   * Reads at most [MAX_BYTES]. The composer refuses anything over 512 KiB, and a
   * phone can hand us a multi-gigabyte video: slurping it into a `ByteArray`
   * (then base64, another third on top) would kill the process before the JS
   * side ever got to say the file is too big.
   */
  private fun readCapped(input: InputStream): ByteArray {
    val buffer = ByteArrayOutputStream()
    val chunk = ByteArray(64 * 1024)
    var total = 0
    while (true) {
      val read = input.read(chunk)
      if (read <= 0) break
      total += read
      if (total > MAX_BYTES) {
        throw FileTooLargeException("文件太大，请选择小于 ${MAX_BYTES / (1024 * 1024)} MB 的文件。")
      }
      buffer.write(chunk, 0, read)
    }
    return buffer.toByteArray()
  }

  private fun displayName(uri: Uri): String? {
    return reactContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
  }

  /** The pick was fine; the bytes behind it are past what the composer accepts. */
  private class FileTooLargeException(message: String) : IOException(message)

  companion object {
    const val NAME = "DshFilePicker"
    private const val REQUEST_CODE = 4721
    private const val MAX_BYTES = 8 * 1024 * 1024
  }
}
