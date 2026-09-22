/**
 * Session list: workspace grouping, running badges, archive visibility.
 * Data comes from the store's baseline + host frames; list rows re-render on
 * store 'changed' (throttled).
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Clipboard, FlatList, Modal, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import type { ConnectionManager } from '@dsh-mobile/core'
import { presetSelectionEnabled, type DirectoryListing, type SessionSummary } from '@dsh-mobile/protocol'
import { ModalBackdrop } from '../components/ModalBackdrop'
import { ActionSheet, type SheetAction } from '../components/ActionSheet'
import { PromptModal } from '../components/PromptModal'
import { sessionSections } from '../session-sections'
import { colors, fontSize, radius, spacing } from '../theme'
import { useI18n } from '../i18n'

/** One rendered line: a collapsible section header, or a session row. */
type ListEntry =
  | { kind: 'header'; key: string; sectionKey: string; title: string; workspaceId: string | null; count: number }
  | { kind: 'session'; key: string; session: SessionSummary }
  | { kind: 'hit'; key: string; sessionId: string; snippet: string }

interface Props {
  manager: ConnectionManager
  onOpenSession: (sessionId: string) => void
  onOpenSettings?: () => void
}

function useStoreVersion(manager: ConnectionManager): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let pending = false
    const off = manager.store.on('changed', () => {
      if (pending) return
      pending = true
      setTimeout(() => {
        pending = false
        setVersion(v => v + 1)
      }, 50)
    })
    return off
  }, [manager])
  return version
}

function copyPath(path: string): void { Clipboard.setString(path) }
function sharePath(path: string): void { void Share.share({ message: path }).catch(() => undefined) }

