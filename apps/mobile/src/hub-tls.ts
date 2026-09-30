/**
 * Hub TLS trust, installed from the pairing QR.
 *
 * The App carries no CA of its own: the QR is the only place trust can come
 * from, and the native layer installs that certificate as the anchor for the
 * address the same QR names. One build therefore reaches any self-hosted Hub,
 * and a rotation costs a re-scan instead of a reinstall.
 *
 * A QR without a certificate leaves the TLS check to the platform trust store,
 * which is what a Hub with a publicly signed certificate needs. A Hub with a
 * private CA and a certificate-less QR simply fails its handshake — there is
 * nothing left in the build to fall back to, on purpose.
 *
 * The certificate itself never reaches JavaScript's TLS stack, because there
 * isn't one: React Native's WebSocket runs on OkHttp (Android) and SocketRocket
 * (iOS), so both boundaries are native and this module is just the bridge.
 *
 * Every call here is best-effort. A build without the native module still
 * pairs against a Hub whose CA it happens to carry, so a missing module must
 * degrade to that rather than block onboarding.
 */
import { NativeModules } from 'react-native'

interface HubTlsModule {
  /** Stores `caBase64` as the anchor for `host`; resolves to its SHA-256. */
  saveAnchor(host: string, caBase64: string): Promise<string>
  /** Marks `host` as the address connection attempts will target. */
  activate(host: string): Promise<null>
  /** Drops the stored anchor for `host`. */
  clearAnchor(host: string): Promise<null>
}

/** The native anchor store, or null in a build that predates it. */
export function hubTls(): HubTlsModule | null {
  const candidate: unknown = NativeModules.DshHubTls
  return typeof candidate === 'object' && candidate !== null
    && typeof (candidate as HubTlsModule).saveAnchor === 'function'
    && typeof (candidate as HubTlsModule).activate === 'function'
    ? candidate as HubTlsModule
    : null
}

/**
 * Whether two fingerprints name the same certificate. Mirrors the plugin's
 * comparison (src/hub-ca.ts): case, separators and whitespace are formatting,
 * not identity, and an empty side never matches.
 */
export function sameFingerprint(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  const a = normalize(left)
  const b = normalize(right)
  return a !== '' && a === b
}

/**
 * The host part of a Hub URL.
 *
 * Anchors are stored by host, because that is the only thing the platform
 * hands a TLS check: iOS passes `SecTrustRef` + domain to the policy, and
 * Android's trust manager sees the socket, not the URL the app dialled.
 */
export function hubHostOf(hub: string): string {
  const trimmed = hub.trim()
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(trimmed)?.[1] ?? trimmed
  // Credentials in the authority are not part of the host, and an IPv6 literal
  // keeps its colons while losing its brackets.
  const withoutUser = authority.slice(authority.lastIndexOf('@') + 1)
  const host = withoutUser.startsWith('[')
    ? withoutUser.slice(1, withoutUser.indexOf(']'))
    : withoutUser.replace(/:\d+$/, '')
  return host.toLowerCase()
}

/** Whether a Hub address is reached over TLS at all (`ws://` is the dev rig). */
export function hubUsesTls(hub: string): boolean {
  return !/^ws:\/\//i.test(hub.trim())
}

/**
 * Installs the QR's certificate as the anchor for its Hub, and returns the
 * fingerprint the certificate actually has.
 *
 * Throws `hub-ca-invalid` when the certificate cannot be parsed and
 * `hub-ca-mismatch` when the QR's own fingerprint disagrees with it: the two
 * are the cases where pairing would otherwise fail later, at a handshake, with
 * nothing on screen to explain why.
 */
export async function installHubAnchor(
  hub: string,
  ca: string | undefined,
  caFp: string | undefined,
): Promise<string | null> {
  const native = hubTls()
  if (native === null || ca === undefined || ca === '') {
    // No certificate in the QR: nothing to install. The handshake then has to
    // satisfy the platform trust store, which only a publicly signed Hub will.
    await activateHub(hub)
    return null
  }

  if (!hubUsesTls(hub)) {
    // A certificate on a plaintext address would anchor nothing: there is no
    // TLS handshake to check it against.
    await activateHub(hub)
    return null
  }

  const host = hubHostOf(hub)
  let fingerprint: string
  try {
    fingerprint = await native.saveAnchor(host, ca)
  } catch {
    throw new Error('hub-ca-invalid')
  }
  if (caFp !== undefined && caFp !== '' && !sameFingerprint(caFp, fingerprint)) {
    throw new Error('hub-ca-mismatch')
  }
  return fingerprint
}

/** Points connection attempts at `host`; re-installs a stored anchor first. */
export async function activateHub(hub: string, ca?: string): Promise<void> {
  const native = hubTls()
  if (native === null) return
  const host = hubHostOf(hub)
  if (ca !== undefined && ca !== '') await native.saveAnchor(host, ca)
  else await native.activate(host)
}

/** Drops the anchor a pairing installed, when that pairing is removed. */
export async function clearHubAnchor(hub: string): Promise<void> {
  const native = hubTls()
  if (native === null) return
  await native.clearAnchor(hubHostOf(hub))
}
