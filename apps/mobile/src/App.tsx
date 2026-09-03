/**
 * Root: pairing gate → connection → session list ⇄ chat. v1 keeps navigation
 * as simple screen state (two screens); a navigator lands with M3/M4.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Clipboard, DevSettings, Linking, Modal, NativeModules, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import type { CompatibilityResult, ConnectionFailureKind, ConnectionManager, ConnectionState } from '@dsh-mobile/core'
import { APP_VERSION } from '@dsh-mobile/core'
import type { MobileHealthSnapshot, MobileInventorySnapshot } from '@dsh-mobile/protocol'
import { I18nProvider, useI18n, type TranslationKey } from './i18n'
import { ModalBackdrop } from './components/ModalBackdrop'
import { colors, fontSize, spacing } from './theme'
import { toolDisplayName } from './ui-labels'
import { clearPairing, loadPairing, type PairingRecord } from './pairing-store'
import { createManager } from './connection'
import { PairingScreen } from './screens/PairingScreen'
import { SessionListScreen } from './screens/SessionListScreen'
import { ChatScreen } from './screens/ChatScreen'
import { SettingsScreen, type ThemeMode } from './screens/SettingsScreen'

type Route = { name: 'list' } | { name: 'chat'; sessionId: string } | { name: 'settings' }

interface DiagnosticError {
  at: string
  message: string
  kind: ConnectionFailureKind
}

interface HealthReport {
  snapshot: MobileHealthSnapshot | null
  latencyMs: number | null
  error: string | null
}

function DiagnosticRow({ label, value }: { label: string, value: string }): React.JSX.Element {
  return (
    <View style={styles.diagnosticRow}>
      <Text style={styles.diagnosticLabel}>{label}</Text>
      <Text style={styles.diagnosticValue} selectable>{value}</Text>
    </View>
  )
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

function connectionFailureKey(kind: ConnectionFailureKind): TranslationKey {
  return `diagnostics.failure.${kind}` as TranslationKey
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
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  const [errors, setErrors] = useState<DiagnosticError[]>([])
  const [events, setEvents] = useState<DiagnosticEvent[]>([])
  const [pendingNewSession, setPendingNewSession] = useState(false)
  const [inventory, setInventory] = useState<MobileInventorySnapshot | null | undefined>(undefined)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const managerRef = useRef<ConnectionManager | null>(null)
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showAlert = useCallback((text: string) => {
    setAlert(text)
    if (alertTimer.current !== null) clearTimeout(alertTimer.current)
    alertTimer.current = setTimeout(() => setAlert(null), 5000)
  }, [])

  const recordError = useCallback((message: string, kind: ConnectionFailureKind = 'unknown') => {
    setErrors(current => [...current.slice(-7), { at: new Date().toISOString(), message, kind }])
  }, [])

  const diagnosticTime = useCallback((value: string | null | undefined): string => value === null || value === undefined
    ? t('diagnostics.never')
    : new Date(value).toLocaleString(locale, { hour12: false }), [locale, t])

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
    const offManagerError = manager.on('error', ({ message, kind }) => recordError(message, kind))
    const offHealth = manager.on('health', report => setHealthReport(report))
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
      offHealth()
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

  const refreshHealth = useCallback(() => {
    const manager = managerRef.current
    if (manager === null) return
    setHealthLoading(true)
    void manager.probeHealth()
      .then(snapshot => {
        showAlert(snapshot === null ? t('diagnostics.unavailable') : t('diagnostics.testPassed'))
      })
      .catch(cause => {
        showAlert(t('diagnostics.testFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
      })
      .finally(() => setHealthLoading(false))
  }, [showAlert, t])

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
      lastOnlineAt: managerRef.current?.lastOnlineAt ?? null,
      health: healthReport,
    }
    Clipboard.setString(JSON.stringify(payload, null, 2))
  }, [connState, errors, events, healthReport, pairing])

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
              onOpenSettings={() => setRoute({ name: 'settings' })}
            />
          ) : route.name === 'settings' ? (
            <SettingsScreen
              manager={managerRef.current}
              connState={connState}
              errors={errors}
              events={events}
              inventory={inventory}
              inventoryLoading={inventoryLoading}
              refreshInventory={refreshInventory}
              themeMode={themeMode}
              setTheme={setTheme}
              language={language}
              setLanguage={setLanguage}
              onOpenDiagnostics={() => setDiagnosticsOpen(true)}
              onBack={() => setRoute({ name: 'list' })}
              appVersion={APP_VERSION}
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
      <Modal transparent visible={diagnosticsOpen} animationType="fade" onRequestClose={() => setDiagnosticsOpen(false)}>
        <ModalBackdrop onClose={() => setDiagnosticsOpen(false)}>
          <View style={styles.diagnosticCard}>
            <View style={styles.diagnosticHeader}>
              <Text style={styles.diagnosticTitle}>{t('diagnostics.title')}</Text>
              <TouchableOpacity onPress={() => setDiagnosticsOpen(false)}>
                <Text style={styles.diagnosticClose}>{t('common.close')}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.diagnosticScroll} showsVerticalScrollIndicator={false}>
              <DiagnosticRow label={t('diagnostics.state')} value={t(connectionStateKey(connState))} />
              <DiagnosticRow label={t('diagnostics.hub')} value={pairing?.hub ?? t('common.unknown')} />
              <DiagnosticRow label={t('diagnostics.instance')} value={pairing?.instance ?? t('common.unknown')} />
              <DiagnosticRow label={t('diagnostics.pluginVersion')} value={healthReport?.snapshot?.pluginVersion ?? managerRef.current?.compatibility?.pluginVersion ?? t('common.unknown')} />
              <DiagnosticRow label={t('app.mobileApi')} value={String(healthReport?.snapshot?.mobileApi ?? managerRef.current?.compatibility?.mobileApi ?? 0)} />
              <DiagnosticRow label={t('diagnostics.health')} value={healthReport?.error ?? (healthReport?.snapshot === null || healthReport === null ? t('diagnostics.unavailable') : t('diagnostics.healthy'))} />
              <DiagnosticRow label={t('diagnostics.latency')} value={healthReport?.latencyMs === null || healthReport?.latencyMs === undefined ? '—' : `${healthReport.latencyMs} ms`} />
              <DiagnosticRow label={t('diagnostics.buildId')} value={healthReport?.snapshot?.buildId ?? '—'} />
              <DiagnosticRow label={t('diagnostics.loadedFrom')} value={healthReport?.snapshot?.loadedFrom ?? '—'} />
              <DiagnosticRow label={t('diagnostics.startedAt')} value={diagnosticTime(healthReport?.snapshot?.startedAt)} />
              <DiagnosticRow label={t('diagnostics.lastConnectedAt')} value={diagnosticTime(healthReport?.snapshot?.lastConnectedAt)} />
              <DiagnosticRow label={t('diagnostics.lastReconnectAt')} value={diagnosticTime(healthReport?.snapshot?.lastReconnectAt)} />
              <DiagnosticRow label={t('diagnostics.lastOnlineAt')} value={diagnosticTime(managerRef.current?.lastOnlineAt)} />
              <DiagnosticRow label={t('diagnostics.devices')} value={healthReport?.snapshot === null || healthReport?.snapshot === undefined ? '—' : String(healthReport.snapshot.devices)} />
              <DiagnosticRow label={t('diagnostics.features')} value={managerRef.current?.compatibility?.features.join(' · ') || '—'} />

              <Text style={styles.diagnosticSectionTitle}>{t('diagnostics.recentEvents')}</Text>
              {events.length === 0 ? <Text style={styles.settingsMeta}>{t('diagnostics.none')}</Text> : events.slice(-8).reverse().map((event, index) => (
                <Text key={`${event.at}:event:${index}`} style={styles.diagnosticLog}>
                  {diagnosticTime(event.at)} · {t(connectionStateKey(event.state))}
                </Text>
              ))}
              <Text style={styles.diagnosticSectionTitle}>{t('diagnostics.recentErrors')}</Text>
              {errors.length === 0 ? <Text style={styles.settingsMeta}>{t('diagnostics.none')}</Text> : errors.slice().reverse().map((error, index) => (
                <Text key={`${error.at}:${index}`} style={styles.diagnosticError}>
                  {diagnosticTime(error.at)} · {t(connectionFailureKey(error.kind))}{'\n'}{error.message}
                </Text>
              ))}
            </ScrollView>
            <View style={styles.diagnosticActions}>
              <TouchableOpacity style={styles.diagnosticButton} disabled={healthLoading} onPress={refreshHealth}>
                <Text style={styles.diagnosticButtonText}>{healthLoading ? t('diagnostics.testing') : t('diagnostics.test')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.diagnosticButton} onPress={() => void retryConnection()}>
                <Text style={styles.diagnosticButtonText}>{t('common.retry')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.diagnosticButton} onPress={copyDiagnostics}>
                <Text style={styles.diagnosticButtonText}>{t('diagnostics.copy')}</Text>
              </TouchableOpacity>
            </View>
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
  settingsMeta: { color: colors.textDim, fontSize: 11 },
  diagnosticError: { color: colors.warning, fontSize: 11, marginTop: 4 },
  diagnosticCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    marginHorizontal: 18,
    maxHeight: '86%',
    padding: 16,
  },
  diagnosticHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  diagnosticTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  diagnosticClose: { color: colors.accent, fontSize: 14, padding: 6 },
  diagnosticScroll: { flexGrow: 0 },
  diagnosticRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: 7,
    gap: 3,
  },
  diagnosticLabel: { color: colors.textDim, fontSize: 11 },
  diagnosticValue: { color: colors.text, fontSize: 12, lineHeight: 17 },
  diagnosticSectionTitle: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 4 },
  diagnosticLog: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  diagnosticActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 10 },
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
