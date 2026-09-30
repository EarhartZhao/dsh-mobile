/**
 * Image intake, the iOS half of `ImagePickerModule.kt`.
 *
 * Same contract as Android: `pickImage` / `pickImages` / `captureImage` hand the
 * JS side `{ mediaType, data, width, height, name }`, already bounded by the
 * caller's byte budget, so the composer's own limits (`chat-images.ts`) stay the
 * single place that decides what is acceptable.
 *
 * Photos come through `PHPickerViewController` — no photo-library permission,
 * and the selection is delivered as data rather than as a file the app must keep
 * reading; the camera path uses the classic picker because it is the one that
 * also works on a device with no photo library access.
 */
#import <ImageIO/ImageIO.h>
#import <PhotosUI/PhotosUI.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#import "DshMobileNative.h"

/** Mirrors `ImagePickerModule.kt`: keep small files untouched, re-encode big ones. */
static const NSUInteger DshInlineImageBytes = 384 * 1024;
static const CGFloat DshImageMaxDimension = 1280;
static const CGFloat DshImageJpegQuality = 0.68;

static NSString *DshMimeTypeForImageTypeIdentifier(NSString *identifier)
{
  UTType *type = [UTType typeWithIdentifier:identifier];
  NSString *mime = type.preferredMIMEType;
  return mime.length > 0 ? mime : @"image/png";
}

/**
 * Bounds one image to the byte budget and describes it the way the composer
 * expects: original pixel size, base64 payload, and a media type that matches
 * what the bytes actually are.
 */
static NSDictionary *DshImagePayload(NSData *data, NSString *name, NSString *typeIdentifier, double maxBytes, NSError **errorOut)
{
  if (data.length == 0) {
    if (errorOut != NULL) *errorOut = [NSError errorWithDomain:@"dsh.image" code:1 userInfo:@{ NSLocalizedDescriptionKey: @"所选图片没有内容。" }];
    return nil;
  }

  CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
  if (source == NULL) {
    if (errorOut != NULL) *errorOut = [NSError errorWithDomain:@"dsh.image" code:2 userInfo:@{ NSLocalizedDescriptionKey: @"所选文件不是可识别的图片。" }];
    return nil;
  }

  NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, NULL));
  NSNumber *width = properties[(NSString *)kCGImagePropertyPixelWidth];
  NSNumber *height = properties[(NSString *)kCGImagePropertyPixelHeight];
  NSString *detected = CFBridgingRelease(CGImageSourceGetType(source));
  NSString *identifier = detected.length > 0 ? detected : typeIdentifier;
  if (width.integerValue <= 0 || height.integerValue <= 0) {
    CFRelease(source);
    if (errorOut != NULL) *errorOut = [NSError errorWithDomain:@"dsh.image" code:3 userInfo:@{ NSLocalizedDescriptionKey: @"所选文件不是可识别的图片。" }];
    return nil;
  }

  if (maxBytes > 0 && data.length > (NSUInteger)maxBytes) {
    CFRelease(source);
    if (errorOut != NULL) {
      NSString *message = [NSString stringWithFormat:@"图片不能超过 %lu KB。", (unsigned long)((NSUInteger)maxBytes / 1024)];
      *errorOut = [NSError errorWithDomain:@"dsh.image" code:4 userInfo:@{ NSLocalizedDescriptionKey: message }];
    }
    return nil;
  }

  NSData *encoded = data;
  NSString *mediaType = DshMimeTypeForImageTypeIdentifier(identifier);
  if (data.length > DshInlineImageBytes) {
    NSDictionary *options = @{
      (NSString *)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
      (NSString *)kCGImageSourceCreateThumbnailWithTransform : @YES,
      (NSString *)kCGImageSourceThumbnailMaxPixelSize : @(DshImageMaxDimension),
    };
    CGImageRef thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
    if (thumbnail != NULL) {
      UIImage *image = [UIImage imageWithCGImage:thumbnail];
      NSData *jpeg = UIImageJPEGRepresentation(image, DshImageJpegQuality);
      CGImageRelease(thumbnail);
      if (jpeg.length > 0) {
        encoded = jpeg;
        mediaType = @"image/jpeg";
      }
    }
  }
  CFRelease(source);

  NSMutableDictionary *payload = [NSMutableDictionary dictionary];
  payload[@"mediaType"] = mediaType;
  payload[@"data"] = [encoded base64EncodedStringWithOptions:0];
  payload[@"width"] = width;
  payload[@"height"] = height;
  payload[@"name"] = name.length > 0 ? name : @"image";
  return payload;
}

