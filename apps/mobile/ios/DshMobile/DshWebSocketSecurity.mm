/**
 * TLS trust for the Hub socket.
 *
 * The Android build trusts the dsh private CA by installing it as a trust
 * anchor in `network_security_config.xml`. iOS offers no such hook for a raw
 * stream, so this file uses the two seams React Native and SocketRocket already
 * expose:
 *
 *   1. `RCTSetCustomSRWebSocketProvider` lets the app build the `SRWebSocket`
 *      React Native uses for `new WebSocket(...)`.
 *   2. `SRSecurityPolicy` lets that socket decide how the server chain is
 *      evaluated.
 *
 * The policy accepts a server whose chain ends at a certificate this app was
 * told to trust for that exact host: the one the pairing QR carried. The app
 * carries no CA of its own, so every other host — a Hub with a publicly signed
 * certificate, GitHub release checks, a future public Hub — is left to the
 * system trust store, and a private CA never widens what the app trusts.
 */
#import "DshMobileNative.h"

#import <Security/Security.h>
#import <SocketRocket/SRSecurityPolicy.h>
#import <SocketRocket/SRWebSocket.h>

#include <arpa/inet.h>

@class SRWebSocket;

typedef SRWebSocket * (^DshSRWebSocketProvider)(NSURLRequest *request);

/**
 * React Native's hook (`React/CoreModules/RCTWebSocketModule.h`). Declared here
 * instead of imported so this file only needs headers the app target sees.
 */
extern "C" {
extern void RCTSetCustomSRWebSocketProvider(DshSRWebSocketProvider provider);
}

/** Marker React Native's provider would use; kept for protocol pass-through. */
static NSString *const DshWebSocketProtocolHeader = @"Sec-WebSocket-Protocol";

/**
 * Every `SecCertificateRef` the app trusts beyond the system store, for one
 * domain.
 *
 * A host the user has paired with has exactly one anchor: the certificate the
 * QR carried, stored by `DshHubTlsModule.mm`. A host nobody has scanned for has
 * none — the app ships no CA — and is therefore judged by the system trust
 * store alone.
 */
static NSArray *DshPinnedCertificatesForDomain(NSString *domain)
{
  SecCertificateRef stored = DshCopyHubAnchorForHost(domain);
  if (stored == NULL) return @[];
  return @[ (__bridge_transfer id)stored ];
}

#pragma mark - Minimal DER reader

/**
 * Just enough ASN.1 to pull the subjectAltName extension out of a leaf.
 *
 * iOS has no `SecCertificateCopyValues` (that is macOS-only), so an app that
 * wants to check a host name itself has to read the extension out of the DER.
 * Only definite-length, low-tag-number encodings are handled — which is all DER
 * permits for the structures involved.
 */
typedef struct {
  const uint8_t *cursor;
  const uint8_t *end;
} DshDERReader;

static DshDERReader DshDERReaderMake(const uint8_t *bytes, size_t length)
{
  DshDERReader reader = { bytes, bytes + length };
  return reader;
}

/** Reads one TLV, advancing the reader past it. */
static BOOL DshDERReadTLV(DshDERReader *reader,
                          uint8_t *outTag,
                          const uint8_t **outValue,
                          size_t *outLength)
{
  if (reader->cursor >= reader->end) return NO;

  uint8_t tag = *reader->cursor++;
  if ((tag & 0x1F) == 0x1F) return NO;  // high-tag-number form: never needed here

  if (reader->cursor >= reader->end) return NO;
  uint8_t first = *reader->cursor++;
  size_t length = 0;
  if ((first & 0x80) == 0) {
    length = first;
  } else {
    size_t octets = first & 0x7F;
    if (octets == 0 || octets > sizeof(size_t)) return NO;
    if ((size_t)(reader->end - reader->cursor) < octets) return NO;
    for (size_t index = 0; index < octets; index++) {
      length = (length << 8) | (size_t)*reader->cursor++;
    }
  }
  if ((size_t)(reader->end - reader->cursor) < length) return NO;

  if (outTag != NULL) *outTag = tag;
  if (outValue != NULL) *outValue = reader->cursor;
  if (outLength != NULL) *outLength = length;
  reader->cursor += length;
  return YES;
}

