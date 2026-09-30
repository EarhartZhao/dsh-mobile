/**
 * File hand-off, the iOS half of `FileOpenerModule.kt` (`DshFileOpener`) and of
 * the file branch the composer's plus menu calls (`DshFilePicker`).
 *
 * The bridge carries bytes, never files, so opening a PDF or a `.docx` with the
 * phone's own apps means writing it into the app cache first and then letting
 * iOS route it — `UIDocumentInteractionController`'s "open in" menu takes the
 * place of Android's `ACTION_VIEW` chooser, and `UIDocumentPickerViewController`
 * takes the place of `ACTION_OPEN_DOCUMENT`.
 */
#import <MobileCoreServices/MobileCoreServices.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#import "DshMobileNative.h"

#pragma mark - Shared helpers

/** A cache-file name that cannot escape the directory it is written into. */
static NSString *DshSafeFileName(NSString *name)
{
  NSString *base = [name lastPathComponent];
  NSCharacterSet *allowed = [NSCharacterSet characterSetWithCharactersInString:
      @"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"];
  NSMutableString *cleaned = [NSMutableString stringWithCapacity:base.length];
  for (NSUInteger index = 0; index < base.length; index += 1) {
    unichar character = [base characterAtIndex:index];
    // Keep anything non-ASCII (Chinese document names are common) and the
    // punctuation above; replace the rest so no separator survives.
    if ([allowed characterIsMember:character] || character > 0x7f) {
      [cleaned appendFormat:@"%C", character];
    } else {
      [cleaned appendString:@"_"];
    }
  }
  if (cleaned.length == 0 || [cleaned isEqualToString:@"."] || [cleaned isEqualToString:@".."]) {
    return @"file";
  }
  return cleaned;
}

/** The MIME type iOS derives from a path's extension, or a wildcard. */
static NSString *DshMimeTypeForPath(NSString *path)
{
  NSString *extension = path.pathExtension;
  if (extension.length == 0) return @"application/octet-stream";
  UTType *type = [UTType typeWithFilenameExtension:extension];
  NSString *mime = type.preferredMIMEType;
  return mime.length > 0 ? mime : @"application/octet-stream";
}

#pragma mark - DshFileOpener

@interface DshFileOpener : NSObject <RCTBridgeModule, UIDocumentInteractionControllerDelegate>
@property (nonatomic, strong) UIDocumentInteractionController *activeOpener;
@end

@implementation DshFileOpener

RCT_EXPORT_MODULE(DshFileOpener)

RCT_EXPORT_METHOD(openWithApp : (NSString *)name mimeType : (NSString *)mimeType base64 : (NSString *)base64 resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  NSData *bytes = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
  if (bytes == nil) {
    reject(@"OPEN_FAILED", @"文件内容无法解码。", nil);
    return;
  }

  NSURL *directory = [[NSURL fileURLWithPath:NSTemporaryDirectory()] URLByAppendingPathComponent:@"dsh-open" isDirectory:YES];
  NSError *error = nil;
  if (![[NSFileManager defaultManager] createDirectoryAtURL:directory
                                withIntermediateDirectories:YES
                                                 attributes:nil
                                                      error:&error]) {
    reject(@"OPEN_FAILED", error.localizedDescription ?: @"无法创建缓存目录。", error);
    return;
  }

  NSURL *target = [directory URLByAppendingPathComponent:DshSafeFileName(name) isDirectory:NO];
  if (![bytes writeToURL:target options:NSDataWritingAtomic error:&error]) {
    reject(@"OPEN_FAILED", error.localizedDescription ?: @"写入临时文件失败。", error);
    return;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *presenter = RCTPresentedViewController();
    if (presenter == nil) {
      reject(@"NO_ACTIVITY", @"当前没有可用的前台页面。", nil);
      return;
    }
    UIDocumentInteractionController *controller = [UIDocumentInteractionController interactionControllerWithURL:target];
    UTType *type = mimeType.length > 0 ? [UTType typeWithMIMEType:mimeType] : nil;
    if (type != nil) controller.UTI = type.identifier;
    controller.delegate = self;
    self.activeOpener = controller;

    UIView *view = presenter.view;
    BOOL presented = [controller presentOpenInMenuFromRect:CGRectMake(CGRectGetMidX(view.bounds), CGRectGetMidY(view.bounds), 1, 1)
                                                    inView:view
                                                  animated:YES];
    if (presented) {
      resolve(@YES);
    } else {
      self.activeOpener = nil;
      reject(@"NO_APP", @"手机上找不到能打开这种文件的应用。", nil);
    }
  });
}

- (void)documentInteractionControllerDidDismissOpenInMenu:(UIDocumentInteractionController *)controller
{
  if (controller == self.activeOpener) self.activeOpener = nil;
}

@end

#pragma mark - DshFilePicker

@interface DshFilePicker : NSObject <RCTBridgeModule, UIDocumentPickerDelegate>
@property (nonatomic, strong) RCTPromiseResolveBlock pendingPick;
@property (nonatomic, strong) RCTPromiseRejectBlock pendingPickReject;
@end

@implementation DshFilePicker

RCT_EXPORT_MODULE(DshFilePicker)

RCT_EXPORT_METHOD(pickFile : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  if (self.pendingPick != nil) {
    reject(@"PICKER_BUSY", @"另一个文件选择器正在运行。", nil);
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    self.pendingPick = resolve;
    self.pendingPickReject = reject;
    UIDocumentPickerViewController *picker =
        [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:@[ UTTypeItem ] asCopy:YES];
    picker.delegate = self;
    picker.allowsMultipleSelection = NO;
    DshPresentWhenSettled(picker, ^{
      self.pendingPick = nil;
      self.pendingPickReject = nil;
      reject(@"NO_ACTIVITY", @"当前没有可用的前台页面。", nil);
    });
  });
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls
{
  RCTPromiseResolveBlock resolve = self.pendingPick;
  RCTPromiseRejectBlock reject = self.pendingPickReject;
  self.pendingPick = nil;
  self.pendingPickReject = nil;
  if (resolve == nil) return;

  NSURL *url = urls.firstObject;
  if (url == nil) {
    resolve(nil);
    return;
  }

  NSError *error = nil;
  NSData *data = [NSData dataWithContentsOfURL:url options:0 error:&error];
  if (data == nil) {
    if (reject != nil) reject(@"READ_FAILED", error.localizedDescription ?: @"无法读取所选文件。", error);
    return;
  }
  resolve(@{
    @"name" : url.lastPathComponent ?: @"file",
    @"mimeType" : DshMimeTypeForPath(url.lastPathComponent ?: @""),
    @"size" : @(data.length),
    @"data" : [data base64EncodedStringWithOptions:0],
  });
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller
{
  RCTPromiseResolveBlock resolve = self.pendingPick;
  self.pendingPick = nil;
  self.pendingPickReject = nil;
  if (resolve != nil) resolve(nil);
}

@end
