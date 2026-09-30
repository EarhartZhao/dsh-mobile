/**
 * The Objective-C surface the Swift app delegate talks to. Everything declared
 * here is app-local — none of it is reachable from JavaScript, which keeps the
 * JS side of the app platform-free.
 */
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Makes the Hub trustworthy for React Native's WebSocket implementation.
 *
 * Both platforms trust the CA their pairing QR carried, and both reach that
 * decision on React Native's own WebSocket seam — `network_security_config.xml`
 * cannot carry a runtime anchor, and this is iOS's only hook for a raw stream
 * (docs/01 §技术选型, docs/02 §4 证书).
 */
void DshInstallWebSocketSecurity(void);

/**
 * Applies the theme mode the settings screen persisted, early enough that the
 * first frame is already right (Android does the same in `MainActivity`).
 */
void DshApplyStoredInterfaceStyle(UIWindow *window);

/**
 * Presents `controller` from a view controller that can still host it.
 *
 * The composer's plus sheet is a React Native modal, and the JS side closes it
 * in the same tick it asks for the picker. `RCTPresentedViewController()` would
 * then return the modal that is animating away, and UIKit takes the system
 * picker down with it — the picker appears and vanishes a frame later. That
 * commit can also land after this returns, so the picker is watched for a
 * moment afterwards and re-attached when its host closed beneath it.
 *
 * `unavailable` runs instead of presenting when there is no window to present
 * from at all.
 */
void DshPresentWhenSettled(UIViewController *controller, void (^unavailable)(void));

/** Key the theme module reads and writes; shared with `DshThemeModule.mm`. */
extern NSString *const DshThemeModeDefaultsKey;

/**
 * Defaults key holding the Hub certificates pairing delivered, keyed by host.
 * Shared between `DshHubTlsModule.mm` (which writes it) and
 * `DshWebSocketSecurity.mm` (which reads it while evaluating a handshake).
 */
extern NSString *const DshHubAnchorsDefaultsKey;

/** The anchor stored for `host`, or NULL when that host has none. */
SecCertificateRef DshCopyHubAnchorForHost(NSString *host);

#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_END
