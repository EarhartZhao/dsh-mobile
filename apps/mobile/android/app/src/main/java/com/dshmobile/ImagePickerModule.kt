package com.dshmobile

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream

class ImagePickerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private var pending: Promise? = null
  private var pendingCaptureFile: File? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "DshImagePicker"

  @ReactMethod
  fun pickImage(maxBytes: Double, promise: Promise) {
    val current = pending
    if (current != null) {
      promise.reject("PICKER_BUSY", "另一个图片选择器正在运行。")
      return
    }
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前没有可用的前台页面。")
      return
    }
    pending = promise
    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
      type = "image/*"
      addCategory(Intent.CATEGORY_OPENABLE)
    }
    try {
      activity.startActivityForResult(Intent.createChooser(intent, "选择图片"), REQUEST_CODE)
    } catch (error: Exception) {
      pending = null
      promise.reject("PICKER_FAILED", "无法打开图片选择器。", error)
    }
  }

  @ReactMethod
  fun captureImage(maxBytes: Double, promise: Promise) {
    val current = pending
    if (current != null) {
      promise.reject("PICKER_BUSY", "另一个图片选择器正在运行。")
      return
    }
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前没有可用的前台页面。")
      return
    }
    val directory = File(reactContext.cacheDir, "captures").apply { mkdirs() }
    val captureFile = File.createTempFile("dsh-capture-", ".jpg", directory)
    pending = promise
    pendingCaptureFile = captureFile
    val outputUri = FileProvider.getUriForFile(
      reactContext,
      "${reactContext.packageName}.fileprovider",
      captureFile,
    )
    val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
      putExtra(MediaStore.EXTRA_OUTPUT, outputUri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    }
    try {
      activity.startActivityForResult(intent, CAPTURE_REQUEST_CODE)
    } catch (error: Exception) {
      pending = null
      pendingCaptureFile = null
      captureFile.delete()
      promise.reject("CAMERA_FAILED", "无法打开相机。", error)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    when (requestCode) {
      REQUEST_CODE -> {
        val promise = pending ?: return
        pending = null
        val uri = if (resultCode == Activity.RESULT_OK) data?.data else null
        if (uri == null) {
          promise.resolve(null)
          return
        }
        try {
          promise.resolve(readImage(uri))
        } catch (error: Exception) {
          promise.reject("READ_FAILED", "无法读取所选图片。", error)
        }
      }
      CAPTURE_REQUEST_CODE -> {
        val promise = pending ?: return
        val captureFile = pendingCaptureFile
        pending = null
        pendingCaptureFile = null
        if (resultCode != Activity.RESULT_OK || captureFile == null || !captureFile.exists() || captureFile.length() == 0L) {
          captureFile?.delete()
          promise.resolve(null)
          return
        }
        try {
          val result = readImage(FileProvider.getUriForFile(
            reactContext,
            "${reactContext.packageName}.fileprovider",
            captureFile,
          ))
          promise.resolve(result)
        } catch (error: Exception) {
          promise.reject("CAPTURE_READ_FAILED", "无法读取拍摄的照片。", error)
        } finally {
          captureFile.delete()
        }
      }
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun readImage(uri: Uri): WritableNativeMap {
    val resolver = reactContext.contentResolver
    val bytes = resolver.openInputStream(uri)?.use(InputStream::readBytes)
      ?: throw IllegalStateException("所选图片没有内容。")
    if (bytes.size > MAX_BYTES) {
      throw IllegalArgumentException("图片不能超过 20 MB。")
    }
    val mediaType = resolver.getType(uri) ?: "image/png"
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw IllegalArgumentException("所选文件不是可识别的图片。")
    }
    val encoded = if (bytes.size <= INLINE_BYTES) {
      mediaType to bytes
    } else {
      val maxSide = maxOf(bounds.outWidth, bounds.outHeight)
      val options = BitmapFactory.Options().apply {
        inSampleSize = Integer.highestOneBit(maxSide / MAX_DIMENSION).coerceAtLeast(1)
      }
      val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        ?: throw IllegalArgumentException("无法解析所选图片。")
      val output = ByteArrayOutputStream()
      bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)
      bitmap.recycle()
      "image/jpeg" to output.toByteArray()
    }
    val result = WritableNativeMap()
    result.putString("mediaType", encoded.first)
    result.putString("data", Base64.encodeToString(encoded.second, Base64.NO_WRAP))
    result.putInt("width", bounds.outWidth)
    result.putInt("height", bounds.outHeight)
    result.putString("name", displayName(uri))
    return result
  }

  private fun displayName(uri: Uri): String? {
    return reactContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
  }

  companion object {
    const val NAME = "DshImagePicker"
    private const val REQUEST_CODE = 4711
    private const val CAPTURE_REQUEST_CODE = 4712
    private const val MAX_BYTES = 20 * 1024 * 1024
    private const val INLINE_BYTES = 384 * 1024
    private const val MAX_DIMENSION = 1280
    private const val JPEG_QUALITY = 68
  }
}
