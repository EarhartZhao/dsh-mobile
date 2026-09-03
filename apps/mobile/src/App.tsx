/**
 * Root: pairing gate → connection → session list ⇄ chat. v1 keeps navigation
 * as simple screen state (two screens); a navigator lands with M3/M4.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Clipboard, DevSettings, Linking, Modal, NativeModules, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import type { CompatibilityResult, ConnectionManager, ConnectionState } from '@dsh-mobile/core'
import { APP_VERSION } from '@dsh-mobile/core'
import type { MobileInventorySnapshot } from '@dsh-mobile/protocol'
import { I18nProvider, useI18n, type Language, type TranslationKey } from './i18n'
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

interface DiagnosticError {
  at: string
  message: string
}

interface DiagnosticEvent {
  at: string
  state: ConnectionState
}

function connectionStateKey(state: ConnectionState): TranslationKey {
  switch (state) {
    case 'idle': return 'connection.idle'
    case 'connecting': return 'connection.connectingState'
    case 'online': return 'connection.online'
    case 'reconnecting': return 'connection.reconnecting'
    case 'stopped': return 'connection.stopped'
    case 'incompatible': return 'connection.incompatible'
  }
}

function compatibilityTitle(result: CompatibilityResult | null, t: (key: TranslationKey, values?: Record<string, string | number>) => string): string {
  if (result?.status === 'unknown') return t('compat.unknownTitle')
  if (result?.status === 'incompatible') return result.missingFeatures.length > 0 ? t('compat.featuresTitle') : t('compat.versionTitle')
  return result?.title ?? t('compat.versionTitle')
}

function compatibilityMessage(result: CompatibilityResult | null, t: (key: TranslationKey, values?: Record<string, string | number>) => string): string {
  if (result?.status === 'unknown') {
    return t('compat.unknownMessage', {
      app: result.appVersion,
      range: result.supportedPluginRange,
    })
  }
  if (result?.status === 'incompatible') {
    if (result.missingFeatures.length > 0) {
      return t('compat.featuresMessage', { app: result.appVersion, features: result.missingFeatures.join(', '), plugin: result.pluginVersion })
    }
    return t('compat.versionMessage', {
      app: result.appVersion,
      range: result.supportedPluginRange,
      apis: result.mobileApi,
      plugin: result.pluginVersion,
      api: result.mobileApi,
    })
  }
  return result?.message ?? ''
}

function AppContent(): React.JSX.Element {
  const { language, locale, setLanguage, t } = useI18n()
  const [pairing, setPairing] = useState<PairingRecord | null>(null)
  const [booted, setBooted] = useState(false)
  const [route, setRoute] = useState<Route>({ name: 'list' })
  const [connState, setConnState] = useState<ConnectionState>('idle')
  const [alert, setAlert] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  const [errors, setErrors] = useState<DiagnosticError[]>([])
  const [events, setEvents] = useState<DiagnosticEvent[]>([])
  const [pendingNewSession, setPendingNewSession] = useState(false)
  const [inventory, setInventory] = useState<MobileInventorySnapshot | null | undefined>(undefined)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const managerRef = useRef<ConnectionManager | null>(null)
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showAlert = useCallback((text: string) => {
    setAlert(text)
    if (alertTimer.current !== null) clearTimeout(alertTimer.current)
    alertTimer.current = setTimeout(() => setAlert(null), 5000)
  }, [])

  const recordError = useCallback((message: string) => {
    setErrors(current => [...current.slice(-4), { at: new Date().toISOString(), message }])
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
    const off = manager.on('state', ({ state }) => {
      setConnState(state)
      setEvents(current => [...current.slice(-9), { at: new Date().toISOString(), state }])
    })
    setErrors([])
    setEvents([])
    const offManagerError = manager.on('error', ({ message }) => recordError(message))
    const offStoreError = manager.store.on('error', ({ message }) => recordError(message))
    // Foreground alerts: task settlement + answerable frames (M3 scope: no
    // system push, foreground banner only).
    const offSettled = manager.store.on('jobSettled', ({ job }) => {
      const statusKey: TranslationKey = job.status === 'completed'
        ? 'job.completed'
        : job.status === 'failed' ? 'job.failed' : 'job.settled'
      showAlert(t('job.settledMessage', { id: job.id, status: t(statusKey), label: job.label }))
    })
    const offAttention = manager.store.on('attention', ({ kind, summary }) => {
      showAlert(kind === 'approval'
        ? t('attention.approval', { summary: toolDisplayName(summary, t) })
        : t('attention.question', { summary }))
    })
    manager.start().catch(() => undefined)
    return () => {
      off()
      offSettled()
      offAttention()
      offManagerError()
      offStoreError()
      void manager.stop()
      managerRef.current = null
    }
  }, [pairing, recordError, showAlert, t])

  useEffect(() => {
    if (connState !== 'online') {
      setInventory(undefined)
      setInventoryLoading(false)
      return
    }
    const compatibility = managerRef.current?.compatibility
    if (compatibility === null || compatibility?.features.includes('plugin-inventory') !== true) {
      setInventory(null)
      setInventoryLoading(false)
      return
    }
    let alive = true
    setInventory(undefined)
    setInventoryLoading(true)
    void managerRef.current?.loadInventory().then(snapshot => {
      if (alive) setInventory(snapshot)
    }).catch(() => {
      if (alive) setInventory(null)
    }).finally(() => {
      if (alive) setInventoryLoading(false)
    })
    return () => { alive = false }
  }, [connState, pairing])

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

  const refreshInventory = useCallback(() => {
    if (connState !== 'online') return
    setInventory(undefined)
    setInventoryLoading(true)
    void managerRef.current?.loadInventory().then(snapshot => setInventory(snapshot))
      .catch(() => setInventory(null))
      .finally(() => setInventoryLoading(false))
  }, [connState])

  const copyDiagnostics = useCallback(() => {
    const compatibility = managerRef.current?.compatibility
    const record = pairing
    const payload = {
      appVersion: APP_VERSION,
      state: connState,
      compatibility,
      hostInfo: managerRef.current?.hostInfo ?? null,
      pairing: record === null ? null : {
        hub: record.hub,
        instance: record.instance,
        caFp: record.caFp,
        deviceId: record.deviceId,
      },
      recentErrors: errors,
      recentConnectionEvents: events,
    }
    Clipboard.setString(JSON.stringify(payload, null, 2))
  }, [connState, errors, events, pairing])

  const openDeepLink = useCallback(async (url: string): Promise<void> => {
    const path = url.replace(/^dshmobile:\/\//, '').split(/[?#]/)[0]?.replace(/^\/+/, '')
    if (path !== 'new-session') return
    const manager = managerRef.current
    const client = manager?.client
    if (connState !== 'online' || manager === null || client === null || client === undefined) {
      setPendingNewSession(true)
      showAlert(t('link.connectionUnavailable'))
      return
    }
    try {
      const result = await client.sessions.create({} as never)
      if (result.result.ok) setRoute({ name: 'chat', sessionId: result.result.value.sessionId })
      else showAlert(t('link.newSessionFailed', { message: String(result.result.error.message ?? '') }))
    } catch (cause) {
      showAlert(t('link.newSessionFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    }
  }, [connState, showAlert, t])

  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => { void openDeepLink(url) })
    void Linking.getInitialURL().then(url => { if (typeof url === 'string') void openDeepLink(url) })
    return () => subscription.remove()
  }, [openDeepLink])

  useEffect(() => {
    if (connState !== 'online' || !pendingNewSession) return
    setPendingNewSession(false)
    const createSession = async (): Promise<void> => {
      const client = managerRef.current?.client
      if (client === null || client === undefined) return
      try {
        const result = await client.sessions.create({} as never)
        if (result.result.ok) setRoute({ name: 'chat', sessionId: result.result.value.sessionId })
        else showAlert(t('link.newSessionFailed', { message: String(result.result.error.message ?? '') }))
      } catch (cause) {
        showAlert(t('link.newSessionFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
      }
    }
    void createSession()
  }, [connState, pendingNewSession, showAlert, t])

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
                {connState === 'reconnecting' || connState === 'connecting' ? t('connection.connecting') : t('connection.state', { state: t(connectionStateKey(connState)) })}
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
            <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.settingsScrollContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.settingsTitle}>{t('app.settings')}</Text>
            <Text style={styles.settingsVersion}>
              App {APP_VERSION} · {t('app.plugin')} {managerRef.current?.compatibility?.pluginVersion ?? t('common.unknown')}
              {managerRef.current?.compatibility === null ? '' : ` · ${t('app.mobileApi')} ${managerRef.current?.compatibility?.mobileApi ?? 0}`}
            </Text>
            <Text style={styles.settingsFeatures}>
              {managerRef.current?.compatibility?.features.length
                ? managerRef.current.compatibility.features.join(' · ')
                : t('app.pluginFeaturesMissing')}
            </Text>
            <View style={styles.inventoryBlock}>
              <View style={styles.inventoryHeader}>
                <Text style={styles.inventoryTitle}>{t('inventory.title')}</Text>
                {inventory !== null && (
                  <TouchableOpacity onPress={refreshInventory} disabled={inventoryLoading}>
                    <Text style={styles.inventoryRefresh}>{t('inventory.refresh')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {inventory === undefined ? (
                <Text style={styles.settingsMeta}>{t('inventory.loading')}</Text>
              ) : inventory === null ? (
                <Text style={styles.settingsMeta}>{t('inventory.unavailable')}</Text>
              ) : inventory.entries.length === 0 ? (
                <Text style={styles.settingsMeta}>{t('inventory.empty')}</Text>
              ) : inventory.entries.map(entry => (
                <View key={entry.entryId} style={styles.inventoryRow}>
                  <Text style={styles.inventoryName} numberOfLines={1}>{entry.moduleName}</Text>
                  <Text style={styles.inventoryMeta} numberOfLines={1}>
                    {entry.enabled ? t('inventory.enabled') : t('inventory.disabled')}
                    {' · '}
                    {t(`inventory.phase.${entry.fiberPhase ?? 'none'}` as TranslationKey)}
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.diagnosticsBlock}>
              <Text style={styles.settingsMeta}>{t('diagnostics.state')}: {t(connectionStateKey(connState))}</Text>
              <Text style={styles.settingsMeta}>{t('diagnostics.recentErrors')}: {errors.length}</Text>
              <Text style={styles.settingsMeta}>{t('diagnostics.recentEvents')}: {events.length}</Text>
              {events.slice(-4).reverse().map((event, index) => (
                <Text key={`${event.at}:event:${index}`} style={styles.settingsMeta} numberOfLines={1}>
                  {new Date(event.at).toLocaleString(locale, { hour12: false })} · {t(connectionStateKey(event.state))}
                </Text>
              ))}
              {errors.map((error, index) => (
                <Text key={`${error.at}:${index}`} style={styles.diagnosticError} numberOfLines={3}>
                  {new Date(error.at).toLocaleString(locale, { hour12: false })} · {error.message}
                </Text>
              ))}
              <TouchableOpacity style={styles.diagnosticButton} onPress={copyDiagnostics}>
                <Text style={styles.diagnosticButtonText}>{t('diagnostics.copy')}</Text>
              </TouchableOpacity>
            </View>
            {(['light', 'dark', 'system'] as ThemeMode[]).map(mode => (
              <TouchableOpacity
                key={mode}
                style={styles.settingsRow}
                onPress={() => { setTheme(mode); setSettingsOpen(false) }}
              >
                <Text style={styles.settingsText}>
                  {mode === 'light' ? t('app.theme.light') : mode === 'dark' ? t('app.theme.dark') : t('app.theme.system')}
                </Text>
                <Text style={[styles.settingsCheck, themeMode !== mode && { opacity: 0 }]}>✓</Text>
              </TouchableOpacity>
            ))}
            {(['system', 'zh', 'en'] as Language[]).map(mode => (
              <TouchableOpacity
                key={mode}
                style={styles.settingsRow}
                onPress={() => setLanguage(mode)}
              >
                <Text style={styles.settingsText}>
                  {mode === 'system' ? t('app.language.system') : mode === 'zh' ? t('app.language.zh') : t('app.language.en')}
                </Text>
                <Text style={[styles.settingsCheck, language !== mode && { opacity: 0 }]}>✓</Text>
              </TouchableOpacity>
            ))}
            </ScrollView>
          </View>
        </ModalBackdrop>
      </Modal>
      {connState === 'incompatible' && managerRef.current?.compatibility !== null && (
        <Modal transparent visible animationType="fade" onRequestClose={() => undefined}>
          <View style={styles.backdrop}>
            <View style={styles.compatCard}>
              <Text style={styles.compatTitle}>{compatibilityTitle(managerRef.current?.compatibility ?? null, t)}</Text>
              <Text style={styles.compatMessage}>{compatibilityMessage(managerRef.current?.compatibility ?? null, t)}</Text>
              <Text style={styles.compatMeta}>
                App {managerRef.current?.compatibility?.appVersion ?? ''} · {t('connection.supportedPlugins', { range: managerRef.current?.compatibility?.supportedPluginRange ?? '' })}
              </Text>
              <TouchableOpacity style={styles.compatRetry} onPress={() => void retryConnection()}>
                <Text style={styles.compatRetryText}>{t('connection.retryAfterUpdate')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaProvider>
  )
}

export default function App(): React.JSX.Element {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
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
  settingsScroll: { maxHeight: 440 },
  settingsScrollContent: { paddingBottom: 8 },
  inventoryBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
  },
  inventoryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  inventoryTitle: { color: colors.text, fontSize: 12, fontWeight: '600' },
  inventoryRefresh: { color: colors.accent, fontSize: 11 },
  inventoryRow: { marginTop: 6, gap: 1 },
  inventoryName: { color: colors.text, fontSize: 11 },
  inventoryMeta: { color: colors.textDim, fontSize: 10 },
  diagnosticsBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  settingsMeta: { color: colors.textDim, fontSize: 11 },
  diagnosticError: { color: colors.warning, fontSize: 11, marginTop: 4 },
  diagnosticButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  diagnosticButtonText: { color: colors.accent, fontSize: 12 },
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
