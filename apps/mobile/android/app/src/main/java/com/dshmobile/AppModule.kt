package com.dshmobile

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AppModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "DshApp"

  @ReactMethod
  fun moveTaskToBack(promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "当前没有可用的前台页面。")
      return
    }
    activity.runOnUiThread {
      try {
        promise.resolve(activity.moveTaskToBack(true))
      } catch (error: Exception) {
        promise.reject("MOVE_TO_BACKGROUND_FAILED", "无法将应用退到后台。", error)
      }
    }
  }
}
