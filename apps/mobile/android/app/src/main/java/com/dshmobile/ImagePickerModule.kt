package com.dshmobile

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import java.io.InputStream

class ImagePickerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private var pending: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "DshImagePicker"

  @ReactMethod
  fun pickImage(maxBytes: Double, promise: Promise) {
    val current = pending
    if (current != null) {
      promise.reject("PICKER_BUSY", "Another image picker is active.")
      return
    }
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No foreground activity is available.")
      return
    }
    pending = promise
    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
      type = "image/*"
      addCategory(Intent.CATEGORY_OPENABLE)
    }
    try {
      activity.startActivityForResult(Intent.createChooser(intent, "Select image"), REQUEST_CODE)
    } catch (error: Exception) {
      pending = null
      promise.reject("PICKER_FAILED", "Unable to open the image picker.", error)
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
      promise.resolve(readImage(uri))
    } catch (error: Exception) {
      promise.reject("READ_FAILED", "Unable to read the selected image.", error)
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun readImage(uri: Uri): WritableNativeMap {
    val resolver = reactContext.contentResolver
    val bytes = resolver.openInputStream(uri)?.use(InputStream::readBytes)
      ?: throw IllegalStateException("The selected image has no content.")
    if (bytes.size > MAX_BYTES) {
      throw IllegalArgumentException("Images must be 20 MB or smaller.")
    }
    val mediaType = resolver.getType(uri) ?: "image/png"
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw IllegalArgumentException("The selected file is not a readable image.")
    }
    val encoded = if (bytes.size <= INLINE_BYTES) {
      mediaType to bytes
    } else {
      val maxSide = maxOf(bounds.outWidth, bounds.outHeight)
      val options = BitmapFactory.Options().apply {
        inSampleSize = Integer.highestOneBit(maxSide / MAX_DIMENSION).coerceAtLeast(1)
      }
      val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        ?: throw IllegalArgumentException("Unable to decode the selected image.")
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
    private const val MAX_BYTES = 20 * 1024 * 1024
    private const val INLINE_BYTES = 384 * 1024
    private const val MAX_DIMENSION = 1280
    private const val JPEG_QUALITY = 68
  }
}
