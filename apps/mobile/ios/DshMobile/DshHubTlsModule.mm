/**
 * Hub TLS anchors, the iOS half of `HubTlsModule.kt`.
 *
 * The pairing QR carries the Hub's CA certificate, and this is where iOS keeps
 * it: per host, in `NSUserDefaults`, which is the same store the Theme module
 * already uses for its one setting. `DshWebSocketSecurity.mm` reads it back
 * while evaluating the handshake — that file owns the trust decision, this one
 * only owns the bytes.
 *
 * Per host matters: once a host has an anchor from a scan, that anchor is the
 * only extra thing trusted for it, so re-scanning a Hub whose certificate was
 * rotated is a real revocation rather than something the CA this build carries
 * can override.
 */
#import "DshMobileNative.h"

#import <CommonCrypto/CommonDigest.h>
#import <React/RCTBridgeModule.h>
#import <Security/Security.h>

NSString *const DshHubAnchorsDefaultsKey = @"dsh_hub_tls_anchors";

/** Hosts are compared the way the platform hands them over: lower case, no brackets. */
static NSString *DshNormalizedHost(NSString *host)
{
  NSString *trimmed = [host stringByTrimmingCharactersInSet:
                          [NSCharacterSet whitespaceAndNewlineCharacterSet]].lowercaseString;
  if ([trimmed hasPrefix:@"["] && [trimmed containsString:@"]"]) {
    return [trimmed substringWithRange:NSMakeRange(1, [trimmed rangeOfString:@"]"].location - 1)];
  }
  return trimmed;
}

/** Uppercase colon-separated SHA-256, the shape the console and `openssl` print. */
static NSString *DshFingerprintOfCertificate(SecCertificateRef certificate)
{
  CFDataRef der = SecCertificateCopyData(certificate);
  if (der == NULL) return nil;

  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(CFDataGetBytePtr(der), (CC_LONG)CFDataGetLength(der), digest);
  CFRelease(der);

  NSMutableString *text = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 3];
  for (int index = 0; index < CC_SHA256_DIGEST_LENGTH; index++) {
    if (index > 0) [text appendString:@":"];
    [text appendFormat:@"%02X", digest[index]];
  }
  return text;
}

SecCertificateRef DshCopyHubAnchorForHost(NSString *host)
{
  NSDictionary *anchors = [[NSUserDefaults standardUserDefaults] dictionaryForKey:DshHubAnchorsDefaultsKey];
  NSString *encoded = anchors[DshNormalizedHost(host)];
  if (![encoded isKindOfClass:[NSString class]] || encoded.length == 0) return NULL;

  NSData *der = [[NSData alloc] initWithBase64EncodedString:encoded
                                                    options:NSDataBase64DecodingIgnoreUnknownCharacters];
  if (der == nil) return NULL;
  return SecCertificateCreateWithData(NULL, (__bridge CFDataRef)der);
}

@interface DshHubTls : NSObject <RCTBridgeModule>
@end

@implementation DshHubTls

RCT_EXPORT_MODULE(DshHubTls)

RCT_EXPORT_METHOD(saveAnchor : (NSString *)host caBase64 : (NSString *)caBase64 resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  NSData *der = [[NSData alloc] initWithBase64EncodedString:caBase64
                                                    options:NSDataBase64DecodingIgnoreUnknownCharacters];
  SecCertificateRef certificate = der == nil ? NULL : SecCertificateCreateWithData(NULL, (__bridge CFDataRef)der);
  if (certificate == NULL) {
    reject(@"HUB_CA_INVALID", @"Hub CA certificate could not be parsed", nil);
    return;
  }
  NSString *fingerprint = DshFingerprintOfCertificate(certificate);
  CFRelease(certificate);

  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  NSDictionary *existing = [defaults dictionaryForKey:DshHubAnchorsDefaultsKey] ?: @{};
  NSMutableDictionary *anchors = [existing mutableCopy];
  anchors[DshNormalizedHost(host)] = caBase64;
  [defaults setObject:[anchors copy] forKey:DshHubAnchorsDefaultsKey];

  resolve(fingerprint);
}

RCT_EXPORT_METHOD(activate : (NSString *)host resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  // iOS evaluates each handshake against the anchor stored for the domain it is
  // connecting to, so there is no "current Hub" to point at. The method exists
  // so both platforms answer the same JavaScript.
  resolve(nil);
}

RCT_EXPORT_METHOD(clearAnchor : (NSString *)host resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  NSDictionary *existing = [defaults dictionaryForKey:DshHubAnchorsDefaultsKey];
  if (existing == nil) {
    resolve(nil);
    return;
  }
  NSMutableDictionary *anchors = [existing mutableCopy];
  [anchors removeObjectForKey:DshNormalizedHost(host)];
  [defaults setObject:[anchors copy] forKey:DshHubAnchorsDefaultsKey];
  resolve(nil);
}

@end
