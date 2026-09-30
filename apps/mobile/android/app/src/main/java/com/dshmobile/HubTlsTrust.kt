package com.dshmobile

import android.content.Context
import com.facebook.react.modules.network.OkHttpClientProvider
import java.security.KeyStore
import java.security.cert.CertPathValidator
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.PKIXParameters
import java.security.cert.TrustAnchor
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * TLS trust for the Hub, anchored on the certificate the pairing QR carried.
 *
 * Android's `network_security_config.xml` cannot express this: trust anchors
 * there are compile-time resources, so a build could only ever pin the one Hub
 * it shipped with. The check therefore moves to a trust manager installed on
 * React Native's own WebSocket client — the same client `nats.ws` dials
 * through — which is also where iOS's `SRSecurityPolicy` hook sits.
 *
 * Two rules keep this honest:
 *
 *   - the system trust store still decides first, so public CAs, a future
 *     public Hub and every other host behave exactly as React Native ships;
 *   - the only additional trust is the anchor a scan installed for that exact
 *     host, and the build carries none of its own. A rotated Hub is revoked by
 *     scanning again, not by waiting for a new APK, and a certificate-less QR
 *     leaves the Hub to the system store alone.
 */
internal class HubTlsTrustManager(
  private val delegate: X509TrustManager,
  private val anchors: () -> List<X509Certificate>,
) : X509TrustManager {

  override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) {
    delegate.checkClientTrusted(chain, authType)
  }

  override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) {
    var systemRefusal: CertificateException? = null
    try {
      delegate.checkServerTrusted(chain, authType)
      return
    } catch (error: CertificateException) {
      systemRefusal = error
    }

    val trusted = anchors()
    if (trusted.isEmpty()) throw systemRefusal
    try {
      validate(chain, trusted)
    } catch (error: Exception) {
      // Host name matching is OkHttp's own check and still applies; this only
      // answers "is this chain anchored in a certificate we were given".
      throw CertificateException(
        "dsh: the Hub's certificate chain is not anchored in any certificate this app was paired with",
        systemRefusal,
      )
    }
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = delegate.acceptedIssuers

  private fun validate(chain: Array<out X509Certificate>, trusted: List<X509Certificate>) {
    val path = CertificateFactory.getInstance("X.509").generateCertPath(chain.toList())
    val parameters = PKIXParameters(trusted.map { TrustAnchor(it, null) }.toSet())
    // The Hub is reached by address over a private CA; there is no CRL or OCSP
    // responder to ask, and asking would make the phone's handshake depend on
    // one more reachable service.
    parameters.isRevocationEnabled = false
    CertPathValidator.getInstance("PKIX").validate(path, parameters)
  }
}

/**
 * Installs the trust manager on React Native's OkHttp client.
 *
 * Must run before the first `getOkHttpClient()`, because that call caches the
 * client for the process — `MainApplication.onCreate` is the only place early
 * enough. The factory builds from `createClientBuilder()` rather than
 * `createClient()`, which would come straight back here.
 */
internal object HubTlsTrust {
  fun install(context: Context) {
    val app = context.applicationContext
    OkHttpClientProvider.setOkHttpClientFactory {
      val delegate = platformTrustManager()
      val trust = HubTlsTrustManager(delegate) { anchorsFor(app) }
      OkHttpClientProvider.createClientBuilder()
        .sslSocketFactory(SSLContext.getInstance("TLS").apply {
          init(null, arrayOf<X509TrustManager>(trust), null)
        }.socketFactory, trust)
        .build()
    }
  }

  /**
   * The anchors that apply right now: the certificate the current Hub was
   * paired with, and nothing else. The app ships no CA, so a host nobody has
   * scanned for is judged by the platform trust store alone.
   */
  private fun anchorsFor(context: Context): List<X509Certificate> {
    val host = HubTlsStore.activeHost(context)
    val stored = host?.let { HubTlsStore.storedAnchor(context, it) }
    return if (stored == null) emptyList() else listOf(stored)
  }

  /**
   * The platform's default manager, which honours the app's network security
   * config — the path every publicly signed Hub goes through.
   */
  private fun platformTrustManager(): X509TrustManager {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(null as KeyStore?)
    return factory.trustManagers.filterIsInstance<X509TrustManager>().first()
  }
}
