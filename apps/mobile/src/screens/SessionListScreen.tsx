/**
 * Session list: workspace grouping, running badges, archive visibility.
 * Data comes from the store's baseline + host frames; list rows re-render on
 * store 'changed' (throttled).
 */
import React, { useEffect, useState } from 'react'
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ConnectionManager } from '@dsh-mobile/core'
import type { SessionSummary } from '@dsh-mobile/protocol'
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
  const visible = store.summaries.filter(s => !s.blank && !store.archivedSessionIds.includes(s.sessionId))

  const newSession = async (): Promise<void> => {
    const client = manager.client
    if (client === null) return
    try {
      const result = await client.sessions.create({} as never)
      if (result.result.ok) {
        onOpenSession(result.result.value.sessionId)
      } else {
        console.error('[session.create]', JSON.stringify(result.result.error))
      }
    } catch (error) {
      console.error('[session.create] threw:', error instanceof Error ? error.stack : error)
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>会话</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => void newSession()} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>＋ 新会话</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onUnpair} style={styles.headerButton}>
            <Text style={[styles.headerButtonText, { color: colors.danger }]}>解除配对</Text>
          </TouchableOpacity>
        </View>
      </View>
      <FlatList
        data={visible}
        keyExtractor={item => item.sessionId}
        contentContainerStyle={visible.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={<Text style={styles.empty}>暂无会话，点右上角新建。</Text>}
        renderItem={({ item }) => <SessionRow manager={manager} item={item} onOpen={onOpenSession} />}
      />
    </View>
  )
}

function SessionRow({ manager, item, onOpen }: {
  manager: ConnectionManager
  item: SessionSummary
  onOpen: (sessionId: string) => void
}): React.JSX.Element {
  const title = manager.store.title(item.sessionId) ?? item.cwd ?? item.sessionId.slice(0, 8)
  const pending = manager.store.sessions.get(item.sessionId)
  const needsAttention = (pending?.pendingApprovals.size ?? 0) + (pending?.pendingQuestions.size ?? 0) > 0
  const liveJobs = (pending?.jobs ?? []).filter(j => j.status === 'running' || j.status === 'stopping').length
  return (
    <TouchableOpacity style={styles.row} onPress={() => onOpen(item.sessionId)}>
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
})
