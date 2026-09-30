package com.dshmobile

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * The JavaScript surface of the Hub's TLS anchor store.
 *
 * `saveAnchor` is the only call that matters during onboarding: it is what
 * turns the certificate inside a pairing QR into trust for the address that
 * same QR names. It resolves with the certificate's SHA-256 so JS can check it
 * against the fingerprint the QR also carries, and rejects when the blob is
 * not a certificate at all — the two failures that would otherwise surface as
 * an unexplained handshake error on a phone.
 */
class HubTlsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "DshHubTls"

  @ReactMethod
  fun saveAnchor(host: String, caBase64: String, promise: Promise) {
    val certificate = parseCertificate(caBase64)
    if (certificate == null) {
      promise.reject("HUB_CA_INVALID", "Hub CA certificate could not be parsed")
      return
    }
    HubTlsStore.saveAnchor(reactContext, host, caBase64)
    promise.resolve(fingerprintOf(certificate))
  }

  @ReactMethod
  fun activate(host: String, promise: Promise) {
    HubTlsStore.activate(reactContext, host)
    promise.resolve(null)
  }

  @ReactMethod
  fun clearAnchor(host: String, promise: Promise) {
    HubTlsStore.clearAnchor(reactContext, host)
    promise.resolve(null)
  }
}
