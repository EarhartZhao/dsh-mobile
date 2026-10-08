package com.dshmobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(ImagePickerPackage())
          add(ThemePackage())
          add(UpdaterPackage())
          add(AppPackage())
          add(FileOpenerPackage())
          add(FilePickerPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // React Native caches its OkHttp client the first time a WebSocket or fetch
    // asks for one, and the Hub's trust anchor comes from the pairing QR, so
    // the trust manager has to be in place before any JavaScript runs.
    HubTlsTrust.install(this)
    loadReactNative(this)
  }
}
