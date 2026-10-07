/**
 * Root: pairing gate → connection → session list ⇄ chat. v1 keeps navigation
 * as simple screen state (two screens); a navigator lands with M3/M4.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BackHandler, Clipboard, DeviceEventEmitter, DevSettings, Linking, Modal, NativeModules, Platform, ScrollView, StatusBar, StyleSheet, Text, ToastAndroid, TouchableOpacity, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import type { CompatibilityResult, ConnectionFailureKind, ConnectionManager, ConnectionState } from '@dsh-mobile/core'
import { APP_VERSION } from '@dsh-mobile/core'
import type { MobileHealthSnapshot, MobileInventorySnapshot } from '@dsh-mobile/protocol'
import { I18nProvider, useI18n, type TranslationKey } from './i18n'
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences, type Preferences } from './preferences'
import { ModalBackdrop } from './components/ModalBackdrop'
import { colors, fontSize, spacing } from './theme'
import { toolDisplayName } from './ui-labels'
import {
  EMPTY_PAIRING_STATE,
  activeProfile,
  hostStillUsed,
  loadPairingState,
  profileTitle,
  removeProfile,
  savePairingState,
  setActiveProfile,
  setProfileLabel,
  setProfileMachineName,
  upsertProfile,
  type PairingResult,
  type PairingState,
  type Profile,
} from './pairing-store'
import { defaultDeviceName, loadDeviceName, saveDeviceName } from './device-name'
import { activateHub, clearHubAnchor } from './hub-tls'
import { checkForAppUpdate, type AppUpdateInfo, type AppUpdateStatus } from './app-update'
import { inventoryChangedByEvent } from './plugin-inventory'
import { createManager } from './connection'
import { warnCaught } from './log-caught'
import { PairingScreen } from './screens/PairingScreen'
import { ConnectionSwitcherScreen } from './screens/ConnectionSwitcherScreen'
import { SessionListScreen } from './screens/SessionListScreen'
import { PluginInventoryScreen } from './screens/PluginInventoryScreen'
import { ChatScreen } from './screens/ChatScreen'
import { SettingsScreen, type ThemeMode } from './screens/SettingsScreen'
import { INITIAL_NAV, closeChat, openChat, routeTo, type NavState, type Route } from './route'
import { handleSystemBack } from './system-back'

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

interface DownloadedUpdate {
  downloaded: boolean
  bytes: number
}

/**
 * The Android half of the in-app update: it downloads the APK, resumes a
 * paused transfer, and hands the file to the system installer. iOS has no
 * equivalent (its updates belong to the App Store), so the module is optional
 * at every call site, and the methods beyond `downloadAndInstall` are optional
 * too — an older native module on the device simply loses the extras.
 */
interface UpdaterModule {
  downloadAndInstall(url: string, version: string): Promise<null>
  cancelDownload?(keepPartial: boolean): Promise<null>
  downloadedUpdate?(version: string): Promise<DownloadedUpdate | null>
}

