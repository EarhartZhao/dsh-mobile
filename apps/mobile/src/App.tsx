/**
 * Root: pairing gate → connection → session list ⇄ chat. v1 keeps navigation
 * as simple screen state (two screens); a navigator lands with M3/M4.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { StatusBar, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import type { ConnectionManager, ConnectionState } from '@dsh-mobile/core'
import { colors, fontSize, spacing } from './theme'
import { clearPairing, loadPairing, type PairingRecord } from './pairing-store'
import { createManager } from './connection'
import { PairingScreen } from './screens/PairingScreen'
import { SessionListScreen } from './screens/SessionListScreen'
import { ChatScreen } from './screens/ChatScreen'

type Route = { name: 'list' } | { name: 'chat'; sessionId: string }

export default function App(): React.JSX.Element {
  const [pairing, setPairing] = useState<PairingRecord | null>(null)
  const [booted, setBooted] = useState(false)
  const [route, setRoute] = useState<Route>({ name: 'list' })
  const [connState, setConnState] = useState<ConnectionState>('idle')
  const [alert, setAlert] = useState<string | null>(null)
  const managerRef = useRef<ConnectionManager | null>(null)
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showAlert = useCallback((text: string) => {
    setAlert(text)
    if (alertTimer.current !== null) clearTimeout(alertTimer.current)
    alertTimer.current = setTimeout(() => setAlert(null), 5000)
  }, [])

  useEffect(() => {
    void loadPairing().then(record => {
      setPairing(record)
      setBooted(true)
    })
  }, [])

  useEffect(() => {
    if (pairing === null) return
    const manager = createManager(pairing)
    managerRef.current = manager
    const off = manager.on('state', ({ state }) => setConnState(state))
    // Foreground alerts: task settlement + answerable frames (M3 scope: no
    // system push, foreground banner only).
    const offSettled = manager.store.on('jobSettled', ({ job }) => {
      const status = job.status === 'completed' ? '完成' : job.status === 'failed' ? '失败' : '结束'
      showAlert(`任务 ${job.id} 已${status}：${job.label}`)
    })
    const offAttention = manager.store.on('attention', ({ kind, summary }) => {
      showAlert(kind === 'approval' ? `待审批：${summary}` : `待回答：${summary}`)
    })
    manager.start().catch(() => undefined)
    return () => {
      off()
      offSettled()
      offAttention()
      void manager.stop()
      managerRef.current = null
    }
  }, [pairing, showAlert])

  const onPaired = useCallback((record: PairingRecord) => setPairing(record), [])
  const onUnpair = useCallback(() => {
    void clearPairing()
    setRoute({ name: 'list' })
    setPairing(null)
  }, [])

  if (!booted) {
    return <View style={styles.root} />
  }

  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      {pairing === null || managerRef.current === null ? (
        <PairingScreen onPaired={onPaired} />
      ) : (
        <>
          {connState !== 'online' && (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>
                {connState === 'reconnecting' || connState === 'connecting' ? '连接中…' : `连接状态：${connState}`}
              </Text>
            </View>
          )}
          {alert !== null && (
            <View style={styles.alertBanner}>
              <Text style={styles.alertText}>{alert}</Text>
            </View>
          )}
          {route.name === 'list' ? (
            <SessionListScreen
              manager={managerRef.current}
              onOpenSession={sessionId => setRoute({ name: 'chat', sessionId })}
              onUnpair={onUnpair}
            />
          ) : (
            <ChatScreen
              manager={managerRef.current}
              sessionId={route.sessionId}
              onBack={() => setRoute({ name: 'list' })}
              onOpenSession={sessionId => setRoute({ name: 'chat', sessionId })}
            />
          )}
        </>
      )}
    </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  banner: {
    backgroundColor: colors.bgElevated,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing(1.5),
    alignItems: 'center',
  },
  bannerText: { color: colors.warning, fontSize: fontSize.small },
  alertBanner: {
    backgroundColor: colors.bgBubbleUser,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.accent,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(4),
  },
  alertText: { color: colors.text, fontSize: fontSize.small },
})