/** The most concrete registered representation that is still an image. */
static NSString *DshImageTypeIdentifierForProvider(NSItemProvider *provider)
{
  for (NSString *identifier in provider.registeredTypeIdentifiers) {
    UTType *type = [UTType typeWithIdentifier:identifier];
    if (type != nil && [type conformsToType:UTTypeImage]) return identifier;
  }
  return UTTypeImage.identifier;
}

@interface DshImagePicker : NSObject <RCTBridgeModule, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate>
@property (nonatomic, strong) RCTPromiseResolveBlock pendingResolve;
@property (nonatomic, strong) RCTPromiseRejectBlock pendingReject;
@property (nonatomic, assign) BOOL pendingWantsMultiple;
@property (nonatomic, assign) double pendingMaxBytes;
@end

@implementation DshImagePicker

RCT_EXPORT_MODULE(DshImagePicker)

#pragma mark - Entry points

RCT_EXPORT_METHOD(pickImage : (double)maxBytes resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  [self presentPickerWithLimit:1 maxBytes:maxBytes resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(pickImages : (double)maxBytes resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  [self presentPickerWithLimit:0 maxBytes:maxBytes resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(captureImage : (double)maxBytes resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.pendingResolve != nil) {
      reject(@"PICKER_BUSY", @"另一个图片选择器正在运行。", nil);
      return;
    }
    if (![UIImagePickerController isSourceTypeAvailable:UIImagePickerControllerSourceTypeCamera]) {
      reject(@"CAMERA_FAILED", @"当前设备没有可用相机。", nil);
      return;
    }
    self.pendingResolve = resolve;
    self.pendingReject = reject;
    self.pendingWantsMultiple = NO;
    self.pendingMaxBytes = maxBytes;
    UIImagePickerController *picker = [[UIImagePickerController alloc] init];
    picker.sourceType = UIImagePickerControllerSourceTypeCamera;
    picker.mediaTypes = @[ @"public.image" ];
    picker.delegate = self;
    DshPresentWhenSettled(picker, ^{
      [self finishPending];
      reject(@"NO_ACTIVITY", @"当前没有可用的前台页面。", nil);
    });
  });
}

- (void)presentPickerWithLimit:(NSInteger)limit
                      maxBytes:(double)maxBytes
                       resolve:(RCTPromiseResolveBlock)resolve
                        reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.pendingResolve != nil) {
      reject(@"PICKER_BUSY", @"另一个图片选择器正在运行。", nil);
      return;
    }
    self.pendingResolve = resolve;
    self.pendingReject = reject;
    self.pendingWantsMultiple = limit != 1;
    self.pendingMaxBytes = maxBytes;

    PHPickerConfiguration *configuration = [[PHPickerConfiguration alloc] init];
    configuration.filter = [PHPickerFilter imagesFilter];
    configuration.selectionLimit = limit;
    PHPickerViewController *picker = [[PHPickerViewController alloc] initWithConfiguration:configuration];
    picker.delegate = self;
    DshPresentWhenSettled(picker, ^{
      [self finishPending];
      reject(@"NO_ACTIVITY", @"当前没有可用的前台页面。", nil);
    });
  });
}

/** Drops the in-flight promise without resolving it — the call already failed. */
- (void)finishPending
{
  self.pendingResolve = nil;
  self.pendingReject = nil;
}

#pragma mark - PHPickerViewControllerDelegate

