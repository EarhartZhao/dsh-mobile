/**
 * One place that turns "the app wants to show a system sheet" into a
 * presentation that survives the screen that asked for it.
 *
 * Both the image picker and the file picker are opened from the composer's plus
 * sheet, and both are asked for in the same tick the sheet is closed. Presenting
 * on the dismissing modal is what makes a picker flash and disappear, so callers
 * go through here instead of calling `RCTPresentedViewController()` themselves.
 */
#import "DshMobileNative.h"

#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>

/** Two seconds of retries at 50 ms each: a dismissal plus the next settle. */
static const int DshPresentationAttempts = 40;
static const NSTimeInterval DshPresentationRetrySeconds = 0.05;
/**
 * How long the same host has to stay calm before it is trusted.
 *
 * "Calm right now" is not enough: the plus sheet is dismissed by a React
 * commit that lands a frame or two after the picker call comes across, so the
 * modal still looks idle when the first attempt runs. Requiring the same host
 * to stay presentable for several ticks skips past that commit — the dismissal
 * then shows up as `isBeingDismissed`, the counter resets, and the picker ends
 * up on the view controller that is still there afterwards.
 */
static const int DshPresentationStableTicks = 3;
/** Times a picker may be re-attached before giving up and leaving it be. */
static const int DshPresentationPasses = 3;
/** How often, and for how long, a fresh presentation is checked for survival. */
static const NSTimeInterval DshPresentationWatchdogSeconds = 0.4;
static const int DshPresentationWatchdogTicks = 6;

/** Whether a controller is done presenting, dismissing, or animating. */
static BOOL DshViewControllerHasSettled(UIViewController *controller)
{
  return controller != nil
      && !controller.isBeingPresented
      && !controller.isBeingDismissed
      && controller.presentedViewController == nil
      && controller.transitionCoordinator == nil;
}

/** Whether a host is still on screen, i.e. did not close underneath a picker. */
static BOOL DshViewControllerIsOnScreen(UIViewController *controller)
{
  return controller != nil && controller.viewIfLoaded.window != nil;
}

static void DshAwaitHostAndPresent(UIViewController *controller,
                                   void (^unavailable)(void),
                                   int pass)
{
  __block UIViewController *previousHost = nil;
  __block int stableTicks = 0;
  __block void (^attempt)(int) = nil;
  attempt = ^(int remaining) {
    UIViewController *host = RCTPresentedViewController();
    BOOL ready = DshViewControllerHasSettled(host) && DshViewControllerIsOnScreen(host);
    if (ready && host == previousHost) {
      stableTicks += 1;
    } else {
      stableTicks = ready ? 1 : 0;
    }
    previousHost = ready ? host : nil;
#if DEBUG
    NSLog(@"[dsh-present] pass=%d attempt=%d host=%@ window=%@ settled=%d stable=%d",
          pass,
          DshPresentationAttempts - remaining,
          NSStringFromClass(host.class),
          host.viewIfLoaded.window,
          ready,
          stableTicks);
#endif
    // Present on the last attempt regardless, so a stuck transition degrades
    // into the old behaviour rather than a promise that never settles.
    if (stableTicks >= DshPresentationStableTicks || remaining <= 0) {
      if (host == nil) {
        // Nothing left to present from: report instead of hanging the promise.
        unavailable();
        return;
      }
      [host presentViewController:controller animated:YES completion:nil];
      // A host can be on its way out even when it looks settled: the composer's
      // modal is closed by a React commit that may land well after the picker
      // call, and UIKit takes the modal's presentations down with it. If the
      // picker never got a window and its host is gone too, the modal closed
      // underneath it — re-attach to whatever is left. A user cancelling is
      // distinguishable: there the host is still on screen.
      if (pass + 1 >= DshPresentationPasses) return;
      __block void (^watch)(int) = nil;
      watch = ^(int ticksLeft) {
        if (ticksLeft <= 0) return;
        if (!DshViewControllerIsOnScreen(controller) && !DshViewControllerIsOnScreen(host)) {
#if DEBUG
          NSLog(@"[dsh-present] pass=%d lost its host, re-attaching", pass);
#endif
          DshAwaitHostAndPresent(controller, unavailable, pass + 1);
          return;
        }
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,
                                     (int64_t)(DshPresentationWatchdogSeconds * NSEC_PER_SEC)),
                       dispatch_get_main_queue(),
                       ^{
                         watch(ticksLeft - 1);
                       });
      };
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW,
                                   (int64_t)(DshPresentationWatchdogSeconds * NSEC_PER_SEC)),
                     dispatch_get_main_queue(),
                     ^{
                       watch(DshPresentationWatchdogTicks);
                     });
      return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,
                                 (int64_t)(DshPresentationRetrySeconds * NSEC_PER_SEC)),
                   dispatch_get_main_queue(),
                   ^{
                     attempt(remaining - 1);
                   });
  };
  attempt(DshPresentationAttempts);
}

void DshPresentWhenSettled(UIViewController *controller, void (^unavailable)(void))
{
  DshAwaitHostAndPresent(controller, unavailable ?: ^{}, 0);
}
