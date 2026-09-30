package com.dshmobile

import android.content.Context
import android.content.SharedPreferences
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

/**
 * The Hub certificates this install has been paired with, and the host it is
 * currently dialling.
 *
 * The pairing QR carries the Hub's CA certificate and the App installs it here
 * (see apps/mobile/src/hub-tls.ts). Storage is per host on purpose: once a host
 * has an anchor from a scan, that anchor is the only thing trusted for it, so
 * re-scanning a Hub whose certificate was rotated is a real revocation instead
 * of something the CA the build happens to carry can override.
 */
internal object HubTlsStore {
  private const val FILE = "dsh-mobile-hub-tls"
  private const val KEY_ACTIVE = "active-host"
  private const val ANCHOR_PREFIX = "anchor:"

  /** Last host JS activated; also mirrored into storage for the next launch. */
  @Volatile
  private var active: String? = null

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  /**
   * Hosts are compared the way the platform hands them over: lower case, port
   * removed, IPv6 brackets stripped.
   */
  fun normalize(host: String): String {
    val trimmed = host.trim().lowercase()
    val unbracketed = if (trimmed.startsWith("[") && trimmed.contains(']')) {
      trimmed.substring(1, trimmed.indexOf(']'))
    } else {
      trimmed
    }
    // A bare IPv6 literal has several colons and no port; anything else keeps
    // only the part before the port separator.
    return if (unbracketed.count { it == ':' } > 1) unbracketed else unbracketed.substringBefore(':')
  }

  fun activate(context: Context, host: String) {
    val key = normalize(host)
    active = key
    prefs(context).edit().putString(KEY_ACTIVE, key).apply()
  }

  fun saveAnchor(context: Context, host: String, base64: String) {
    val key = normalize(host)
    prefs(context).edit().putString(ANCHOR_PREFIX + key, base64).apply()
    activate(context, key)
  }

  fun clearAnchor(context: Context, host: String) {
    val key = normalize(host)
    prefs(context).edit().remove(ANCHOR_PREFIX + key).apply()
  }

  /** The host connections target, from memory or from the last activation. */
  fun activeHost(context: Context): String? =
    active ?: prefs(context).getString(KEY_ACTIVE, null)

  /** The certificate a scan installed for `host`, or null when it has none. */
  fun storedAnchor(context: Context, host: String): X509Certificate? {
    val encoded = prefs(context).getString(ANCHOR_PREFIX + normalize(host), null) ?: return null
    return parseCertificate(encoded)
  }
}

/** Decodes a base64 DER certificate, or null when it is not one. */
internal fun parseCertificate(base64: String): X509Certificate? {
  val der = try {
    android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
  } catch (error: IllegalArgumentException) {
    return null
  }
  if (der.isEmpty()) return null
  return try {
    CertificateFactory.getInstance("X.509")
      .generateCertificate(der.inputStream()) as? X509Certificate
  } catch (error: java.security.cert.CertificateException) {
    null
  }
}

/** SHA-256 of a certificate, in the shape the console and the phone display. */
internal fun fingerprintOf(certificate: X509Certificate): String {
  val digest = java.security.MessageDigest.getInstance("SHA-256").digest(certificate.encoded)
  return digest.joinToString(":") { byte -> "%02X".format(byte) }
}