export function SessionListScreen({ manager, onOpenSession, onOpenSettings }: Props): React.JSX.Element {
  const { t } = useI18n()
  useStoreVersion(manager)
  const { store } = manager
  const [query, setQuery] = useState('')
  const [searchHits, setSearchHits] = useState<{ sessionId: string; snippet: string }[] | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [selectedWs, setSelectedWs] = useState<string | null>(null)
  const [wsCreateOpen, setWsCreateOpen] = useState(false)
  const [wsRenameId, setWsRenameId] = useState<string | null>(null)
  const [presetPick, setPresetPick] = useState<{ presets: { id: string }[] } | null>(null)
  const [browser, setBrowser] = useState<{ path?: string } | null>(null)
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [browserError, setBrowserError] = useState('')
  const [folderCreateOpen, setFolderCreateOpen] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  const [sessionRenameId, setSessionRenameId] = useState<string | null>(null)
  /** Collapsed section keys; a section collapses only when explicitly closed. */
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  /** Restoring an archived Session needs the host mapping added in dsh 0.1.6. */
  const canUnarchive = (manager.compatibility?.features ?? []).includes('workspace-unarchive')
  /**
   * Long-press menus run as sheets, not `Alert.alert`: Android shows at most
   * three Alert buttons, so the previous four- and five-action menus silently
   * dropped archive/rename/delete (verified on the emulator).
   */
  const [sessionMenu, setSessionMenu] = useState<{ sessionId: string; title: string; archived: boolean } | null>(null)
  const [workspaceMenu, setWorkspaceMenu] = useState<{ workspaceId: string; title: string } | null>(null)
  const visible = store.summaries.filter(s => !s.blank && !store.archivedSessionIds.includes(s.sessionId))
  const archived = store.summaries.filter(s => store.archivedSessionIds.includes(s.sessionId))
  const visibleById = new Map(visible.map(s => [s.sessionId, s]))
  const accountedIds = new Set(store.workspaces.flatMap(ws => ws.sessionIds))
  const allOrdered = [
    ...store.workspaces.flatMap(ws => ws.sessionIds),
    ...visible.filter(s => !accountedIds.has(s.sessionId)).map(s => s.sessionId),
  ]
    .map(id => visibleById.get(id))
    .filter((s): s is SessionSummary => s !== undefined)
  const inWorkspace = selectedWs === null
    ? allOrdered
    : (store.workspaces.find(w => w.workspaceId === selectedWs)?.sessionIds ?? [])
        .map(id => visibleById.get(id))
        .filter((s): s is SessionSummary => s !== undefined)

  /**
   * The list is grouped by workspace on the 「全部」 view, one collapsible
   * header per workspace plus a trailing 未分组 bucket — the same shape the
   * web sidebar uses. Picking a workspace chip still narrows to a flat list.
   */
  const listEntries: ListEntry[] = searchHits !== null
    ? searchHits.map(hit => ({ kind: 'hit', key: hit.sessionId, sessionId: hit.sessionId, snippet: hit.snippet }))
    : selectedWs !== null
      ? inWorkspace.map(session => ({ kind: 'session', key: session.sessionId, session }))
      : sessionSections({
          workspaces: store.workspaces,
          summaries: store.summaries,
          archivedSessionIds: store.archivedSessionIds,
        }).flatMap(section => {
          const sectionKey = section.workspaceId ?? 'ungrouped'
          const header: ListEntry = {
            kind: 'header',
            key: `header:${sectionKey}`,
            sectionKey,
            title: section.title ?? t('session.ungrouped'),
            workspaceId: section.workspaceId,
            count: section.sessionIds.length,
          }
          if (collapsedSections.has(sectionKey)) return [header]
          return [
            header,
            ...section.sessionIds
              .map(id => visibleById.get(id as never))
              .filter((s): s is SessionSummary => s !== undefined)
              .map(session => ({ kind: 'session' as const, key: session.sessionId, session })),
          ]
        })

  const toggleSection = (sectionKey: string): void => {
    setCollapsedSections(current => {
      const next = new Set(current)
      if (next.has(sectionKey)) next.delete(sectionKey)
      else next.add(sectionKey)
      return next
    })
  }

  const wsRename = (workspaceId: string): void => {
    setWsRenameId(workspaceId)
  }

  const wsDelete = (workspaceId: string): void => {
    Alert.alert(t('session.deleteWorkspaceTitle'), t('session.deleteWorkspaceMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => {
        void manager.client?.workspace.delete({ workspaceId } as never).catch(() => undefined).finally(() => { void manager.refreshBaseline() })
      } },
    ])
  }

  const wsCreate = (path: string): void => {
    void manager.client?.workspace.create({ path } as never).catch(() => undefined).finally(() => { void manager.refreshBaseline() })
  }

  const moveWorkspace = (workspaceId: string, direction: -1 | 1): void => {
    const index = store.workspaces.findIndex(ws => ws.workspaceId === workspaceId)
    if (index < 0) return
    const next = index + direction
    if (next < 0 || next >= store.workspaces.length) return
    const anchor = direction === -1
      ? store.workspaces[index - 1]?.workspaceId
      : store.workspaces[index + 2]?.workspaceId
    void manager.client?.workspace.insertBefore({
      workspaceId,
      ...(anchor === undefined ? {} : { beforeWorkspaceId: anchor }),
    } as never).catch(() => undefined).finally(() => { void manager.refreshBaseline() })
  }

  const moveSession = (sessionId: string, direction: -1 | 1): void => {
    const ws = store.workspaces.find(w => w.sessionIds.includes(sessionId as never))
    if (ws === undefined) return
    const order = ws.sessionIds.filter(id => !store.archivedSessionIds.includes(id))
    const index = order.indexOf(sessionId as never)
    const next = index + direction
    if (index < 0 || next < 0 || next >= order.length) return
    const anchor = direction === -1
      ? order[index - 1]
      : order[index + 2]
    void manager.client?.workspace.insertSessionBefore({
      workspaceId: ws.workspaceId,
      sessionId,
      ...(anchor === undefined ? {} : { beforeSessionId: anchor }),
    } as never).catch(() => undefined).finally(() => { void manager.refreshBaseline() })
  }

  const loadDirectory = useCallback(async (path?: string): Promise<void> => {
    const client = manager.client
    if (client === null) return
    const result = await client.host.listDirectory(path === undefined ? {} : { path } as never).catch(() => null)
    const rpc = result?.result
    if (rpc?.ok) {
      setListing(rpc.value)
      setBrowserError('')
    } else if (rpc !== undefined && !rpc.ok) {
      setListing(null)
      setBrowserError(rpc.error.message)
    }
  }, [manager])

  useEffect(() => {
    if (browser === null) return
    void loadDirectory(browser.path)
  }, [browser, loadDirectory])

  const createFolder = async (name: string): Promise<void> => {
    const client = manager.client
    setFolderCreateOpen(false)
    if (client === null || listing === null) return
    const response = await client.host.createDirectory({ path: listing.path, name } as never).catch(() => null)
    const rpc = response?.result
    if (rpc?.ok) await loadDirectory(listing.path)
    else if (rpc !== undefined && !rpc.ok) setBrowserError(rpc.error.message)
  }

  const openPresetPicker = async (): Promise<void> => {
    const client = manager.client
    if (client === null) return
    const roster = await client.catalog.agentPresets().catch(() => null)
    // The host hides mode selection as a policy: the saved default governs new
    // sessions, so offering a picker here would promise a choice that is ignored.
    if (roster !== null && presetSelectionEnabled(roster) === false) {
      await newSession(undefined)
      return
    }
    if (roster !== null && roster.presets.length > 0) {
      setPresetPick({ presets: roster.presets as never })
    } else {
      await newSession(undefined)
    }
  }

  const newSession = async (agentPreset?: string): Promise<void> => {
    const client = manager.client
    if (creatingSession) return
    if (client === null) {
      Alert.alert(t('session.notConnected'))
      return
    }
    setCreatingSession(true)
    try {
      const result = await client.sessions.create(agentPreset === undefined ? {} : { agentPreset } as never)
      if (result.result.ok) {
        onOpenSession(result.result.value.sessionId)
      } else {
        Alert.alert(t('session.operationFailed'), t('link.newSessionFailed', {
          message: String(result.result.error.message ?? ''),
        }))
      }
    } catch (cause) {
      Alert.alert(t('session.operationFailed'), t('link.newSessionFailed', {
        message: cause instanceof Error ? cause.message : String(cause),
      }))
    } finally {
      setCreatingSession(false)
    }
  }

  const runSearch = async (): Promise<void> => {
    const q = query.trim()
    if (q === '') { setSearchHits(null); return }
    const client = manager.client
    if (client === null) return
    const result = await client.sessions.search({ query: q } as never).catch(() => null)
    setSearchHits(result?.result.ok ? (result.result.value.items as never) : [])
  }

  const archive = (sessionId: string): void => {
    Alert.alert(t('session.archiveTitle'), t('session.archiveMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.archive'), style: 'destructive', onPress: () => {
        void manager.client?.workspace.archiveSession({ sessionId } as never).catch(() => undefined).finally(() => { void manager.refreshBaseline() })
      } },
    ])
  }

  /** Restore one archived Session; the host answers with the complete archive set. */
  const unarchive = (sessionId: string): void => {
    void manager.client?.workspaceAdmin.unarchiveSession({ sessionId })
      .catch(() => undefined)
      .finally(() => { void manager.refreshBaseline() })
  }

  const renameSession = (sessionId: string, title: string): void => {
    void manager.client?.sessions.rename({ sessionId, title } as never)
      .catch(() => undefined)
      .finally(() => { void manager.refreshBaseline() })
  }

  /** Fork the whole Session; the copy lands in the same workspace as its source. */
  const forkSession = (sessionId: string): void => {
    void manager.client?.sessions.fork({ sessionId } as never)
      .catch(() => undefined)
      .finally(() => { void manager.refreshBaseline() })
  }

  const sessionActions: SheetAction[] = sessionMenu === null
    ? []
    : sessionMenu.archived
      ? [{ key: 'unarchive', label: t('session.unarchive') }]
      : [
          { key: 'rename', label: t('common.rename') },
          { key: 'fork', label: t('session.fork') },
          { key: 'up', label: t('session.moveUp') },
          { key: 'down', label: t('session.moveDown') },
          { key: 'archive', label: t('common.archive'), danger: true },
        ]

  const runSessionAction = (menu: { sessionId: string; archived: boolean }, key: string): void => {
    if (key === 'rename') setSessionRenameId(menu.sessionId)
    else if (key === 'fork') forkSession(menu.sessionId)
    else if (key === 'up') moveSession(menu.sessionId, -1)
    else if (key === 'down') moveSession(menu.sessionId, 1)
    else if (key === 'archive') archive(menu.sessionId)
    else if (key === 'unarchive') unarchive(menu.sessionId)
  }

  const workspaceActions: SheetAction[] = workspaceMenu === null
    ? []
    : [
        { key: 'up', label: t('session.moveUp') },
        { key: 'down', label: t('session.moveDown') },
        { key: 'rename', label: t('common.rename') },
        { key: 'delete', label: t('common.delete'), danger: true },
      ]

  const runWorkspaceAction = (menu: { workspaceId: string }, key: string): void => {
    if (key === 'up') moveWorkspace(menu.workspaceId, -1)
    else if (key === 'down') moveWorkspace(menu.workspaceId, 1)
    else if (key === 'rename') wsRename(menu.workspaceId)
    else if (key === 'delete') wsDelete(menu.workspaceId)
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('session.title')}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            disabled={creatingSession}
            onPress={() => void newSession(undefined)}
            onLongPress={() => void openPresetPicker()}
            style={[styles.headerButton, creatingSession && styles.headerButtonDisabled]}
          >
            <Text style={styles.headerButtonText}>{t(creatingSession ? 'session.creating' : 'session.new')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowArchived(a => !a)} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>{showArchived ? t('common.back') : t('common.archive')}</Text>
          </TouchableOpacity>
          {onOpenSettings !== undefined && (
            <TouchableOpacity
              onPress={onOpenSettings}
              style={styles.settingsButton}
              accessibilityRole="button"
              accessibilityLabel={t('app.settings')}
            >
              <Text style={styles.settingsIcon}>⚙</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <ScrollView horizontal style={styles.wsBar} contentContainerStyle={styles.wsBarContent} showsHorizontalScrollIndicator={false}>
        <TouchableOpacity
          style={[styles.wsChip, selectedWs === null && styles.wsChipActive]}
          onPress={() => setSelectedWs(null)}
          onLongPress={() => setBrowser({})}
        >
          <Text style={styles.wsChipText}>{t('session.all')}</Text>
        </TouchableOpacity>
        {store.workspaces.map(ws => (
          <TouchableOpacity
            key={ws.workspaceId}
            style={[styles.wsChip, selectedWs === ws.workspaceId && styles.wsChipActive]}
            onPress={() => setSelectedWs(ws.workspaceId)}
            onLongPress={() => setWorkspaceMenu({ workspaceId: ws.workspaceId, title: ws.title })}
          >
            <Text style={styles.wsChipText} numberOfLines={1}>{ws.title}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.wsChip, styles.wsChipAdd]} onPress={() => setWsCreateOpen(true)}>
          <Text style={styles.wsChipText}>{t('session.workspaceAdd')}</Text>
        </TouchableOpacity>
      </ScrollView>
      {showArchived ? (
        <FlatList
          data={archived}
          keyExtractor={item => item.sessionId}
          ListEmptyComponent={<Text style={styles.empty}>{t('session.noArchived')}</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onLongPress={() => setSessionMenu({
                sessionId: item.sessionId,
                title: manager.store.title(item.sessionId) ?? item.cwd ?? item.sessionId.slice(0, 8),
                archived: true,
              })}
              disabled={!canUnarchive}
            >
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.textDim }]} numberOfLines={1}>
                  {manager.store.title(item.sessionId) ?? item.cwd ?? item.sessionId.slice(0, 8)}
                </Text>
              </View>
              {canUnarchive && (
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.rowAction}
                  onPress={() => unarchive(item.sessionId)}
                  hitSlop={8}
                >
                  <Text style={styles.rowActionText}>{t('session.unarchive')}</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          )}
        />
      ) : (
        <>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={t('session.searchPlaceholder')}
              placeholderTextColor={colors.textDim}
              onSubmitEditing={() => void runSearch()}
              returnKeyType="search"
            />
            {searchHits !== null && (
              <TouchableOpacity onPress={() => { setQuery(''); setSearchHits(null) }}>
                <Text style={styles.headerButtonText}>{t('common.clear')}</Text>
              </TouchableOpacity>
            )}
          </View>
          <FlatList
            data={listEntries}
            keyExtractor={item => item.key}
            contentContainerStyle={searchHits === null && visible.length === 0 ? styles.emptyContainer : undefined}
            ListEmptyComponent={<Text style={styles.empty}>{searchHits !== null ? t('session.noMatches') : t('session.noSessions')}</Text>}
            renderItem={({ item }) => {
              if (item.kind === 'hit') {
                return (
                <TouchableOpacity style={styles.row} onPress={() => onOpenSession(item.sessionId)}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {manager.store.title(item.sessionId) ?? item.sessionId.slice(0, 8)}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={2}>{item.snippet}</Text>
                  </View>
                </TouchableOpacity>
                )
              }
              if (item.kind === 'header') {
                const collapsed = collapsedSections.has(item.sectionKey)
                return (
                  <TouchableOpacity
                    style={styles.sectionHeader}
                    onPress={() => toggleSection(item.sectionKey)}
                    onLongPress={item.workspaceId === null
                      ? undefined
                      : () => setWorkspaceMenu({ workspaceId: item.workspaceId as string, title: item.title })}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                  >
                    <Text style={[styles.sectionChevron, collapsed && styles.sectionChevronCollapsed]}>▼</Text>
                    <Text style={styles.sectionTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.sectionCount}>{item.count}</Text>
                  </TouchableOpacity>
                )
              }
              return (
                    <SessionRow
                      manager={manager}
                      item={item.session}
                      onOpen={onOpenSession}
                      onMenu={() => setSessionMenu({
                        sessionId: item.session.sessionId,
                        title: manager.store.title(item.session.sessionId) ?? item.session.cwd ?? item.session.sessionId.slice(0, 8),
                        archived: false,
                      })}
                    />
              )
            }}
          />
        </>
      )}
      <PromptModal
        visible={wsCreateOpen}
        title={t('session.newWorkspace')}
        initial="C:\\"
        confirmLabel={t('common.create')}
        onCancel={() => setWsCreateOpen(false)}
        onConfirm={p => { setWsCreateOpen(false); wsCreate(p) }}
      />
      <Modal transparent visible={presetPick !== null} animationType="fade" onRequestClose={() => setPresetPick(null)}>
        <ModalBackdrop onClose={() => setPresetPick(null)}>
          <View style={styles.menuCard}>
            <Text style={styles.wsChipText}>{t('session.choosePreset')}</Text>
            {presetPick?.presets.map(p => (
              <TouchableOpacity
                key={p.id}
                style={styles.menuRow}
                onPress={() => { const id = p.id; setPresetPick(null); void newSession(id) }}
              >
                <Text style={styles.menuText}>{p.id}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ModalBackdrop>
      </Modal>
      <PromptModal
        visible={wsRenameId !== null}
        title={t('session.renameWorkspace')}
        initial={store.workspaces.find(w => w.workspaceId === wsRenameId)?.title ?? ''}
        confirmLabel={t('common.rename')}
        onCancel={() => setWsRenameId(null)}
        onConfirm={t => {
          if (wsRenameId !== null) {
            void manager.client?.workspace.rename({ workspaceId: wsRenameId, title: t } as never)
              .catch(() => undefined)
              .finally(() => { void manager.refreshBaseline() })
          }
          setWsRenameId(null)
        }}
      />
      <Modal visible={browser !== null} animationType="slide" onRequestClose={() => setBrowser(null)}>
        <View style={styles.browserRoot}>
          <View style={styles.browserHeader}>
            <TouchableOpacity onPress={() => setBrowser(null)}>
              <Text style={styles.headerButtonText}>{t('common.close')}</Text>
            </TouchableOpacity>
            <Text style={styles.browserTitle} numberOfLines={1}>{listing?.path ?? t('common.directory')}</Text>
            {listing !== null && (
              <View style={styles.browserActions}>
                <TouchableOpacity onPress={() => copyPath(listing.path)}>
                  <Text style={styles.headerButtonText}>{t('common.copy')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => sharePath(listing.path)}>
                  <Text style={styles.headerButtonText}>{t('common.share')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setFolderCreateOpen(true)}>
                  <Text style={styles.headerButtonText}>＋</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {listing !== null && (
            <ScrollView horizontal style={styles.wsBar} contentContainerStyle={styles.wsBarContent} showsHorizontalScrollIndicator={false}>
              {listing.crumbs.map(crumb => (
                <TouchableOpacity
                  key={crumb.path}
                  style={[styles.wsChip, crumb.path === listing.path && styles.wsChipActive]}
                  onPress={() => setBrowser({ path: crumb.path })}
                  onLongPress={() => copyPath(crumb.path)}
                >
                  <Text style={styles.wsChipText}>{crumb.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {browserError !== '' && <Text style={styles.browserError}>{browserError}</Text>}
          <FlatList
            data={listing?.entries ?? []}
            keyExtractor={item => item.path}
            ListEmptyComponent={<Text style={styles.empty}>{browserError === '' ? t('session.noSubdirectories') : ''}</Text>}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <TouchableOpacity style={styles.rowText} onPress={() => setBrowser({ path: item.path })}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.rowAction}
                  onPress={() => copyPath(item.path)}
                  onLongPress={() => sharePath(item.path)}
                >
                  <Text style={styles.rowActionText}>{t('common.copy')}</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      </Modal>
      <PromptModal
        visible={folderCreateOpen}
        title={t('session.newDirectory')}
        initial=""
        confirmLabel={t('common.create')}
        onCancel={() => setFolderCreateOpen(false)}
        onConfirm={name => { void createFolder(name) }}
      />
      <PromptModal
        visible={sessionRenameId !== null}
        title={t('session.renameSession')}
        initial={sessionRenameId === null
          ? ''
          : manager.store.title(sessionRenameId) ?? visibleById.get(sessionRenameId as never)?.cwd ?? ''}
        confirmLabel={t('common.rename')}
        onCancel={() => setSessionRenameId(null)}
        onConfirm={title => {
          const sessionId = sessionRenameId
          setSessionRenameId(null)
          if (sessionId !== null) renameSession(sessionId, title)
        }}
      />
      <ActionSheet
        visible={sessionMenu !== null}
        title={sessionMenu?.title ?? t('session.actions')}
        actions={sessionActions}
        onClose={() => setSessionMenu(null)}
        onAction={(key) => {
          const menu = sessionMenu
          setSessionMenu(null)
          if (menu !== null) runSessionAction(menu, key)
        }}
      />
      <ActionSheet
        visible={workspaceMenu !== null}
        title={workspaceMenu?.title ?? ''}
        actions={workspaceActions}
        onClose={() => setWorkspaceMenu(null)}
        onAction={(key) => {
          const menu = workspaceMenu
          setWorkspaceMenu(null)
          if (menu !== null) runWorkspaceAction(menu, key)
        }}
      />
    </View>
  )
}

function SessionRow({ manager, item, onOpen, onMenu }: {
  manager: ConnectionManager
  item: SessionSummary
  onOpen: (sessionId: string) => void
  onMenu: () => void
}): React.JSX.Element {
  const { locale, t } = useI18n()
  const title = manager.store.title(item.sessionId) ?? item.cwd ?? item.sessionId.slice(0, 8)
  const pending = manager.store.sessions.get(item.sessionId)
  const needsAttention = (pending?.pendingApprovals.size ?? 0) + (pending?.pendingQuestions.size ?? 0) > 0
  const liveJobs = (pending?.jobs ?? []).filter(j => j.status === 'running' || j.status === 'stopping').length
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onOpen(item.sessionId)}
      onLongPress={onMenu}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowSub}>{new Date(item.updatedAt).toLocaleString(locale, { hour12: false })}</Text>
      </View>
      {needsAttention && <View style={[styles.badge, { backgroundColor: colors.warning }]}><Text style={styles.badgeText}>{t('session.pending')}</Text></View>}
      {liveJobs > 0 && <View style={[styles.badge, { backgroundColor: colors.success }]}><Text style={styles.badgeText}>{t('session.jobs', { count: liveJobs })}</Text></View>}
      {item.running && <View style={[styles.badge, { backgroundColor: colors.running }]}><Text style={styles.badgeText}>{t('session.running')}</Text></View>}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.text, fontSize: fontSize.title, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), marginLeft: 'auto' },
  headerButton: { paddingVertical: spacing(1) },
  headerButtonDisabled: { opacity: 0.5 },
  headerButtonText: { color: colors.accent, fontSize: fontSize.small },
  settingsButton: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  settingsIcon: { color: colors.accent, fontSize: 24, lineHeight: 28 },
  wsBar: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  wsBarContent: { paddingHorizontal: spacing(4), paddingVertical: spacing(2), gap: spacing(2) },
  wsChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1.5),
    maxWidth: 200,
  },
  wsChipActive: { borderColor: colors.accent, backgroundColor: colors.bgBubbleUser },
  wsChipAdd: { borderStyle: 'dashed' },
  wsChipText: { color: colors.text, fontSize: fontSize.small },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center' },
  menuCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.card,
    marginHorizontal: spacing(10),
    paddingVertical: spacing(2),
  },
  menuRow: { paddingHorizontal: spacing(4), paddingVertical: spacing(3) },
  menuText: { color: colors.text, fontSize: fontSize.body },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.small,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.card,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1.5),
  },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { color: colors.textDim, fontSize: fontSize.small },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing(2),
  },
  rowText: { flex: 1 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    minHeight: 36,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    backgroundColor: colors.bg,
  },
  /** The disclosure doubles as the section icon. Full-size triangles (not the
   *  small ▾/▸ variants) so it reads as an affordance at the 14px label size. */
  sectionChevron: { color: colors.textDim, fontSize: 14, width: 16, textAlign: 'center' },
  /** Rotating one glyph keeps both states the same size: ▼ and ▶ are different
   *  characters and their glyphs do not match in the same font. */
  sectionChevronCollapsed: { transform: [{ rotate: '-90deg' }] },
  sectionTitle: { flex: 1, color: colors.text, fontSize: fontSize.section, fontWeight: '600' },
  sectionCount: { color: colors.textDim, fontSize: fontSize.small },
  rowAction: { paddingHorizontal: spacing(2), paddingVertical: spacing(1) },
  rowActionText: { color: colors.accent, fontSize: fontSize.small },
  rowTitle: { color: colors.text, fontSize: fontSize.body },
  rowSub: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: 2 },
  badge: { borderRadius: radius.card, paddingHorizontal: spacing(2), paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: fontSize.tiny },
  browserRoot: { flex: 1, backgroundColor: colors.bg, paddingTop: spacing(8) },
  browserHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    paddingHorizontal: spacing(4),
    paddingBottom: spacing(2),
  },
  browserTitle: { flex: 1, color: colors.text, fontSize: fontSize.small, textAlign: 'center' },
  browserActions: { flexDirection: 'row', gap: spacing(3) },
  browserError: {
    color: colors.danger,
    fontSize: fontSize.small,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2),
  },
})
