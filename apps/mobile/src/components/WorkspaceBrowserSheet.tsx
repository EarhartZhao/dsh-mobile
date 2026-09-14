/**
 * Workspace directory browser over the bridge's `file.list` mapping
 * (dsh `workspaceFiles/list`).
 *
 * Paths stay workspace-relative: the host resolves them against the Session's
 * workspace root, so the browser can neither escape the workspace nor needs to
 * know an absolute prefix. Tapping a file hands its workspace path to the
 * preview sheet, which reads it through `file.read` / `file.bytes`.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ConnectionManager } from '@dsh-mobile/core'
import type { MobileDirectoryEntry } from '@dsh-mobile/protocol'
import { ModalBackdrop } from './ModalBackdrop'
import { colors, fontSize, radius, spacing } from '../theme'
import { useI18n } from '../i18n'
import {
  changeTouchesDirectory, joinWorkspacePath, parentWorkspacePath, sortWorkspaceEntries, workspaceCrumbs,
} from '../workspace-path'

type BrowserState =
  | { status: 'loading' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: MobileDirectoryEntry[]; truncated: boolean }

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024) * 10) / 10}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

export function WorkspaceBrowserSheet({ visible, sessionId, manager, onClose, onOpenFile, onInsertReference }: {
  visible: boolean
  sessionId: string
  manager: ConnectionManager
  onClose: () => void
  /** Opens one workspace-relative path in the file preview sheet. */
  onOpenFile: (path: string) => void
  /** Inserts one path into the composer as an `@` reference. */
  onInsertReference?: (reference: { path: string; kind: 'file' | 'directory'; size?: number }) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const client = manager.client
  const features = manager.compatibility?.features ?? []
  const [path, setPath] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState<BrowserState>({ status: 'loading' })
  /** Set when the host-side change stream stops, so the UI stops implying live. */
  const [watchError, setWatchError] = useState<string | null>(null)
  const canBrowse = features.includes('workspace-files')
  const canWatch = features.includes('workspace-watch')
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Every open starts at the workspace root; the trail rebuilds from there.
  useEffect(() => { if (visible) setPath('') }, [visible])

  const requestReload = useCallback((): void => {
    if (reloadTimer.current !== null) clearTimeout(reloadTimer.current)
    // Tool runs touch many files in a burst; one listing per burst is enough.
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null
      setReloadToken(token => token + 1)
    }, 300)
  }, [])

  useEffect(() => () => {
    if (reloadTimer.current !== null) clearTimeout(reloadTimer.current)
  }, [])

  // Arm the host-side change stream while the browser is open, and follow it.
  useEffect(() => {
    if (!visible || client === null || !canBrowse || !canWatch) return
    void client.files.watch({ sessionId }).catch(() => undefined)
    const off = manager.store.on('remoteEvent', ({ event, args }) => {
      if (event !== 'workspace-files/change' && event !== 'workspace-files/ready' && event !== 'workspace-files/watch-error') return
      const payload = args[0]
      if (typeof payload !== 'object' || payload === null) return
      if ((payload as { sessionId?: unknown }).sessionId !== sessionId) return
      if (event === 'workspace-files/ready') {
        setWatchError(null)
        requestReload()
        return
      }
      if (event === 'workspace-files/watch-error') {
        const message = (payload as { message?: unknown }).message
        setWatchError(typeof message === 'string' ? message : '')
        return
      }
      if (event === 'workspace-files/change') {
        // Reload only when the change lands in the shown directory. A change
        // without a resolvable workspace path refreshes anyway: a stale listing
        // is worse than one redundant request.
        if (!changeTouchesDirectory(path, (payload as { path?: unknown }).path)) return
      }
      requestReload()
    })
    return () => {
      off()
      // Release the host-side stream: a phone browses one directory at a time.
      void client.files.unwatch({ sessionId }).catch(() => undefined)
    }
  }, [canBrowse, canWatch, client, manager, path, requestReload, sessionId, visible])

  useEffect(() => {
    if (!visible) return
    if (client === null || !canBrowse) {
      setState({ status: 'unsupported' })
      return
    }
    let alive = true
    setState({ status: 'loading' })
    void client.files.list({ sessionId, path: path === '' ? undefined : path })
      .then((listing) => {
        if (!alive) return
        setState({ status: 'ready', entries: sortWorkspaceEntries(listing.entries), truncated: listing.truncated })
      })
      .catch((error: unknown) => {
        if (!alive) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => { alive = false }
  }, [canBrowse, client, path, reloadToken, sessionId, visible])

  const crumbs = workspaceCrumbs(path)

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <ModalBackdrop onClose={onClose}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('files.title')}</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity accessibilityRole="button" onPress={() => setReloadToken(token => token + 1)} hitSlop={8}>
                <Text style={styles.headerAction}>{t('files.refresh')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={8}>
                <Text style={styles.headerAction}>{t('common.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbRow}>
            {crumbs.map((crumb, index) => (
              <React.Fragment key={crumb.path === '' ? '/' : crumb.path}>
                {index > 0 && <Text style={styles.crumbSeparator}>/</Text>}
                <TouchableOpacity
                  onPress={() => setPath(crumb.path)}
                  disabled={crumb.path === path}
                  hitSlop={6}
                >
                  <Text style={[styles.crumb, crumb.path === path && styles.crumbActive]}>
                    {crumb.name === '' ? t('files.root') : crumb.name}
                  </Text>
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </ScrollView>
          <ScrollView style={styles.list}>
            {watchError !== null && (
              <Text style={styles.watchError}>
                {t('files.watchError', { message: watchError === '' ? t('common.unknown') : watchError })}
              </Text>
            )}
            {state.status === 'loading' && <ActivityIndicator color={colors.accent} style={styles.spinner} />}
            {state.status === 'unsupported' && <Text style={styles.hint}>{t('files.unsupported')}</Text>}
            {state.status === 'error' && <Text style={styles.hint}>{t('files.failed', { message: state.message })}</Text>}
            {state.status === 'ready' && (
              <>
                {path !== '' && (
                  <TouchableOpacity style={styles.row} onPress={() => setPath(parentWorkspacePath(path))}>
                    <Text style={styles.rowIcon}>↰</Text>
                    <Text style={styles.rowName} numberOfLines={1}>{t('files.up')}</Text>
                  </TouchableOpacity>
                )}
                {state.entries.length === 0 && <Text style={styles.hint}>{t('files.empty')}</Text>}
                {state.entries.map((entry) => {
                  const childPath = joinWorkspacePath(path, entry.name)
                  const isDirectory = entry.type === 'directory'
                  return (
                    <View key={entry.name} style={styles.row}>
                      <TouchableOpacity
                        style={styles.rowMain}
                        disabled={entry.type === 'other'}
                        onPress={() => {
                          if (isDirectory) setPath(childPath)
                          else onOpenFile(childPath)
                        }}
                      >
                        <Text style={styles.rowIcon}>{isDirectory ? '📁' : entry.type === 'file' ? '📄' : '❔'}</Text>
                        <Text
                          style={[styles.rowName, entry.type === 'other' && styles.rowDisabled]}
                          numberOfLines={1}
                        >
                          {entry.name}
                        </Text>
                      </TouchableOpacity>
                      {entry.type === 'file' && (
                        <Text style={styles.rowMeta}>{formatSize(entry.size)}</Text>
                      )}
                      {onInsertReference !== undefined && entry.type !== 'other' && (
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={t('files.insertReference')}
                          hitSlop={8}
                          onPress={() => onInsertReference({
                            path: childPath,
                            kind: isDirectory ? 'directory' : 'file',
                            ...(entry.size === undefined ? {} : { size: entry.size }),
                          })}
                        >
                          <Text style={styles.rowAction}>＋</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )
                })}
                {state.truncated && (
                  <Text style={styles.hint}>{t('files.truncated', { count: state.entries.length })}</Text>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </ModalBackdrop>
    </Modal>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.card,
    marginHorizontal: spacing(3),
    padding: spacing(4),
    gap: spacing(2),
    maxHeight: '80%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing(2) },
  title: { flex: 1, color: colors.text, fontSize: fontSize.body, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: spacing(3) },
  headerAction: { color: colors.accent, fontSize: fontSize.small },
  crumbRow: { alignItems: 'center', gap: spacing(1), paddingVertical: spacing(1) },
  crumb: { color: colors.accent, fontSize: fontSize.tiny },
  crumbActive: { color: colors.textDim },
  crumbSeparator: { color: colors.textDim, fontSize: fontSize.tiny },
  list: { maxHeight: 420 },
  spinner: { marginVertical: spacing(3) },
  hint: { color: colors.textDim, fontSize: fontSize.small, paddingVertical: spacing(2) },
  watchError: { color: colors.warning, fontSize: fontSize.tiny, paddingVertical: spacing(1) },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), paddingVertical: spacing(2) },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  rowIcon: { color: colors.textDim, fontSize: fontSize.small, width: spacing(6) },
  rowName: { flex: 1, color: colors.text, fontSize: fontSize.small },
  rowDisabled: { color: colors.textDim },
  rowMeta: { color: colors.textDim, fontSize: fontSize.tiny },
  rowAction: { color: colors.accent, fontSize: fontSize.body, paddingHorizontal: spacing(1) },
})
