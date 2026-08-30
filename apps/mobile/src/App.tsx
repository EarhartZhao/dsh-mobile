/**
 * Root: pairing gate → connection → session list ⇄ chat. v1 keeps navigation
 * as simple screen state (two screens); a navigator lands with M3/M4.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { DevSettings, NativeModules, Modal, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import type { ConnectionManager, ConnectionState } from '@dsh-mobile/core'
import { APP_VERSION } from '@dsh-mobile/core'
import { ModalBackdrop } from './components/ModalBackdrop'
import { colors, fontSize, spacing } from './theme'
import { toolDisplayName } from './ui-labels'
import { clearPairing, loadPairing, type PairingRecord } from './pairing-store'
import { createManager } from './connection'
import { PairingScreen } from './screens/PairingScreen'
import { SessionListScreen } from './screens/SessionListScreen'
import { ChatScreen } from './screens/ChatScreen'

type Route = { name: 'list' } | { name: 'chat'; sessionId: string }
type ThemeMode = 'light' | 'dark' | 'system'

function connectionStateLabel(state: ConnectionState): string {
  switch (state) {
    case 'idle': return '空闲'
    case 'connecting': return '连接中'
    case 'online': return '在线'
    case 'reconnecting': return '重新连接中'
    case 'stopped': return '已停止'
    case 'incompatible': return '版本不一致'
  }
}

export default function App(): React.JSX.Element {
  const [pairing, setPairing] = useState<PairingRecord | null>(null)
  const [booted, setBooted] = useState(false)
  const [route, setRoute] = useState<Route>({ name: 'list' })
  const [connState, setConnState] = useState<ConnectionState>('idle')
  const [alert, setAlert] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
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
    void (NativeModules.DshTheme as { getMode(): Promise<ThemeMode> } | undefined)
      ?.getMode()
      .then(setThemeMode)
      .catch(() => undefined)
  }, [])

  const setTheme = (mode: ThemeMode): void => {
    setThemeMode(mode)
    void (NativeModules.DshTheme as { setMode(mode: ThemeMode): Promise<null> } | undefined)
      ?.setMode(mode)
      .then(() => {
        // Colors are module-level constants, so reload after the native mode
        // lands and Activity recreation instead of threading a token object
        // through every screen.
        DevSettings.reload()
      })
      .catch(() => undefined)
  }

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
      showAlert(kind === 'approval' ? `待审批：${toolDisplayName(summary)}` : `待回答：${summary}`)
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

  const retryConnection = useCallback(async (): Promise<void> => {
    const manager = managerRef.current
    if (manager === null) return
    await manager.stop()
    await manager.start()
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
                {connState === 'reconnecting' || connState === 'connecting' ? '连接中…' : `连接状态：${connectionStateLabel(connState)}`}
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
              onOpenSettings={() => setSettingsOpen(true)}
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
      <Modal transparent visible={settingsOpen} animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <ModalBackdrop onClose={() => setSettingsOpen(false)}>
          <View style={styles.settingsCard}>
            <Text style={styles.settingsTitle}>设置</Text>
            <Text style={styles.settingsVersion}>
              App {APP_VERSION} · Plugin {managerRef.current?.compatibility?.pluginVersion ?? '未知'}
              {managerRef.current?.compatibility === null ? '' : ` · mobileApi ${managerRef.current?.compatibility?.mobileApi ?? 0}`}
            </Text>
            <Text style={styles.settingsFeatures}>
              {managerRef.current?.compatibility?.features.length
                ? managerRef.current.compatibility.features.join(' · ')
                : '未上报插件功能'}
            </Text>
            {(['light', 'dark', 'system'] as ThemeMode[]).map(mode => (
              <TouchableOpacity
                key={mode}
                style={styles.settingsRow}
                onPress={() => { setTheme(mode); setSettingsOpen(false) }}
              >
                <Text style={styles.settingsText}>
                  {mode === 'light' ? '亮色' : mode === 'dark' ? '暗色' : '跟随系统'}
                </Text>
                <Text style={[styles.settingsCheck, themeMode !== mode && { opacity: 0 }]}>✓</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ModalBackdrop>
      </Modal>
      {connState === 'incompatible' && managerRef.current?.compatibility !== null && (
        <Modal transparent visible animationType="fade" onRequestClose={() => undefined}>
          <View style={styles.backdrop}>
            <View style={styles.compatCard}>
              <Text style={styles.compatTitle}>{managerRef.current?.compatibility?.title ?? '版本不一致'}</Text>
              <Text style={styles.compatMessage}>{managerRef.current?.compatibility?.message}</Text>
              <Text style={styles.compatMeta}>
                App {managerRef.current?.compatibility?.appVersion ?? ''} · 支持插件 {managerRef.current?.compatibility?.supportedPluginRange ?? ''}
              </Text>
              <TouchableOpacity style={styles.compatRetry} onPress={() => void retryConnection()}>
                <Text style={styles.compatRetryText}>更新后重试</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center' },
  settingsCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    marginHorizontal: 40,
    paddingVertical: 8,
  },
  settingsTitle: {
    color: colors.textDim,
    fontSize: 11,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  settingsVersion: {
    color: colors.textDim,
    fontSize: 11,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  settingsFeatures: {
    color: colors.textDim,
    fontSize: 11,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  settingsText: { color: colors.text, fontSize: 15 },
  settingsCheck: { color: colors.accent, fontSize: 15 },
  compatCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    marginHorizontal: 28,
    padding: 20,
    gap: 10,
  },
  compatTitle: { color: colors.danger, fontSize: 18, fontWeight: '700' },
  compatMessage: { color: colors.text, fontSize: 14, lineHeight: 20 },
  compatMeta: { color: colors.textDim, fontSize: 12 },
  compatRetry: {
    marginTop: 6,
    backgroundColor: colors.accent,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 10,
  },
  compatRetryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