/** OID 2.5.29.17, subjectAltName. */
static const uint8_t DshOIDSubjectAltName[] = { 0x55, 0x1D, 0x11 };

/**
 * Locates the subjectAltName extension value (the bytes inside its OCTET
 * STRING) in a DER certificate.
 */
static BOOL DshDERFindSubjectAltName(const uint8_t *der,
                                     size_t derLength,
                                     const uint8_t **outValue,
                                     size_t *outLength)
{
  uint8_t tag;
  const uint8_t *value;
  size_t length;

  // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
  DshDERReader certificate = DshDERReaderMake(der, derLength);
  if (!DshDERReadTLV(&certificate, &tag, &value, &length) || tag != 0x30) return NO;

  // TBSCertificate ::= SEQUENCE { version, serialNumber, ..., extensions [3] }
  DshDERReader tbs = DshDERReaderMake(value, length);
  if (!DshDERReadTLV(&tbs, &tag, &value, &length) || tag != 0x30) return NO;

  DshDERReader fields = DshDERReaderMake(value, length);
  const uint8_t *extensions;
  size_t extensionsLength = 0;
  while (DshDERReadTLV(&fields, &tag, &value, &length)) {
    if (tag != 0xA3) continue;  // [3] EXPLICIT Extensions
    DshDERReader wrapper = DshDERReaderMake(value, length);
    if (DshDERReadTLV(&wrapper, &tag, &value, &length) && tag == 0x30) {
      extensions = value;
      extensionsLength = length;
    }
    break;
  }
  if (extensionsLength == 0) return NO;

  // Extensions ::= SEQUENCE OF Extension
  DshDERReader list = DshDERReaderMake(extensions, extensionsLength);
  while (DshDERReadTLV(&list, &tag, &value, &length)) {
    if (tag != 0x30) continue;

    DshDERReader extension = DshDERReaderMake(value, length);
    if (!DshDERReadTLV(&extension, &tag, &value, &length) || tag != 0x06) continue;
    if (length != sizeof(DshOIDSubjectAltName)) continue;
    if (memcmp(value, DshOIDSubjectAltName, sizeof(DshOIDSubjectAltName)) != 0) continue;

    // extnValue: BOOLEAN critical is optional, then the value OCTET STRING.
    if (!DshDERReadTLV(&extension, &tag, &value, &length)) continue;
    if (tag == 0x01 && !DshDERReadTLV(&extension, &tag, &value, &length)) continue;
    if (tag != 0x04) continue;  // OCTET STRING
    *outValue = value;
    *outLength = length;
    return YES;
  }
  return NO;
}

#pragma mark - Host name matching

/** RFC 6125 style match: an exact name, or `*.` covering exactly one label. */
static BOOL DshHostMatchesDNSName(NSString *host, const uint8_t *name, size_t nameLength)
{
  NSString *candidate = [[NSString alloc] initWithBytes:name
                                                 length:nameLength
                                               encoding:NSASCIIStringEncoding];
  if (candidate.length == 0) return NO;

  if (![candidate hasPrefix:@"*."]) {
    return [host caseInsensitiveCompare:candidate] == NSOrderedSame;
  }

  NSString *suffix = [candidate substringFromIndex:2];
  if (![host.lowercaseString hasSuffix:suffix.lowercaseString]) return NO;
  // The wildcard stands for one label, so `a.example.com` matches but
  // `a.b.example.com` does not.
  NSString *prefix = [host substringToIndex:host.length - suffix.length];
  if (prefix.length < 2 || ![prefix hasSuffix:@"."]) return NO;
  return [prefix rangeOfString:@"."].location == prefix.length - 1;
}

