/**
 * Session list: workspace grouping, running badges, archive visibility.
 * Data comes from the store's baseline + host frames; list rows re-render on
 * store 'changed' (throttled).
 */
import React, { useEffect, useState } from 'react'
import { Alert, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import type { ConnectionManager } from '@dsh-mobile/core'
import type { DirectoryListing, SessionSummary } from '@dsh-mobile/protocol'
import { PromptModal } from '../components/PromptModal'
import { colors, fontSize, radius, spacing } from '../theme'

interface Props {
  manager: ConnectionManager
  onOpenSession: (sessionId: string) => void
  onUnpair: () => void
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

export function SessionListScreen({ manager, onOpenSession, onUnpair }: Props): React.JSX.Element {
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
  const visible = store.summaries.filter(s => !s.blank && !store.archivedSessionIds.includes(s.sessionId))
  const archived = store.summaries.filter(s => store.archivedSessionIds.includes(s.sessionId))
  const inWorkspace = selectedWs === null
    ? visible
    : visible.filter(s => (store.workspaces.find(w => w.workspaceId === selectedWs)?.sessionIds ?? []).includes(s.sessionId))

  const wsRename = (workspaceId: string): void => {
    setWsRenameId(workspaceId)
  }

  const wsDelete = (workspaceId: string): void => {
    Alert.alert('删除工作区', '会话保留，仅移除工作区分组。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => {
        void manager.client?.workspace.delete({ workspaceId } as never).catch(() => undefined).finally(() => { void manager.refreshBaseline() })
      } },
    ])
  }

  const wsCreate = (path: string): void => {
    void manager.client?.workspace.create({ path } as never).catch(() => undefined).finally(() => { void manager.refreshBaseline() })
  }

  const loadDirectory = async (path?: string): Promise<void> => {
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
  }

  useEffect(() => {
    if (browser === null) return
    void loadDirectory(browser.path)
  }, [browser, manager])

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
    const result = await client.agentPresets.list({} as never).catch(() => null)
    if (result?.result.ok && result.result.value.presets.length > 0) {
      setPresetPick({ presets: result.result.value.presets as never })
    } else {
      await newSession(undefined)
    }
  }

  const newSession = async (agentPreset?: string): Promise<void> => {
    const client = manager.client
    if (client === null) return
    const result = await client.sessions.create(agentPreset === undefined ? {} : { agentPreset } as never)
    if (result.result.ok) {
      onOpenSession(result.result.value.sessionId)
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
    Alert.alert('归档会话', '归档后从列表隐藏，可在「归档」中查看。', [
      { text: '取消', style: 'cancel' },
      { text: '归档', style: 'destructive', onPress: () => {
        void manager.client?.workspace.archiveSession({ sessionId } as never).catch(() => undefined).finally(() => { void manager.refreshBaseline() })
      } },
    ])
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>会话</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => void newSession(undefined)} onLongPress={() => void openPresetPicker()} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>＋ 新会话</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowArchived(a => !a)} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>{showArchived ? '返回' : '归档'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onUnpair} style={styles.headerButton}>
            <Text style={[styles.headerButtonText, { color: colors.danger }]}>解除配对</Text>
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView horizontal style={styles.wsBar} contentContainerStyle={styles.wsBarContent} showsHorizontalScrollIndicator={false}>
        <TouchableOpacity
          style={[styles.wsChip, selectedWs === null && styles.wsChipActive]}
          onPress={() => setSelectedWs(null)}
          onLongPress={() => setBrowser({})}
        >
          <Text style={styles.wsChipText}>全部</Text>
        </TouchableOpacity>
        {store.workspaces.map(ws => (
          <TouchableOpacity
            key={ws.workspaceId}
            style={[styles.wsChip, selectedWs === ws.workspaceId && styles.wsChipActive]}
            onPress={() => setSelectedWs(ws.workspaceId)}
            onLongPress={() => {
              Alert.alert(ws.title, ws.path, [
              { text: '取消', style: 'cancel' },
              { text: '重命名', onPress: () => wsRename(ws.workspaceId) },
                { text: '删除', style: 'destructive', onPress: () => wsDelete(ws.workspaceId) },
              ])
            }}
          >
            <Text style={styles.wsChipText} numberOfLines={1}>{ws.title}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.wsChip, styles.wsChipAdd]} onPress={() => setWsCreateOpen(true)}>
          <Text style={styles.wsChipText}>＋ 工作区</Text>
        </TouchableOpacity>
      </ScrollView>
      {showArchived ? (
        <FlatList
          data={archived}
          keyExtractor={item => item.sessionId}
          ListEmptyComponent={<Text style={styles.empty}>没有归档会话。</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.textDim }]} numberOfLines={1}>
                  {manager.store.title(item.sessionId) ?? item.cwd ?? item.sessionId.slice(0, 8)}
                </Text>
              </View>
            </View>
          )}
        />
      ) : (
        <>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="搜索会话内容…"
              placeholderTextColor={colors.textDim}
              onSubmitEditing={() => void runSearch()}
              returnKeyType="search"
            />
            {searchHits !== null && (
              <TouchableOpacity onPress={() => { setQuery(''); setSearchHits(null) }}>
                <Text style={styles.headerButtonText}>清除</Text>
              </TouchableOpacity>
            )}
          </View>
          <FlatList
            data={searchHits !== null
              ? searchHits.map(h => ({ sessionId: h.sessionId, snippet: h.snippet }))
              : inWorkspace.map(s => ({ sessionId: s.sessionId, snippet: '' }))}
            keyExtractor={item => item.sessionId}
            contentContainerStyle={searchHits === null && visible.length === 0 ? styles.emptyContainer : undefined}
            ListEmptyComponent={<Text style={styles.empty}>{searchHits !== null ? '无匹配结果。' : '暂无会话，点右上角新建。'}</Text>}
            renderItem={({ item }) => searchHits !== null
              ? (
                <TouchableOpacity style={styles.row} onPress={() => onOpenSession(item.sessionId)}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {manager.store.title(item.sessionId) ?? item.sessionId.slice(0, 8)}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={2}>{item.snippet}</Text>
                  </View>
                </TouchableOpacity>
              )
              : (() => {
                const s = inWorkspace.find(v => v.sessionId === item.sessionId)
                return s === undefined
                  ? <View />
                  : <SessionRow manager={manager} item={s} onOpen={onOpenSession} onArchive={archive} />
              })()}
          />
        </>
      )}
      <PromptModal
        visible={wsCreateOpen}
        title="新建工作区（目录路径）"
        initial="C:\\"
        confirmLabel="创建"
        onCancel={() => setWsCreateOpen(false)}
        onConfirm={p => { setWsCreateOpen(false); wsCreate(p) }}
      />
      <Modal transparent visible={presetPick !== null} animationType="fade" onRequestClose={() => setPresetPick(null)}>
        <View style={styles.backdrop}>
          <View style={styles.menuCard}>
            <Text style={styles.wsChipText}>选择 Agent Preset</Text>
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
        </View>
      </Modal>
      <PromptModal
        visible={wsRenameId !== null}
        title="重命名工作区"
        initial={store.workspaces.find(w => w.workspaceId === wsRenameId)?.title ?? ''}
        confirmLabel="重命名"
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
              <Text style={styles.headerButtonText}>关闭</Text>
            </TouchableOpacity>
            <Text style={styles.browserTitle} numberOfLines={1}>{listing?.path ?? '目录'}</Text>
            {listing !== null && (
              <TouchableOpacity onPress={() => setFolderCreateOpen(true)}>
                <Text style={styles.headerButtonText}>＋</Text>
              </TouchableOpacity>
            )}
          </View>
          {listing !== null && (
            <ScrollView horizontal style={styles.wsBar} contentContainerStyle={styles.wsBarContent} showsHorizontalScrollIndicator={false}>
              {listing.crumbs.map(crumb => (
                <TouchableOpacity
                  key={crumb.path}
                  style={[styles.wsChip, crumb.path === listing.path && styles.wsChipActive]}
                  onPress={() => setBrowser({ path: crumb.path })}
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
            ListEmptyComponent={<Text style={styles.empty}>{browserError === '' ? '没有子目录。' : ''}</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} onPress={() => setBrowser({ path: item.path })}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
      <PromptModal
        visible={folderCreateOpen}
        title="新建目录"
        initial=""
        confirmLabel="创建"
        onCancel={() => setFolderCreateOpen(false)}
        onConfirm={name => { void createFolder(name) }}
      />
    </View>
  )
}

function SessionRow({ manager, item, onOpen, onArchive }: {
  manager: ConnectionManager
  item: SessionSummary
  onOpen: (sessionId: string) => void
  onArchive: (sessionId: string) => void
}): React.JSX.Element {
  const title = manager.store.title(item.sessionId) ?? item.cwd ?? item.sessionId.slice(0, 8)
  const pending = manager.store.sessions.get(item.sessionId)
  const needsAttention = (pending?.pendingApprovals.size ?? 0) + (pending?.pendingQuestions.size ?? 0) > 0
  const liveJobs = (pending?.jobs ?? []).filter(j => j.status === 'running' || j.status === 'stopping').length
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onOpen(item.sessionId)}
      onLongPress={() => onArchive(item.sessionId)}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowSub}>{new Date(item.updatedAt).toLocaleString()}</Text>
      </View>
      {needsAttention && <View style={[styles.badge, { backgroundColor: colors.warning }]}><Text style={styles.badgeText}>待处理</Text></View>}
      {liveJobs > 0 && <View style={[styles.badge, { backgroundColor: colors.success }]}><Text style={styles.badgeText}>任务×{liveJobs}</Text></View>}
      {item.running && <View style={[styles.badge, { backgroundColor: colors.running }]}><Text style={styles.badgeText}>运行中</Text></View>}
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
  headerActions: { flexDirection: 'row', gap: spacing(3) },
  headerButton: { paddingVertical: spacing(1) },
  headerButtonText: { color: colors.accent, fontSize: fontSize.small },
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
  browserError: {
    color: colors.danger,
    fontSize: fontSize.small,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2),
  },
})
