package com.dshmobile

import androidx.appcompat.app.AppCompatDelegate
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.devsupport.DefaultDevLoadingViewImplementation
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    when (getSharedPreferences("dsh_theme", MODE_PRIVATE).getString("mode", "system")) {
      "light" -> AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)
      "dark" -> AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)
      else -> AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM)
    }
    // React Native's own reload popup — "Refreshing…", an English line over the
    // header on every Fast Refresh — is a PopupWindow the dev-support layer
    // owns, so no JS can reach it. Android's counterpart to the iOS banner the
    // app delegate switches off; nothing shows in a release build either way.
    DefaultDevLoadingViewImplementation.setDevLoadingEnabled(false)
    super.onCreate(savedInstanceState)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "DshMobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