/** Compares a raw SAN iPAddress against the host, IPv4 or IPv6. */
static BOOL DshHostMatchesIPAddress(NSString *host, const uint8_t *address, size_t addressLength)
{
  const char *text = host.UTF8String;
  if (text == NULL) return NO;

  if (addressLength == 4) {
    struct in_addr parsed;
    if (inet_pton(AF_INET, text, &parsed) != 1) return NO;
    return memcmp(&parsed, address, 4) == 0;
  }
  if (addressLength == 16) {
    struct in6_addr parsed;
    if (inet_pton(AF_INET6, text, &parsed) != 1) return NO;
    return memcmp(&parsed, address, 16) == 0;
  }
  return NO;
}

/** Whether the leaf's subjectAltName covers `host`. */
static BOOL DshLeafCertificateMatchesHost(SecTrustRef serverTrust, NSString *host)
{
  if (host.length == 0) return NO;

  CFArrayRef chain = SecTrustCopyCertificateChain(serverTrust);
  if (chain == NULL) return NO;
  SecCertificateRef leaf = (SecCertificateRef)CFArrayGetValueAtIndex(chain, 0);
  if (leaf == NULL) {
    CFRelease(chain);
    return NO;
  }
  SecCertificateRef retained = (SecCertificateRef)CFRetain(leaf);
  CFRelease(chain);

  CFDataRef der = SecCertificateCopyData(retained);
  CFRelease(retained);
  if (der == NULL) return NO;

  // The SAN value points into `der`, so the data stays retained for the whole
  // walk below.
  BOOL matches = NO;
  const uint8_t *san = NULL;
  size_t sanLength = 0;
  if (DshDERFindSubjectAltName(CFDataGetBytePtr(der), (size_t)CFDataGetLength(der),
                               &san, &sanLength)) {
    // GeneralNames ::= SEQUENCE OF GeneralName
    DshDERReader names = DshDERReaderMake(san, sanLength);
    uint8_t tag;
    const uint8_t *value;
    size_t length;
    if (DshDERReadTLV(&names, &tag, &value, &length) && tag == 0x30) {
      DshDERReader entries = DshDERReaderMake(value, length);
      while (!matches && DshDERReadTLV(&entries, &tag, &value, &length)) {
        if (tag == 0x82 && DshHostMatchesDNSName(host, value, length)) matches = YES;     // dNSName
        if (tag == 0x87 && DshHostMatchesIPAddress(host, value, length)) matches = YES;  // iPAddress
      }
    }
  }
  CFRelease(der);
  return matches;
}

#pragma mark - Chain validation

/** Rebuilds the received chain under `policy`, anchored only in `anchors`. */
static BOOL DshChainMatchesPinnedCA(SecTrustRef serverTrust, SecPolicyRef policy, NSArray *anchors)
{
  if (serverTrust == NULL || policy == NULL || anchors.count == 0) return NO;

  CFArrayRef chain = SecTrustCopyCertificateChain(serverTrust);
  if (chain == NULL) return NO;

  SecTrustRef pinned = NULL;
  OSStatus status = SecTrustCreateWithCertificates(chain, policy, &pinned);
  CFRelease(chain);
  if (status != errSecSuccess || pinned == NULL) return NO;

  SecTrustSetAnchorCertificates(pinned, (__bridge CFArrayRef)anchors);
  SecTrustSetAnchorCertificatesOnly(pinned, true);

  CFErrorRef error = NULL;
  BOOL trusted = SecTrustEvaluateWithError(pinned, &error);
#if DEBUG
  if (!trusted) NSLog(@"[dsh-tls] chain rejected under pinned CA: %@", error);
#endif
  if (error != NULL) CFRelease(error);
  CFRelease(pinned);
  return trusted;
}

