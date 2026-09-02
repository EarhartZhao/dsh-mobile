/**
 * Onboarding: paste the QR payload (JSON) from the dsh settings card, redeem
 * the code, store the token. Camera scanning (vision-camera) lands after the
 * M1 spike; the manual paste path is the always-available fallback.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native'
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera'
import { connect, headers } from 'nats.ws'
import { redeemPairingCode, type PairingQrPayload } from '@dsh-mobile/protocol'
import { colors, fontSize, radius, spacing } from '../theme'
import { savePairing, type PairingRecord } from '../pairing-store'
import { useI18n, type TranslationKey } from '../i18n'

interface Props {
  onPaired: (record: PairingRecord) => void
}

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

function pairingErrorMessage(message: string, t: Translate): string {
  const text = message.trim()
  if (text === 'mobile-pair-failed') return t('pairing.codeFailed')
  if (text.includes('Failed to fetch') || text.includes('Network request failed')) {
    return t('pairing.networkFailed')
  }
  if (text === '' || message.includes('NatsError') || message.includes('WebSocket')) {
    return t('pairing.natsFailed')
  }
  if (text.startsWith('console /pair HTTP')) return t('pairing.httpFailed', { status: text.split(' ').at(-1) ?? '' })
  if (text === 'console /pair: no payload') return t('pairing.noPayload')
  if (text.startsWith('missing-field:')) return t('pairing.missingField', { field: text.slice('missing-field:'.length) })
  return t('pairing.failed', { message: text })
}

function parseQr(text: string): PairingQrPayload {
  const parsed = JSON.parse(text) as Partial<PairingQrPayload>
  for (const key of ['hub', 'user', 'pass', 'instance', 'code'] as const) {
    if (typeof parsed[key] !== 'string' || parsed[key] === '') {
      throw new Error(`missing-field:${key}`)
    }
  }
  return { caFp: '', ...parsed } as PairingQrPayload
}

export function PairingScreen({ onPaired }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const device = useCameraDevice('back')
  const { hasPermission, requestPermission } = useCameraPermission()
  const scanned = useRef(false)

  useEffect(() => {
    if (!hasPermission) void requestPermission()
  }, [hasPermission, requestPermission])

  const pairWith = async (payload: PairingQrPayload): Promise<void> => {
    setBusy(true)
    setError(null)
    let nc: Awaited<ReturnType<typeof connect>> | null = null
    try {
      nc = await connect({ servers: payload.hub, user: payload.user, pass: payload.pass })
      const device = await redeemPairingCode(nc, headers, payload.instance, payload.code, 'android')
      const record: PairingRecord = { ...payload, ...device }
      await savePairing(record)
      onPaired(record)
    } catch (cause) {
      console.error('[pairing]', cause instanceof Error ? cause.stack : cause)
      setError(pairingErrorMessage(cause instanceof Error ? cause.message : String(cause), t))
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
      setError(pairingErrorMessage(cause instanceof Error ? cause.message : String(cause), t))
    }
  }

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: codes => {
      if (scanned.current || busy) return
      const value = codes[0]?.value
      if (value === undefined || value === '') return
      scanned.current = true
      void pairWith(parseQr(value)).finally(() => {
        scanned.current = false
      })
    },
  })

  /** Dev loopback rig: pairs against scripts/fake-host.mjs (10.0.2.2 = host). */
  const pairDemo = async (): Promise<void> => {
    await pairWith({
      hub: 'ws://10.0.2.2:8333',
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
      const res = await fetch('http://10.0.2.2:3080/mobile-bridge/api/pair', { method: 'POST' })
      if (!res.ok) throw new Error(`console /pair HTTP ${res.status}`)
      const body = await res.json() as { payload?: PairingQrPayload }
      if (body.payload === undefined) throw new Error('console /pair: no payload')
      // In React-Native dev builds the emulator cannot reach a host loopback
      // listener or the production TLS Hub address. Use the host-mapped local
      // NATS WebSocket while retaining the Hub payload for release builds.
      await pairWith(__DEV__
        ? { ...body.payload, hub: 'ws://10.0.2.2:8443', caFp: '' }
        : body.payload)
    } catch (cause) {
      console.error('[pairing]', cause instanceof Error ? cause.stack : cause)
      setError(pairingErrorMessage(cause instanceof Error ? cause.message : String(cause), t))
      setBusy(false)
    }
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.root}>
      <Text style={styles.title}>{t('pairing.title')}</Text>
      <Text style={styles.hint}>
        {t('pairing.hint')}
      </Text>
      {hasPermission && device !== undefined && device !== null ? (
        <View style={styles.scanBox}>
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive
            codeScanner={codeScanner}
          />
          <View pointerEvents="none" style={styles.scanOverlay}>
            <Text style={styles.scanText}>{t('pairing.scanHint')}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.scanFallback}>
          <Text style={styles.scanFallbackText}>
            {hasPermission ? t('pairing.noCamera') : t('pairing.cameraPermission')}
          </Text>
          {!hasPermission && (
            <TouchableOpacity style={styles.scanRetryButton} onPress={() => void requestPermission()}>
              <Text style={styles.scanRetryText}>{t('pairing.allowCamera')}</Text>
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
            <Text style={styles.clearButtonText}>×</Text>
          </TouchableOpacity>
        )}
      </View>
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
  scanBox: {
    height: 220,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  scanOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: spacing(3),
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  scanText: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    overflow: 'hidden',
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1.5),
    fontSize: fontSize.small,
  },
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
  clearButtonText: { color: colors.textDim, fontSize: 24, lineHeight: 26 },
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
