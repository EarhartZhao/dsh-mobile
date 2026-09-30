import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    let window = UIWindow(frame: UIScreen.main.bounds)
    // Same rehydration order as Android's MainActivity: the stored theme lands
    // on the window before React starts, so the first frame already matches the
    // user's choice, and the Hub's private CA is pinned before any socket opens.
    DshApplyStoredInterfaceStyle(window)
    DshInstallWebSocketSecurity()
    self.window = window

    factory.startReactNative(
      withModuleName: "DshMobile",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  /// Forwards `dshmobile://` links to React Native's linking module.
  ///
  /// The schemes are declared in `Info.plist`, but UIKit only delivers them
  /// here; without this hop `Linking.getInitialURL()` and the `url` events stay
  /// empty and the Android-side `dshmobile://new-session` entry has no iOS
  /// counterpart. Cold launches are covered by `launchOptions` above.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    RCTLinkingManager.application(app, open: url, options: options)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