/**
 * Whether the server's chain is anchored in the CA this host was paired with
 * *and* the chain is valid for `domain`.
 *
 * The stock SSL policy is tried first, because it enforces serverAuth EKU on
 * top of the chain and host checks. The Hub's certificate is minted from
 * `certs/san.ext`, which predates that requirement — it carries an IP SAN but
 * no extendedKeyUsage — and Apple rejects it with `-67609 certificate is not
 * permitted for this usage`. That combination (pinned root + host name match)
 * is exactly what Android's `network_security_config.xml` does for this Hub, so
 * the fallback keeps both platforms on the same rule rather than widening what
 * the app trusts. Re-signing the Hub certificate with `extendedKeyUsage =
 * serverAuth` makes the strict path apply again with no app change.
 */
static BOOL DshServerTrustMatchesPinnedCA(SecTrustRef serverTrust, NSString *domain)
{
  NSArray *anchors = DshPinnedCertificatesForDomain(domain);
  if (anchors.count == 0 || serverTrust == NULL) return NO;

  SecPolicyRef sslPolicy = SecPolicyCreateSSL(true, (__bridge CFStringRef)domain);
  BOOL trusted = DshChainMatchesPinnedCA(serverTrust, sslPolicy, anchors);
  CFRelease(sslPolicy);
  if (trusted) return YES;

  SecPolicyRef basicPolicy = SecPolicyCreateBasicX509();
  trusted = DshChainMatchesPinnedCA(serverTrust, basicPolicy, anchors);
  CFRelease(basicPolicy);
  if (!trusted) return NO;
  return DshLeafCertificateMatchesHost(serverTrust, domain);
}

#pragma mark - Security policy

@interface DshHubSecurityPolicy : SRSecurityPolicy
@end

@implementation DshHubSecurityPolicy

/**
 * CFStream must hand this policy the finished handshake instead of rejecting an
 * unknown issuer on its own; `evaluateServerTrust:` below is what decides.
 *
 * Mirrors `SRSecurityPolicy.updateSecurityOptionsInStream:` — both options, in
 * this order, with chain validation off. Setting only the boolean without the
 * settings dictionary leaves CFNetwork validating as usual, which is how the
 * first attempt at this failed with `errSSLXCertChainInvalid`.
 */
- (void)updateSecurityOptionsInStream:(NSStream *)stream
{
  [stream setProperty:(__bridge id)kCFStreamSocketSecurityLevelNegotiatedSSL
               forKey:(__bridge NSString *)kCFStreamPropertySocketSecurityLevel];
  NSDictionary *options = @{ (__bridge NSString *)kCFStreamSSLValidatesCertificateChain : @NO };
  [stream setProperty:options forKey:(__bridge NSString *)kCFStreamPropertySSLSettings];
}

- (BOOL)evaluateServerTrust:(SecTrustRef)serverTrust forDomain:(NSString *)domain
{
  BOOL pinned = DshServerTrustMatchesPinnedCA(serverTrust, domain);
#if DEBUG
  // Only in debug builds: a Hub that suddenly stops matching here is the one
  // failure this file cannot explain through its own return value.
  NSLog(@"[dsh-tls] %@ pinned=%d", domain, pinned);
#endif
  if (pinned) return YES;

  // Not the dsh Hub: leave ordinary TLS to the system trust store, which is
  // what an unmodified React Native app would have done.
  CFErrorRef error = NULL;
  BOOL trusted = SecTrustEvaluateWithError(serverTrust, &error);
  if (error != NULL) CFRelease(error);
  return trusted;
}

@end

#pragma mark - Install

void DshInstallWebSocketSecurity(void)
{
  RCTSetCustomSRWebSocketProvider(^SRWebSocket *(NSURLRequest *request) {
    // React Native hands the provider only the request; the JS side of this app
    // opens `wss://` without sub-protocols, and anything that did ask for one is
    // carried in this header.
    NSString *requested = [request valueForHTTPHeaderField:DshWebSocketProtocolHeader];
    NSArray *protocols = requested.length > 0
        ? [requested componentsSeparatedByString:@","]
        : nil;
    return [[SRWebSocket alloc] initWithURLRequest:request
                                         protocols:protocols
                                    securityPolicy:[[DshHubSecurityPolicy alloc] init]];
  });
}
