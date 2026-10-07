/**
 * Onboarding: paste the QR payload (JSON) from the dsh settings card, redeem
 * the code, store the token. VisionCamera scans QR codes while the manual
 * paste path remains the always-available fallback.
 */
import React, { useEffect, useRef, useState } from 'react'
import { BackHandler, Keyboard, Platform, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native'
import { Camera, type CameraRuntimeError, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera'
import { connect, headers } from 'nats.ws'
import { redeemPairingCode, type PairingQrPayload } from '@dsh-mobile/protocol'
import { getInstallationId } from '../installation-id'
import { colors, fontSize, radius, spacing } from '../theme'
import type { PairingResult } from '../pairing-store'
import { installHubAnchor } from '../hub-tls'
import { useI18n, type TranslationKey } from '../i18n'
import { Icon } from '../icons'

interface Props {
  onPaired: (result: PairingResult) => void
  /**
   * What this phone calls itself, sent with the redeem so the plugin's device
   * roster names the phone instead of its platform.
   */
  deviceName: string
  onSystemBack?: () => boolean
}

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

/**
 * Zoom the scanner starts at.
 *
 * A dsh pairing QR is 105 modules wide — it carries the Hub's CA certificate —
 * and a phone held at a comfortable distance from a laptop screen lands around
 * four pixels per module, which is where ML Kit's QR detector gives up. Two
 * factors is enough to double that without narrowing the view so far that the
 * code falls out of it; the preview shows the zoomed image, so the user frames
 * what they see either way, and the pinch gesture still adjusts from here.
 */
const SCAN_ZOOM = 2

/**
 * One readable line for anything a `catch` can hand us.
 *
 * `nats.ws` throws `NatsError`s whose meaning lives in `code`, and whose
 * `message` is often empty — the pairing screen used to call `.trim()` on the
 * result and die with `Cannot read property 'trim' of undefined`, which is what
 * a phone showed when the Hub's TLS handshake failed.
 */
function describeError(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause instanceof Error) {
    const raw: unknown = (cause as unknown as { code?: unknown }).code
    const code = typeof raw === 'string' ? raw : ''
    const message = typeof cause.message === 'string' ? cause.message : ''
    // `wss` transport failures carry the code alone, and NATS's own "503" is
    // both — printing "503 [503]" would only make the mapper's job harder.
    if (message === '') return code === '' ? cause.name : `${cause.name} [${code}]`
    return code === '' || message.includes(code) ? message : `${message} [${code}]`
  }
  return String(cause)
}

function pairingErrorMessage(cause: unknown, t: Translate): string {
  const text = describeError(cause).trim()
  if (text === 'mobile-pair-failed') return t('pairing.codeFailed')
  if (text === 'mobile-device-limit') return t('pairing.deviceLimit')
  if (text === 'pairing-expired') return t('pairing.expired')
  if (text === 'pairing-version-unsupported') return t('pairing.versionUnsupported')
  // The QR's own certificate did not survive the trip, or disagrees with the
  // fingerprint printed beside it. Both are the App refusing to trust a Hub it
  // cannot verify, and both are fixed by minting a fresh QR on the desktop.
  if (text === 'hub-ca-invalid') return t('pairing.caInvalid')
  if (text === 'hub-ca-mismatch') return t('pairing.caMismatch')
  // Hub rejected the account credentials the QR carried. The raw NATS text
  // ("Authorization Violation") says nothing about which side to fix.
  if (text.includes('Authorization Violation')) return t('pairing.authFailed')
  // NATS reports a request to a subject nobody serves with code and message
  // "503". At pairing time that means the QR came from a machine whose dsh is
  // not on the Hub — the phone reaches the Hub fine, the host is simply absent.
  if (text === '503' || text.includes('no responders')) return t('pairing.bridgeOffline')
  if (text.includes('Failed to fetch') || text.includes('Network request failed')) {
    return t('pairing.networkFailed')
  }
  if (text === '' || text.includes('NatsError') || text.includes('WebSocket')) {
    return t('pairing.natsFailed')
  }
  if (text.startsWith('console /pair HTTP')) return t('pairing.httpFailed', { status: text.split(' ').at(-1) ?? '' })
  if (text === 'console /pair: no payload') return t('pairing.noPayload')
  if (text.startsWith('missing-field:')) {
    const field = text.slice('missing-field:'.length)
    // hub/user/pass are the Hub credentials the desktop plugin must supply;
    // an empty one means the QR was minted before the card was configured.
    return field === 'hub' || field === 'user' || field === 'pass'
      ? t('pairing.missingHubCredential', { field })
      : t('pairing.missingField', { field })
  }
  return t('pairing.failed', { message: text })
}

function parseQr(text: string): PairingQrPayload {
  const parsed = JSON.parse(text) as Partial<PairingQrPayload>
  if (parsed.version !== undefined && parsed.version !== 1) {
    throw new Error('pairing-version-unsupported')
  }
  if (typeof parsed.expiresAt === 'number' && parsed.expiresAt <= Date.now()) {
    throw new Error('pairing-expired')
  }
  for (const key of ['hub', 'user', 'pass', 'instance', 'code'] as const) {
    if (typeof parsed[key] !== 'string' || parsed[key] === '') {
      throw new Error(`missing-field:${key}`)
    }
  }
  // `ca` only exists on QRs minted by a plugin that carries one; an empty
  // string means the same thing as absent.
  const { ca, ...rest } = parsed
  return {
    caFp: '',
    ...rest,
    ...(typeof ca === 'string' && ca !== '' ? { ca } : {}),
  } as PairingQrPayload
}

export function PairingScreen({ onPaired, deviceName, onSystemBack }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [text, setText] = useState('')
  // The dev rig reaches the host machine: an Android emulator through its
  // 10.0.2.2 alias, an iOS simulator through loopback (which is the Mac).
  const [localHost, setLocalHost] = useState(Platform.OS === 'ios' ? '127.0.0.1' : '10.0.2.2')
  const [localWebPort, setLocalWebPort] = useState('3080')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraKey, setCameraKey] = useState(0)
  const [scannerOpen, setScannerOpen] = useState(false)
  const device = useCameraDevice('back')
  const { hasPermission, requestPermission } = useCameraPermission()
  const scanned = useRef(false)

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!scannerOpen) return onSystemBack?.() ?? false
      setScannerOpen(false)
      setCameraError(null)
      scanned.current = false
      return true
    })
    return () => subscription.remove()
  }, [onSystemBack, scannerOpen])

  const pairWith = async (payload: PairingQrPayload): Promise<void> => {
    setBusy(true)
    setError(null)
    let nc: Awaited<ReturnType<typeof connect>> | null = null
    try {
      // Trust for this Hub arrives inside the QR, so the anchor has to be
      // installed before the first handshake — this is the only moment the App
      // can learn it. A QR without a certificate leaves whatever the build
      // pins in place, which is how every existing pairing works.
      await installHubAnchor(payload.hub, payload.ca, payload.caFp)
      nc = await connect({ servers: payload.hub, user: payload.user, pass: payload.pass })
      // The name is what the desktop console shows in its device roster, so it
      // has to say which phone actually paired — not just which platform it
      // runs on. It is also restated on every later `hello`, so renaming the
      // phone does not need another pairing round.
      const installationId = await getInstallationId()
      const device = await redeemPairingCode(nc, headers, payload.instance, payload.code, deviceName, {
        installationId,
      })
      onPaired({ ...payload, ...device, installationId: device.installationId ?? installationId })
    } catch (cause) {
      // The code, not just the stack: `nats.ws` puts the reason there and
      // leaves the stack looking identical for every transport failure.
      console.error('[pairing]', describeError(cause), cause instanceof Error ? cause.stack : cause)
      setError(pairingErrorMessage(cause, t))
    } finally {
      setBusy(false)
      if (nc !== null) await nc.close().catch(() => undefined)
    }
  }

  const pair = async (): Promise<void> => {
    try {
      // Keep the pasted payload authoritative. Public deployments use the
      // wss Hub address from the backend; only the explicit local-dev button
      // rewrites the route for an emulator.
      await pairWith(parseQr(text.trim()))
    } catch (cause) {
      console.error('[pairing-parse]', cause instanceof Error ? cause.stack : cause)
      setError(pairingErrorMessage(cause, t))
    }
  }

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: codes => {
      if (scanned.current || busy) return
      const value = codes[0]?.value
      if (value === undefined || value === '') return
      scanned.current = true
      setText(value)
      setError(null)
      setCameraError(null)
      setScannerOpen(false)
      scanned.current = false
    },
  })

  const handleCameraError = (cause: CameraRuntimeError): void => {
    console.error('[camera]', cause.code, cause.message)
    setCameraError(t('pairing.cameraFailed'))
  }

  const retryCamera = async (): Promise<void> => {
    setCameraError(null)
    if (!hasPermission) {
      await requestPermission()
      return
    }
    setCameraKey(value => value + 1)
  }

  /** Dev loopback rig: pairs against scripts/fake-host.mjs (10.0.2.2 = host). */
  const pairDemo = async (): Promise<void> => {
    await pairWith({
      hub: `ws://${localHost.trim()}:8333`,
      user: 'demo',
      pass: 'demo',
      instance: 'demo',
      caFp: '',
      code: 'GOOD-CODE',
    })
  }

  /** Dev loopback rig 2: fetches a real pairing payload from the local dsh
   * console (/mobile-bridge) and pairs against it — the full plugin path. */
  const pairRealDsh = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const host = localHost.trim()
      const port = Number(localWebPort.trim())
      if (host === '' || host.includes('/') || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('invalid local host or port')
      }
      const baseUrl = `http://${host}:${String(port)}`
      /**
       * The console refuses a mutating request unless it carries its own header
       * and a JSON content type (its same-origin / CSRF boundary — plugin
       * 0.2.13 hardened this), so this dev shortcut presented itself as a bare
       * POST and started answering 403. It is the console's own client, so it
       * sends what the console asks for.
       *
       * It also insists the request's `Host` is loopback, so an emulator has to
       * reach it through `adb reverse tcp:3080 tcp:3080` and name `127.0.0.1` in
       * the host field above — the host-mapped alias `10.0.2.2` is refused before
       * any of this. Pair the websocket the same way (`adb reverse tcp:8443`).
       */
      const res = await fetch(`${baseUrl}/mobile-bridge/api/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-mobile-console': '1' },
        body: '{}',
      })
      if (!res.ok) throw new Error(`console /pair HTTP ${res.status}`)
      const body = await res.json() as { payload?: PairingQrPayload }
      if (body.payload === undefined) throw new Error('console /pair: no payload')
      // In React-Native dev builds the emulator cannot reach a host loopback
      // listener or the production TLS Hub address. Use the host-mapped local
      // NATS WebSocket while retaining the Hub payload for release builds — but
      // only for the plaintext stand-in. A payload carrying a certificate names
      // a Hub this device is meant to reach over TLS, and rewriting it to `ws`
      // would skip the very handshake the certificate is there to secure.
      const hubHost = host
      const devPayload = body.payload.ca === undefined
        ? { ...body.payload, hub: `ws://${hubHost}:8443`, caFp: '' }
        : body.payload
      await pairWith(__DEV__ ? devPayload : body.payload)
    } catch (cause) {
      console.error('[pairing]', describeError(cause), cause instanceof Error ? cause.stack : cause)
      setError(pairingErrorMessage(cause, t))
      setBusy(false)
    }
  }

  if (scannerOpen && hasPermission && device !== undefined && device !== null) {
    return (
      <View style={styles.scannerScreen}>
        <Camera
          key={cameraKey}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
          codeScanner={codeScanner}
          // A dsh pairing QR is dense (it carries the Hub's CA certificate), so
          // the scan is often a matter of getting a few more pixels per module.
          // Pinch-to-zoom is how the user buys them when the QR sits on a screen
          // they cannot walk closer to.
          zoom={SCAN_ZOOM}
          enableZoomGesture
          // Texture preview is what keeps the scanner usable on top of Android's
          // view hierarchy; iOS has no such switch and ignores the prop.
          androidPreviewViewType={Platform.OS === 'android' ? 'texture-view' : undefined}
          onInitialized={() => setCameraError(null)}
          onError={handleCameraError}
        />
        <View pointerEvents="none" style={styles.scannerShade}>
          <View style={styles.scanFrame} />
          <Text style={styles.scanText}>{t('pairing.scanHint')}</Text>
        </View>
        <View style={styles.scannerTopBar}>
          <TouchableOpacity
            style={styles.scannerBackButton}
            onPress={() => { setScannerOpen(false); setCameraError(null) }}
            accessibilityRole="button"
            accessibilityLabel={t('pairing.closeScanner')}
            hitSlop={8}
          >
            <Icon name="ChevronLeftOutline" size={16} color="#fff" />
            <Text style={styles.scannerBackText}>{t('pairing.closeScanner')}</Text>
          </TouchableOpacity>
        </View>
        {cameraError !== null && (
          <View style={styles.cameraErrorOverlay}>
            <Text style={styles.cameraErrorText}>{cameraError}</Text>
            <TouchableOpacity
              style={styles.scanRetryButton}
              onPress={() => void retryCamera()}
              accessibilityRole="button"
              accessibilityLabel={t('common.retry')}
            >
              <Text style={styles.cameraRetryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    )
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.root}>
      <Text style={styles.title}>{t('pairing.title')}</Text>
      <Text style={styles.hint}>
        {t('pairing.hint')}
      </Text>
      {hasPermission && device !== undefined && device !== null ? (
        <TouchableOpacity style={styles.scanLauncherButton} onPress={() => setScannerOpen(true)}>
          <Text style={styles.scanOpenButtonText}>{t('pairing.openScanner')}</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.scanFallback}>
          <Text style={styles.scanFallbackText}>
            {hasPermission ? t('pairing.noCamera') : t('pairing.cameraPermission')}
          </Text>
          {!hasPermission && (
            <TouchableOpacity style={styles.scanOpenButton} onPress={() => void requestPermission()}>
              <Text style={styles.scanOpenButtonText}>{t('pairing.allowCamera')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          multiline
          placeholder={t('pairing.pastePlaceholder')}
          placeholderTextColor={colors.textDim}
          value={text}
          onChangeText={value => { setText(value); if (error !== null) setError(null) }}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {text !== '' && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => { setText(''); setError(null) }}
            accessibilityRole="button"
            accessibilityLabel={t('common.clear')}
            hitSlop={8}
          >
            <Icon name="CloseOutline" size={16} color={colors.textDim} />
          </TouchableOpacity>
        )}
      </View>
      {__DEV__ && (
        <View style={styles.localDevFields}>
          <TextInput
            style={styles.localDevInput}
            value={localHost}
            onChangeText={setLocalHost}
            placeholder={t('pairing.localHost')}
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TextInput
            style={[styles.localDevInput, styles.localPortInput]}
            value={localWebPort}
            onChangeText={setLocalWebPort}
            placeholder={t('pairing.localPort')}
            placeholderTextColor={colors.textDim}
            keyboardType="number-pad"
          />
        </View>
      )}
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity
        style={[styles.button, (busy || text.trim() === '') && styles.buttonDisabled]}
        disabled={busy || text.trim() === ''}
        onPress={() => void pair()}
      >
        <Text style={[styles.buttonText, (busy || text.trim() === '') && styles.buttonTextDisabled]}>
          {busy ? t('pairing.pairing') : t('pairing.pairAndConnect')}
        </Text>
      </TouchableOpacity>
      {__DEV__ && (
        <TouchableOpacity style={[styles.button, styles.demoButton]} disabled={busy} onPress={() => void pairDemo()}>
          <Text style={styles.demoButtonText}>{t('pairing.demo')}</Text>
        </TouchableOpacity>
      )}
      {__DEV__ && (
        <TouchableOpacity style={[styles.button, styles.demoButton]} disabled={busy} onPress={() => void pairRealDsh()}>
          <Text style={styles.demoButtonText}>{t('pairing.realLocal')}</Text>
        </TouchableOpacity>
      )}
      </View>
    </TouchableWithoutFeedback>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing(5), justifyContent: 'center' },
  title: { color: colors.text, fontSize: 22, fontWeight: '600', marginBottom: spacing(2) },
  hint: { color: colors.textDim, fontSize: fontSize.small, lineHeight: 20, marginBottom: spacing(4) },
  scannerScreen: { flex: 1, backgroundColor: '#000' },
  scannerTopBar: {
    position: 'absolute',
    top: spacing(6),
    left: spacing(4),
    right: spacing(4),
    zIndex: 2,
  },
  scannerBackButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing(2),
  },
  scannerBackText: { color: '#fff', fontSize: fontSize.body, fontWeight: '600' },
  scannerShade: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  scanFrame: {
    width: 264,
    height: 264,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: radius.card,
    backgroundColor: 'transparent',
  },
  scanText: {
    marginTop: spacing(4),
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 6,
    overflow: 'hidden',
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1.5),
    fontSize: fontSize.small,
    textAlign: 'center',
  },
  /** Standalone scan entry: the card that used to frame it only repeated the
   *  instruction the scanner screen already shows. */
  scanLauncherButton: {
    alignSelf: 'center',
    marginBottom: spacing(4),
    paddingHorizontal: spacing(6),
    paddingVertical: spacing(3),
    borderRadius: radius.card,
    backgroundColor: colors.accent,
  },
  scanOpenButton: {
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2),
    borderRadius: radius.card,
    backgroundColor: colors.accent,
  },
  scanOpenButtonText: { color: '#fff', fontSize: fontSize.small, fontWeight: '600' },
  cameraErrorOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(3),
  },
  cameraErrorText: { color: colors.danger, fontSize: fontSize.small, textAlign: 'center', paddingHorizontal: spacing(4) },
  cameraRetryText: { color: colors.text, fontSize: fontSize.small },
  scanFallback: {
    height: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(3),
  },
  scanFallbackText: { color: colors.textDim, fontSize: fontSize.small },
  scanRetryButton: {
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2),
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
  },
  scanRetryText: { color: colors.text, fontSize: fontSize.small },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    fontSize: fontSize.small,
    padding: spacing(3),
    textAlignVertical: 'top',
  },
  localDevFields: { flexDirection: 'row', gap: spacing(2), marginBottom: spacing(2) },
  localDevInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    color: colors.text,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(2),
    fontSize: fontSize.small,
  },
  localPortInput: { flex: 0.35 },
  inputWrap: { position: 'relative' },
  clearButton: {
    position: 'absolute',
    top: spacing(1),
    right: spacing(1),
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: colors.danger, fontSize: fontSize.small, marginTop: spacing(2) },
  button: {
    marginTop: spacing(4),
    backgroundColor: colors.accent,
    borderRadius: radius.card,
    paddingVertical: spacing(3),
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: colors.border },
  demoButton: { backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: '#fff', fontSize: fontSize.body, fontWeight: '600' },
  buttonTextDisabled: { color: colors.textDim },
  demoButtonText: { color: colors.text, fontSize: fontSize.body, fontWeight: '600' },
})
