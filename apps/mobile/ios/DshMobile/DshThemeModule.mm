/**
 * Theme mode, the iOS half of `DshThemeModule.kt`.
 *
 * The JS side owns the two-value contract (`light`/`dark`/`system`) and reloads
 * after a change, because the colour tokens are module-level constants; this
 * module only has to remember the choice and put it on the window before that
 * reload renders.
 */
#import "DshMobileNative.h"

#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>

NSString *const DshThemeModeDefaultsKey = @"dsh_theme_mode";

static UIUserInterfaceStyle DshInterfaceStyleForMode(NSString *mode)
{
  if ([mode isEqualToString:@"light"]) return UIUserInterfaceStyleLight;
  if ([mode isEqualToString:@"dark"]) return UIUserInterfaceStyleDark;
  return UIUserInterfaceStyleUnspecified;
}

void DshApplyStoredInterfaceStyle(UIWindow *window)
{
  NSString *mode = [[NSUserDefaults standardUserDefaults] stringForKey:DshThemeModeDefaultsKey];
  if (mode == nil) return;
  window.overrideUserInterfaceStyle = DshInterfaceStyleForMode(mode);
}

@interface DshTheme : NSObject <RCTBridgeModule>
@end

@implementation DshTheme

RCT_EXPORT_MODULE(DshTheme)

RCT_EXPORT_METHOD(getMode : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  NSString *mode = [[NSUserDefaults standardUserDefaults] stringForKey:DshThemeModeDefaultsKey];
  resolve(mode != nil ? mode : @"system");
}

RCT_EXPORT_METHOD(setMode : (NSString *)mode resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  if (![mode isEqualToString:@"light"] && ![mode isEqualToString:@"dark"] && ![mode isEqualToString:@"system"]) {
    reject(@"INVALID_MODE", @"主题模式必须是亮色、暗色或跟随系统。", nil);
    return;
  }

  [[NSUserDefaults standardUserDefaults] setObject:mode forKey:DshThemeModeDefaultsKey];
  UIUserInterfaceStyle style = DshInterfaceStyleForMode(mode);
  dispatch_async(dispatch_get_main_queue(), ^{
    for (UIWindow *window in RCTSharedApplication().windows) {
      window.overrideUserInterfaceStyle = style;
    }
    resolve(nil);
  });
}

@end