- (void)picker:(PHPickerViewController *)picker didFinishPicking:(NSArray<PHPickerResult *> *)results
{
  RCTPromiseResolveBlock resolve = self.pendingResolve;
  RCTPromiseRejectBlock reject = self.pendingReject;
  BOOL wantsMultiple = self.pendingWantsMultiple;
  double maxBytes = self.pendingMaxBytes;
  self.pendingResolve = nil;
  self.pendingReject = nil;

  [picker dismissViewControllerAnimated:YES completion:nil];
  if (resolve == nil) return;
  if (results.count == 0) {
    resolve(wantsMultiple ? @[] : nil);
    return;
  }

  dispatch_group_t group = dispatch_group_create();
  NSMutableArray *payloads = [NSMutableArray arrayWithCapacity:results.count];
  NSMutableArray *errors = [NSMutableArray array];
  NSLock *lock = [[NSLock alloc] init];
  NSUInteger expected = wantsMultiple ? results.count : 1;

  for (PHPickerResult *result in results) {
    NSItemProvider *provider = result.itemProvider;
    NSString *identifier = DshImageTypeIdentifierForProvider(provider);
    dispatch_group_enter(group);
    [provider loadDataRepresentationForTypeIdentifier:identifier
                                    completionHandler:^(NSData *data, NSError *error) {
      NSDictionary *payload = nil;
      if (data != nil && error == nil) {
        NSError *encodeError = nil;
        payload = DshImagePayload(data, provider.suggestedName, identifier, maxBytes, &encodeError);
        if (payload == nil && encodeError != nil) {
          [lock lock];
          [errors addObject:encodeError];
          [lock unlock];
        }
      } else if (error != nil) {
        [lock lock];
        [errors addObject:error];
        [lock unlock];
      }
      if (payload != nil) {
        [lock lock];
        [payloads addObject:payload];
        [lock unlock];
      }
      dispatch_group_leave(group);
    }];
  }

  dispatch_group_notify(group, dispatch_get_main_queue(), ^{
    if (payloads.count == 0) {
      NSError *first = errors.firstObject;
      if (first != nil && reject != nil) {
        reject(@"READ_FAILED", first.localizedDescription, first);
      } else if (resolve != nil) {
        resolve(wantsMultiple ? @[] : nil);
      }
      return;
    }
    if (!wantsMultiple) {
      resolve(payloads.firstObject);
      return;
    }
    resolve([payloads subarrayWithRange:NSMakeRange(0, MIN(expected, payloads.count))]);
  });
}

#pragma mark - UIImagePickerControllerDelegate

- (void)imagePickerController:(UIImagePickerController *)picker didFinishPickingMediaWithInfo:(NSDictionary<UIImagePickerControllerInfoKey, id> *)info
{
  RCTPromiseResolveBlock resolve = self.pendingResolve;
  RCTPromiseRejectBlock reject = self.pendingReject;
  double maxBytes = self.pendingMaxBytes;
  self.pendingResolve = nil;
  self.pendingReject = nil;

  UIImage *image = info[UIImagePickerControllerOriginalImage];
  [picker dismissViewControllerAnimated:YES completion:^{
    if (resolve == nil) return;
    NSData *jpeg = image != nil ? UIImageJPEGRepresentation(image, 0.9) : nil;
    NSError *error = nil;
    NSDictionary *payload = jpeg != nil
        ? DshImagePayload(jpeg, @"capture.jpg", UTTypeJPEG.identifier, maxBytes, &error)
        : nil;
    if (payload != nil) {
      resolve(payload);
    } else if (reject != nil) {
      reject(@"CAPTURE_READ_FAILED", error.localizedDescription ?: @"无法读取拍摄的照片。", error);
    }
  }];
}

- (void)imagePickerControllerDidCancel:(UIImagePickerController *)picker
{
  RCTPromiseResolveBlock resolve = self.pendingResolve;
  self.pendingResolve = nil;
  self.pendingReject = nil;
  [picker dismissViewControllerAnimated:YES completion:^{
    if (resolve != nil) resolve(nil);
  }];
}

@end
