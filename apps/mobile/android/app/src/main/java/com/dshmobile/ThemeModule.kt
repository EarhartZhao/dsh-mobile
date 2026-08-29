package com.dshmobile

import androidx.appcompat.app.AppCompatDelegate
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ThemeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "DshTheme"

  @ReactMethod
  fun setMode(mode: String, promise: Promise) {
    val normalized = when (mode) {
      "light", "dark", "system" -> mode
      else -> {
        promise.reject("INVALID_MODE", "主题模式必须是亮色、暗色或跟随系统。")
        return
      }
    }
    applyMode(normalized)
    reactContext.getSharedPreferences(PREFERENCES, 0)
      .edit()
      .putString("mode", normalized)
      .apply()
    promise.resolve(null)
  }

  @ReactMethod
  fun getMode(promise: Promise) {
    promise.resolve(
      reactContext.getSharedPreferences(PREFERENCES, 0)
        .getString("mode", "system") ?: "system",
    )
  }

  private fun applyMode(mode: String) {
    AppCompatDelegate.setDefaultNightMode(
      when (mode) {
        "light" -> AppCompatDelegate.MODE_NIGHT_NO
        "dark" -> AppCompatDelegate.MODE_NIGHT_YES
        else -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
      },
    )
  }

  companion object {
    private const val PREFERENCES = "dsh_theme"
  }
}
