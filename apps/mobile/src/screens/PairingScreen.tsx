/**
 * Onboarding: paste the QR payload (JSON) from the dsh settings card, redeem
 * the code, store the token. Camera scanning (vision-camera) lands after the
 * M1 spike; the manual paste path is the always-available fallback.
 */
import React, { useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { connect, headers } from 'nats.ws'
import { redeemPairingCode, type PairingQrPayload } from '@dsh-mobile/protocol'
import { colors, fontSize, radius, spacing } from '../theme'
import { savePairing, type PairingRecord } from '../pairing-store'

interface Props {
  onPaired: (record: PairingRecord) => void
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
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      if (nc !== null) await nc.close().catch(() => undefined)
    }
  }

  const pair = async (): Promise<void> => {
    await pairWith(parseQr(text.trim()))
  }

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
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>连接到你的 dsh</Text>
      <Text style={styles.hint}>
        在电脑上的 dsh 设置页打开「移动端」卡片，生成配对二维码，把二维码内容粘贴到这里。
      </Text>
      <TextInput
        style={styles.input}
        multiline
        placeholder='{"hub":"wss://…","user":…,"pass":…,"instance":…,"code":…}'
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
        <Text style={styles.buttonText}>{busy ? '配对中…' : '配对并连接'}</Text>
      </TouchableOpacity>
      {__DEV__ && (
        <TouchableOpacity style={[styles.button, styles.demoButton]} disabled={busy} onPress={() => void pairDemo()}>
          <Text style={styles.buttonText}>本地 demo（fake-host）</Text>
        </TouchableOpacity>
      )}
      {__DEV__ && (
        <TouchableOpacity style={[styles.button, styles.demoButton]} disabled={busy} onPress={() => void pairRealDsh()}>
          <Text style={styles.buttonText}>本地配对（真实 dsh）</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing(5), justifyContent: 'center' },
  title: { color: colors.text, fontSize: 22, fontWeight: '600', marginBottom: spacing(2) },
  hint: { color: colors.textDim, fontSize: fontSize.small, lineHeight: 20, marginBottom: spacing(4) },
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
  buttonDisabled: { opacity: 0.5 },
  demoButton: { backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: '#fff', fontSize: fontSize.body, fontWeight: '600' },
})
