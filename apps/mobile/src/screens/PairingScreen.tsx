/**
 * Onboarding: paste the QR payload (JSON) from the dsh settings card, redeem
 * the code, store the token. Camera scanning (vision-camera) lands after the
 * M1 spike; the manual paste path is the always-available fallback.
 */
import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera'
import { connect, headers } from 'nats.ws'
import { redeemPairingCode, type PairingQrPayload } from '@dsh-mobile/protocol'
import { colors, fontSize, radius, spacing } from '../theme'
import { savePairing, type PairingRecord } from '../pairing-store'

interface Props {
  onPaired: (record: PairingRecord) => void
}

function pairingErrorMessage(message: string): string {
  const text = message.trim()
  if (text === 'mobile-pair-failed') return '配对码核销失败，请重新生成二维码后重试。'
  if (text.includes('Failed to fetch') || text.includes('Network request failed')) {
    return '网络连接失败，请检查网络和服务器地址。'
  }
  if (text.startsWith('console /pair HTTP')) return `获取本地配对信息失败（HTTP ${text.split(' ').at(-1)}）。`
  if (text === 'console /pair: no payload') return '本地配对信息为空，请在 dsh 控制台重新生成。'
  return `配对失败：${text}`
}

function parseQr(text: string): PairingQrPayload {
  const parsed = JSON.parse(text) as Partial<PairingQrPayload>
  for (const key of ['hub', 'user', 'pass', 'instance', 'code'] as const) {
    if (typeof parsed[key] !== 'string' || parsed[key] === '') {
      throw new Error(`二维码内容缺少字段：${key}`)
    }
  }
  return { caFp: '', ...parsed } as PairingQrPayload
}

export function PairingScreen({ onPaired }: Props): React.JSX.Element {
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
      setError(pairingErrorMessage(cause instanceof Error ? cause.message : String(cause)))
    } finally {
      setBusy(false)
      if (nc !== null) await nc.close().catch(() => undefined)
    }
  }

  const pair = async (): Promise<void> => {
    await pairWith(parseQr(text.trim()))
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
      await pairWith(body.payload)
    } catch (cause) {
      console.error('[pairing]', cause instanceof Error ? cause.stack : cause)
      setError(pairingErrorMessage(cause instanceof Error ? cause.message : String(cause)))
      setBusy(false)
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>连接到你的 dsh</Text>
      <Text style={styles.hint}>
        在电脑上的 dsh 设置页打开「移动端」卡片，扫码配对；相机不可用时也可以粘贴二维码内容。
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
            <Text style={styles.scanText}>对准 dsh 配对二维码</Text>
          </View>
        </View>
      ) : (
        <View style={styles.scanFallback}>
          <Text style={styles.scanFallbackText}>
            {hasPermission ? '未找到可用相机。' : '相机权限未开启。'}
          </Text>
          {!hasPermission && (
            <TouchableOpacity style={styles.scanRetryButton} onPress={() => void requestPermission()}>
              <Text style={styles.scanRetryText}>重新允许相机</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <TextInput
        style={styles.input}
        multiline
        placeholder='粘贴二维码内容（JSON 格式）'
        placeholderTextColor={colors.textDim}
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity
        style={[styles.button, (busy || text.trim() === '') && styles.buttonDisabled]}
        disabled={busy || text.trim() === ''}
        onPress={() => void pair()}
      >
        <Text style={[styles.buttonText, (busy || text.trim() === '') && styles.buttonTextDisabled]}>
          {busy ? '配对中…' : '配对并连接'}
        </Text>
      </TouchableOpacity>
      {__DEV__ && (
        <TouchableOpacity style={[styles.button, styles.demoButton]} disabled={busy} onPress={() => void pairDemo()}>
          <Text style={styles.demoButtonText}>本地演示（模拟主机）</Text>
        </TouchableOpacity>
      )}
      {__DEV__ && (
        <TouchableOpacity style={[styles.button, styles.demoButton]} disabled={busy} onPress={() => void pairRealDsh()}>
          <Text style={styles.demoButtonText}>本地配对（真实 dsh）</Text>
        </TouchableOpacity>
      )}
    </View>
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