function updaterModule(): UpdaterModule | undefined {
  const module = NativeModules.DshUpdater as Partial<UpdaterModule> | undefined
  return typeof module?.downloadAndInstall === 'function' ? module as UpdaterModule : undefined
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

/** One decimal of MB: 82.2 MB reads, 86_230_000 bytes does not. */
function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  /**
   * Every paired Hub, plus which one is in use. The active profile is what the
   * rest of this component means by "the connection"; the manager effect below
   * is keyed on it, so switching connections tears the old manager down and
   * builds one for the new profile.
   */
  const [connections, setConnections] = useState<PairingState>(EMPTY_PAIRING_STATE)
  const [deviceName, setDeviceName] = useState(defaultDeviceName())
  const [booted, setBooted] = useState(false)
  /**
   * The screen on top, plus the conversation lineage its back gesture walks.
   * Kept in one value so a hop and the screen it lands on can never disagree.
   */
  const [nav, setNav] = useState<NavState>(INITIAL_NAV)
  const route = nav.route
  /** Show one screen, dropping any conversation lineage that does not apply. */
  const goTo = useCallback((next: Route) => {
    setNav(current => routeTo(current, next))
  }, [])
  /**
   * Chat the user was in last. A brand-new Session is blank until its first
   * message, and the list hides blank rows — except this one, which keeps the
   * chat the user just created visible in its workspace (the Web sidebar shows
   * exactly the same single provisional row).
   */
  const [lastChatSessionId, setLastChatSessionId] = useState<string | null>(null)

  /**
   * Open one chat, remembering it as the list's provisional blank row and, when
   * it was opened from another conversation, remembering that one as the way
   * back.
   */
  const openSession = useCallback((sessionId: string) => {
    setLastChatSessionId(sessionId)
    setNav(current => openChat(current, sessionId))
  }, [])
  /** Back out of a conversation: its parent, or the session list. */
  const leaveChat = useCallback(() => {
    setNav(closeChat)
  }, [])
  const [connState, setConnState] = useState<ConnectionState>('idle')
  const [alert, setAlert] = useState<string | null>(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES)
  const [errors, setErrors] = useState<DiagnosticError[]>([])
  const [events, setEvents] = useState<DiagnosticEvent[]>([])
  const [pendingNewSession, setPendingNewSession] = useState(false)
  const [inventory, setInventory] = useState<MobileInventorySnapshot | null | undefined>(undefined)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null)
  /** What the last release-feed query found; the settings row renders it. */
  const [updateCheck, setUpdateCheck] = useState<AppUpdateStatus>({ kind: 'idle' })
  /**
   * `idle` → the dialog offers download/install, `downloading` → 暂停/取消,
   * `paused` → 继续下载/取消. Pausing keeps the bytes on disk, so resuming is
   * a range request rather than a fresh 80 MB.
   */
  const [updatePhase, setUpdatePhase] = useState<'idle' | 'downloading' | 'paused'>('idle')
  /** Size of a finished APK already in the cache, or null when there is none. */
  const [updateDownloaded, setUpdateDownloaded] = useState<number | null>(null)
  // `null` until the native side reports the first byte; `total` is 0 when the
  // server omitted a content length, which the label renders as bytes alone.
  // `retrying` is set while the downloader is resuming after a stall.
  const [updateProgress, setUpdateProgress] = useState<{ received: number, total: number, retrying: boolean } | null>(null)
  const managerRef = useRef<ConnectionManager | null>(null)
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastBackPress = useRef(0)
  /** The launch-time release check runs once, however often `t` is rebuilt. */
  const bootUpdateChecked = useRef(false)
  /**
   * The saved connections, readable synchronously. Mutations happen from
   * several callbacks that must not race each other through React state, and
   * every one of them has to land on disk — so the ref is the source of truth
   * and the state is the render.
   */
  const connectionsRef = useRef<PairingState>(EMPTY_PAIRING_STATE)
  /** The connection in use; null means nothing is paired. */
  const pairing: Profile | null = activeProfile(connections)

  /** Applies one change to the saved connections and persists the result. */
  const mutateConnections = useCallback((update: (state: PairingState) => PairingState): PairingState => {
    const next = update(connectionsRef.current)
    if (next === connectionsRef.current) return next
    connectionsRef.current = next
    setConnections(next)
    void savePairingState(next).catch((cause: unknown) => {
      warnCaught('[pairing-store] save failed:', cause)
    })
    return next
  }, [])

  const showAlert = useCallback((text: string) => {
    setAlert(text)
    if (alertTimer.current !== null) clearTimeout(alertTimer.current)
    alertTimer.current = setTimeout(() => setAlert(null), 5000)
  }, [])

  /** Size of a finished APK already sitting in the cache, or null. */
  const refreshDownloadedUpdate = useCallback(async (version: string): Promise<void> => {
    const probe = updaterModule()?.downloadedUpdate
    if (probe === undefined) return
    try {
      const state = await probe(version)
      setUpdateDownloaded(state?.downloaded === true ? state.bytes : null)
    } catch {
      setUpdateDownloaded(null)
    }
  }, [])

  /**
   * One query, two callers: the silent check on launch and the 检查更新 row in
   * settings. Both land in the same status line, so a version found on launch
   * and one found by hand behave identically.
   */
  const checkUpdate = useCallback(async (mode: 'boot' | 'manual'): Promise<void> => {
    // The updater only ever installs Android packages: the release feed carries
    // APKs, and iOS has no equivalent side-loaded path (its updates belong to
    // the App Store), so asking would only ever offer something uninstallable.
    if (Platform.OS !== 'android') {
      if (mode === 'manual') setUpdateCheck({ kind: 'unsupported' })
      return
    }
    setUpdateCheck({ kind: 'checking' })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const found = await checkForAppUpdate(controller.signal)
      if (found === null) {
        setUpdateCheck({ kind: 'latest' })
        if (mode === 'manual') showAlert(t('update.upToDate'))
        return
      }
      setAppUpdate(found)
      setUpdatePhase('idle')
      setUpdateCheck({ kind: 'available', version: found.version })
      void refreshDownloadedUpdate(found.version)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setUpdateCheck({ kind: 'error', message })
      if (mode === 'manual') showAlert(t('update.checkFailed', { message }))
    } finally {
      clearTimeout(timeout)
    }
  }, [refreshDownloadedUpdate, showAlert, t])

  const moveToBackground = useCallback(() => {
    const app = NativeModules.DshApp as { moveTaskToBack(): Promise<boolean> } | undefined
    if (typeof app?.moveTaskToBack === 'function') {
      void app.moveTaskToBack()
        .then(moved => { if (!moved) BackHandler.exitApp() })
        .catch(() => BackHandler.exitApp())
      return
    }
    BackHandler.exitApp()
  }, [])

  const showBackExitPrompt = useCallback(() => {
    const message = t('app.pressBackAgainToExit')
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT)
    } else {
      showAlert(message)
    }
  }, [showAlert, t])

  const recordError = useCallback((message: string, kind: ConnectionFailureKind = 'unknown') => {
    setErrors(current => [...current.slice(-7), { at: new Date().toISOString(), message, kind }])
  }, [])

  /** Persist-and-apply one composer preference change. */
  const updatePreferences = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch }
      void savePreferences(next).catch(() => undefined)
      return next
    })
  }, [])

  const diagnosticTime = useCallback((value: string | null | undefined): string => value === null || value === undefined
    ? t('diagnostics.never')
    : new Date(value).toLocaleString(locale, { hour12: false }), [locale, t])

  useEffect(() => {
    void Promise.all([loadPairingState(), loadPreferences(), loadDeviceName()])
      .then(async ([saved, stored, storedDeviceName]) => {
        connectionsRef.current = saved
        setConnections(saved)
        if (storedDeviceName !== null) setDeviceName(storedDeviceName)
        setPreferences(stored)
        // The Hub's TLS trust lives in native storage, not in the pairing file,
        // so the active profile has to be pushed back before the first connect
        // attempt — a restart would otherwise dial a Hub the app no longer
        // anchors. Failure is not fatal: without the anchor the handshake fails
        // loudly, which is better than connecting to something unverified.
        const restored = activeProfile(saved)
        if (restored !== null) {
          await activateHub(restored.hub, restored.ca).catch((cause: unknown) => {
            warnCaught('[hub-tls] anchor restore failed:', cause)
          })
        }
        setBooted(true)
      })
  }, [])

  useEffect(() => {
    if (!booted) return
    // Once per launch, and silently: the settings row is how the owner asks
    // again. Guarded by a ref so a language change (which rebuilds `t`) does
    // not re-open a dialog the owner has already dismissed.
    if (bootUpdateChecked.current) return
    bootUpdateChecked.current = true
    void checkUpdate('boot')
  }, [booted, checkUpdate])

  useEffect(() => {
    void (NativeModules.DshTheme as { getMode(): Promise<ThemeMode> } | undefined)
      ?.getMode()
      .then(setThemeMode)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    // The native download is one long await; these ticks are the only thing
    // that tells the owner it is moving rather than stuck.
    const subscription = DeviceEventEmitter.addListener('DshUpdaterProgress', (payload: { received?: number, total?: number, retrying?: boolean }) => {
      setUpdateProgress({
        received: payload?.received ?? 0,
        total: payload?.total ?? 0,
        retrying: payload?.retrying === true,
      })
    })
    return () => subscription.remove()
  }, [])

  const handleBackNavigation = useCallback(() => {
    const result = handleSystemBack({
      route: route.name,
      now: Date.now(),
      lastBackAt: lastBackPress.current,
      // Any route but a conversation ends at the list, and a conversation ends
      // at the one it was opened from before that.
      goToList: leaveChat,
      goToSettings: () => goTo({ name: 'settings' }),
      showPrompt: showBackExitPrompt,
      moveToBackground,
    })
    lastBackPress.current = result.lastBackAt
    return result.handled
  }, [goTo, leaveChat, moveToBackground, route.name, showBackExitPrompt])

  const handleHardwareBack = useCallback(() => {
    if (pairing === null || managerRef.current === null) return false
    return handleBackNavigation()
  }, [handleBackNavigation, pairing])

  useEffect(() => {
    if (!booted) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', handleHardwareBack)
    return () => subscription.remove()
  }, [booted, handleHardwareBack])

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
    // The device name is a dependency on purpose: it travels on `hello`, so
    // renaming the phone reconnects once and the plugin's roster follows.
    const manager = createManager(pairing, deviceName)
    managerRef.current = manager
    const off = manager.on('state', ({ state }) => {
      setConnState(state)
      setEvents(current => [...current.slice(-9), { at: new Date().toISOString(), state }])
    })
    setErrors([])
    setEvents([])
    const offManagerError = manager.on('error', ({ message, kind }) => recordError(message, kind))
    const offHealth = manager.on('health', report => setHealthReport(report))
    // The machine states its own name in `mobile.info`; keeping it with the
    // profile is what makes the switcher readable while that Hub is offline.
    const offInfo = manager.on('info', ({ info }) => {
      const machineName = info?.instanceName
      if (machineName === undefined) return
      mutateConnections(state => setProfileMachineName(state, pairing.id, machineName))
    })
    const offStoreError = manager.store.on('error', ({ message }) => recordError(message))
    // Foreground alerts: task settlement + answerable frames (M3 scope: no
    // system push, foreground banner only).
    const offSettled = manager.store.on('jobSettled', ({ job }) => {
      const statusKey: TranslationKey = job.status === 'completed'
        ? 'job.completed'
        : job.status === 'failed' ? 'job.failed' : 'job.settled'
      // A shell job's label is its whole command line: unclipped it turns the
      // one-line banner into a wall of text over the whole screen.
      const label = job.label.length > 72 ? `${job.label.slice(0, 71)}…` : job.label
      showAlert(t('job.settledMessage', { id: job.id, status: t(statusKey), label }))
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
      offInfo()
      offStoreError()
      void manager.stop()
      managerRef.current = null
    }
  }, [pairing, deviceName, mutateConnections, recordError, showAlert, t])

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

  /**
   * A finished pairing becomes a saved connection and the one in use — either
   * the first one, or another machine added later from the switcher.
   */
  const onPaired = useCallback((result: PairingResult) => {
    mutateConnections(state => upsertProfile(state, result))
    goTo({ name: 'list' })
  }, [goTo, mutateConnections])

  /**
   * Drops one saved connection. What it taught the app to trust only goes with
   * it when no other connection points at the same Hub: anchors live per host,
   * so forgetting `home`'s certificate would also break a sibling `home-mac`.
   */
  const removeConnection = useCallback((id: string) => {
    const state = connectionsRef.current
    const target = state.profiles.find(profile => profile.id === id)
    const stillNeeded = hostStillUsed(state, id)
    mutateConnections(current => removeProfile(current, id))
    if (target !== undefined && !stillNeeded) {
      void clearHubAnchor(target.hub).catch(() => undefined)
    }
    goTo({ name: 'list' })
  }, [goTo, mutateConnections])

  /** The settings screen's 解除配对 acts on whatever is currently in use. */
  const onUnpair = useCallback(() => {
    if (pairing !== null) removeConnection(pairing.id)
  }, [pairing, removeConnection])

  const switchConnection = useCallback((id: string) => {
    mutateConnections(state => setActiveProfile(state, id))
    // Whatever was open belongs to the Hub being left behind.
    setLastChatSessionId(null)
    goTo({ name: 'list' })
  }, [goTo, mutateConnections])

  const renameConnection = useCallback((id: string, label: string) => {
    mutateConnections(state => setProfileLabel(state, id, label))
  }, [mutateConnections])

  /**
   * Renaming the phone only takes effect on the next connection: the name is
   * announced in `hello`, and `deviceName` is a manager dependency, so saving a
   * new one reconnects and the plugin's roster follows immediately.
   */
  const updateDeviceName = useCallback((name: string) => {
    const trimmed = name.trim()
    setDeviceName(trimmed === '' ? defaultDeviceName() : trimmed)
    void saveDeviceName(trimmed).catch((cause: unknown) => {
      warnCaught('[device-name] save failed:', cause)
    })
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

  /**
   * Reloads the inventory for a `plugin-manager/*` frame without blanking the
   * page, so an install the desktop started updates in place.
   */
  const syncInventory = useCallback(() => {
    if (connState !== 'online') return
    void managerRef.current?.loadInventory().then(snapshot => setInventory(snapshot))
      .catch(() => undefined)
  }, [connState])

  useEffect(() => {
    const store = managerRef.current?.store
    if (connState !== 'online' || store === undefined) return
    return store.on('remoteEvent', ({ event }) => {
      if (inventoryChangedByEvent(event)) syncInventory()
    })
  }, [connState, syncInventory])

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

  const installUpdate = useCallback(async (): Promise<void> => {
    const target = appUpdate
    if (target === null) return
    const updater = updaterModule()
    if (updater === undefined) {
      showAlert(t('update.unavailable'))
      return
    }
    setUpdatePhase('downloading')
    setUpdateProgress(null)
    try {
      await updater.downloadAndInstall(target.downloadUrl, target.version)
      // The installer is up. The APK stays in the cache, so tapping 安装 again
      // re-opens the installer instead of pulling the same file over the link.
      void refreshDownloadedUpdate(target.version)
    } catch (error) {
      const code = (error as { code?: unknown })?.code
      // Pause and cancel both arrive here; the handler that asked for them has
      // already put the dialog in the state it should be in.
      if (code === 'UPDATE_CANCELLED') return
      // The downloader names what went wrong (a stall, an HTTP code, a size
      // mismatch); the blanket message hid a stuck transfer behind "稍后重试"
      // with no hint of whether waiting would help.
      const message = (error as { message?: unknown })?.message
      showAlert(code === 'INSTALL_PERMISSION_REQUIRED'
        ? t('update.installPermission')
        : typeof message === 'string' && message !== ''
          ? t('update.failedDetail', { message })
          : t('update.failed'))
    } finally {
      // Never overwrite a pause or a cancel that landed while the promise was
      // in flight.
      setUpdatePhase(phase => (phase === 'downloading' ? 'idle' : phase))
    }
  }, [appUpdate, refreshDownloadedUpdate, showAlert, t])

  /** Stop transferring, keep the bytes: 继续下载 resumes from here. */
  const pauseUpdate = useCallback((): void => {
    setUpdatePhase('paused')
    void updaterModule()?.cancelDownload?.(true)?.catch(() => undefined)
  }, [])

  /** Stop transferring and drop the partial file, then close the dialog. */
  const cancelUpdate = useCallback((): void => {
    setUpdatePhase('idle')
    setUpdateProgress(null)
    setUpdateDownloaded(null)
    setAppUpdate(null)
    void updaterModule()?.cancelDownload?.(false)?.catch(() => undefined)
  }, [])

  // Download progress for the update dialog. `total === 0` means the server
  // sent no content length, so the bar stays empty and the label falls back to
  // bytes alone rather than showing a percent of an unknown whole.
  const updatePercent = updateProgress === null || updateProgress.total <= 0
    ? 0
    : Math.round(Math.max(0, Math.min(1, updateProgress.received / updateProgress.total)) * 100)
  const updateLabel = updateProgress === null
    ? t('update.preparing')
    : updatePhase === 'paused'
      ? t('update.paused', { received: formatMegabytes(updateProgress.received) })
      : updateProgress.retrying
      // A resumed transfer keeps the bytes already on disk, so the number it
      // shows is progress, not a restart.
      ? t('update.retrying', { received: formatMegabytes(updateProgress.received) })
      : updateProgress.total <= 0
        ? t('update.progressUnknown', { received: formatMegabytes(updateProgress.received) })
        : t('update.progress', {
            percent: updatePercent,
            received: formatMegabytes(updateProgress.received),
            total: formatMegabytes(updateProgress.total),
          })

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
        // True once the pairing carried a certificate: the native layer then
        // anchors the handshake on it, and the QR's fingerprint is checked
        // against it before the first connection. A pairing that predates that
        // field still falls back to whatever CA the build carries, which is
        // the weaker promise this flag is here to make visible.
        caFpEnforced: typeof record.ca === 'string' && record.ca !== '',
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
      if (result.result.ok) openSession(result.result.value.sessionId)
      else showAlert(t('link.newSessionFailed', { message: String(result.result.error.message ?? '') }))
    } catch (cause) {
      showAlert(t('link.newSessionFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    }
  }, [connState, openSession, showAlert, t])

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
        if (result.result.ok) openSession(result.result.value.sessionId)
        else showAlert(t('link.newSessionFailed', { message: String(result.result.error.message ?? '') }))
      } catch (cause) {
        showAlert(t('link.newSessionFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
      }
    }
    void createSession()
  }, [connState, openSession, pendingNewSession, showAlert, t])

  if (!booted) {
    return <View style={styles.root} />
  }

  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      {pairing === null || managerRef.current === null ? (
        <PairingScreen onPaired={onPaired} deviceName={deviceName} onSystemBack={handleBackNavigation} />
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
              {/* Any notice can carry a tool's own text, so the banner caps
                  itself instead of letting one grow over the screen. */}
              <Text style={styles.alertText} numberOfLines={2} ellipsizeMode="tail">{alert}</Text>
            </View>
          )}
          {route.name === 'list' ? (
            <SessionListScreen
              manager={managerRef.current}
              onOpenSession={openSession}
              onOpenSettings={() => goTo({ name: 'settings' })}
              currentSessionId={lastChatSessionId}
            />
          ) : route.name === 'connections' ? (
            <ConnectionSwitcherScreen
              profiles={connections.profiles}
              activeId={connections.activeId}
              onSwitch={switchConnection}
              onRemove={removeConnection}
              onRename={renameConnection}
              onAdd={() => goTo({ name: 'pairing' })}
              onBack={() => goTo({ name: 'settings' })}
            />
          ) : route.name === 'pairing' ? (
            // Adding a second machine: the first pairing is untouched until the
            // new one succeeds, so a cancelled scan leaves the app where it was.
            <PairingScreen
              onPaired={onPaired}
              deviceName={deviceName}
              onSystemBack={() => { goTo({ name: 'connections' }); return true }}
            />
          ) : route.name === 'settings' ? (
            <SettingsScreen
              manager={managerRef.current}
              connState={connState}
              errors={errors}
              events={events}
              inventory={inventory}
              themeMode={themeMode}
              setTheme={setTheme}
              language={language}
              setLanguage={setLanguage}
              enterToSend={preferences.enterToSend}
              setEnterToSend={value => updatePreferences({ enterToSend: value })}
              connectionCount={connections.profiles.length}
              connectionTitle={pairing === null ? '' : profileTitle(pairing)}
              deviceName={deviceName}
              setDeviceName={updateDeviceName}
              onOpenConnections={() => goTo({ name: 'connections' })}
              onOpenDiagnostics={() => setDiagnosticsOpen(true)}
              onOpenPlugins={() => goTo({ name: 'plugins' })}
              onUnpair={onUnpair}
              onBack={() => goTo({ name: 'list' })}
              appVersion={APP_VERSION}
              updateStatus={updateCheck}
              onCheckUpdate={() => { void checkUpdate('manual') }}
            />
          ) : route.name === 'plugins' ? (
            <PluginInventoryScreen
              inventory={inventory}
              inventoryLoading={inventoryLoading}
              refreshInventory={refreshInventory}
              features={managerRef.current.compatibility?.features ?? []}
              onBack={() => goTo({ name: 'settings' })}
            />
          ) : (
            <ChatScreen
              manager={managerRef.current}
              sessionId={route.sessionId}
              onBack={leaveChat}
              onOpenSession={openSession}
              enterToSend={preferences.enterToSend}
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
      <Modal
        transparent
        visible={appUpdate !== null}
        animationType="fade"
        onRequestClose={() => {
          // Back while transferring means pause, not cancel: the bytes already
          // on disk are worth keeping, and the dialog can resume them.
          if (updatePhase === 'downloading') pauseUpdate()
          setAppUpdate(null)
        }}
      >
        <View style={styles.backdrop}>
          <View style={styles.updateCard}>
            <Text style={styles.updateTitle}>{t('update.title')}</Text>
            <Text style={styles.updateVersion}>{t('update.version', { version: appUpdate?.version ?? '' })}</Text>
            {appUpdate?.notes !== undefined && appUpdate.notes !== '' && (
              <ScrollView style={styles.updateNotes}>
                <Text style={styles.updateNotesText}>{appUpdate.notes}</Text>
              </ScrollView>
            )}
            {/*
              * Android only lets an identically signed package replace an
              * installed one, so the first move from a `run-android` install to a
              * published APK needs one uninstall. Say so here instead of letting
              * the system installer fail with a bare "app not installed".
              */}
            {__DEV__ && <Text style={styles.updateHint}>{t('update.devBuild')}</Text>}
            {updatePhase !== 'idle' && (
              <View style={styles.updateProgress}>
                <View style={styles.updateProgressTrack}>
                  <View style={[styles.updateProgressFill, { width: `${updatePercent}%` }]} />
                </View>
                <Text style={styles.updateProgressText}>{updateLabel}</Text>
              </View>
            )}
            {updatePhase === 'idle' && updateDownloaded !== null && (
              <Text style={styles.updateHint}>{t('update.cachedHint', { size: formatMegabytes(updateDownloaded) })}</Text>
            )}
            <View style={styles.updateActions}>
              {updatePhase === 'downloading' ? (
                <>
                  <TouchableOpacity style={styles.updateLater} onPress={pauseUpdate} accessibilityRole="button">
                    <Text style={styles.updateLaterText}>{t('update.pause')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.updateLater} onPress={cancelUpdate} accessibilityRole="button">
                    <Text style={styles.updateCancelText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity style={styles.updateLater} onPress={() => setAppUpdate(null)} accessibilityRole="button">
                    <Text style={styles.updateLaterText}>{t('update.later')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.updateNow} onPress={() => void installUpdate()} accessibilityRole="button">
                    <Text style={styles.updateNowText}>
                      {updatePhase === 'paused'
                        ? t('update.resume')
                        : updateDownloaded === null ? t('update.install') : t('update.installCached')}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
            {/*
              * The in-app download goes straight to GitHub; on a network that
              * throttles it, the phone's browser (which resumes and retries on
              * its own) is the way through. Keep that path visible.
              */}
            <TouchableOpacity style={styles.updateBrowser} onPress={() => { if (appUpdate !== null) void Linking.openURL(appUpdate.downloadUrl) }}>
              <Text style={styles.updateBrowserText}>{t('update.browser')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  updateCard: { backgroundColor: colors.bgElevated, borderRadius: 12, marginHorizontal: 28, padding: 20, gap: 10 },
  updateTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
  updateVersion: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  updateNotes: { maxHeight: 220 },
  updateNotesText: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  /** Dev-build signing note: same body copy as the release notes, quieter. */
  updateHint: { color: colors.warning, fontSize: 12, lineHeight: 17 },
  updateProgress: { gap: 6 },
  updateProgressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  updateProgressFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  updateProgressText: { color: colors.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  updateActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  updateLater: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  updateLaterText: { color: colors.textDim, fontSize: 14 },
  updateCancelText: { color: colors.danger, fontSize: 14 },
  updateNow: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  updateNowText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  updateBrowser: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 8 },
  updateBrowserText: { color: colors.textDim, fontSize: 13, textDecorationLine: 'underline' },
})
