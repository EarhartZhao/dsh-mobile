/** Durable subagent catalog with read-only history and continuable controls. */
import React, { useCallback, useEffect, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { deriveConversation, type ConnectionManager, type ConversationItem, type SessionState } from '@dsh-mobile/core'
import type { HistoryEntry, SubagentCatalog, SubagentListEntry } from '@dsh-mobile/protocol'
import { colors, fontSize, radius, spacing } from '../theme'
import { toolDisplayName } from '../ui-labels'

const HISTORY_PAGE = 40

function stateFromEvents(sessionId: string, events: HistoryEntry[]): SessionState {
  const last = events.at(-1)
  const lastSeq = last !== undefined && typeof last.event.seq === 'number' ? last.event.seq : -1
  return {
    sessionId,
    events,
    lastSeq,
    projections: {},
    projectionSeqs: {},
    queue: [],
    jobs: [],
    pendingApprovals: new Map(),
    pendingQuestions: new Map(),
    running: false,
    todos: [],
    usage: null,
  }
}

function entryTitle(entry: SubagentListEntry): string {
  if (entry.kind === 'diagnostic') return `诊断 · ${entry.id.slice(0, 8)}`
  return entry.label ?? entry.id.slice(0, 8)
}

function statusText(entry: SubagentListEntry): string {
  if (entry.kind === 'diagnostic') {
    if (entry.reason === 'corrupt') return '损坏'
    if (entry.reason === 'unsupported') return '不支持'
    return '不可用'
  }
  return entry.activity === 'running' ? '运行中' : '空闲'
}

function statusColor(entry: SubagentListEntry): string {
  if (entry.kind === 'diagnostic') return colors.danger
  return entry.activity === 'running' ? colors.running : colors.textDim
}

function TranscriptRow({ item }: { item: ConversationItem }): React.JSX.Element {
  const base = item.kind === 'tool'
    ? {
        title: `工具 · ${toolDisplayName(item.name)}`,
        body: item.status === 'error'
          ? `失败：${item.resultPreview || item.args}`
          : item.resultPreview !== '' ? item.resultPreview : item.args,
      }
    : item.kind === 'user'
      ? { title: '用户', body: item.text }
      : item.kind === 'assistant' || item.kind === 'stream'
        ? { title: item.kind === 'stream' ? '助手（流式）' : '助手', body: item.text || item.reasoning }
        : { title: '上下文压缩', body: item.summary }
  if (base.body === '') {
    return (
      <View style={styles.message}>
        <Text style={styles.messageRole}>{base.title}</Text>
        <Text style={styles.messageBody}>{item.kind === 'tool' ? '（无输出）' : '（空消息）'}</Text>
      </View>
    )
  }
  return (
    <View style={[styles.message, item.kind === 'user' && styles.messageUser]}>
      <Text style={styles.messageRole}>{base.title}</Text>
      <Text style={styles.messageBody}>{base.body}</Text>
    </View>
  )
}

export function SubagentPanel({ manager, parentSessionId, catalog, onClose, onOpenSession }: {
  manager: ConnectionManager
  parentSessionId: string
  catalog: SubagentCatalog
  onClose: () => void
  onOpenSession: (sessionId: string) => void
}): React.JSX.Element {
  const [selected, setSelected] = useState<SubagentListEntry | null>(null)
  const [events, setEvents] = useState<HistoryEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const items = selected === null ? [] : deriveConversation(stateFromEvents(selected.id, events))

  const loadHistory = useCallback(async (entry: SubagentListEntry, beforeSeq?: number): Promise<void> => {
    if (entry.kind === 'diagnostic') {
      setEvents([])
      setHasMore(false)
      setError('该子代理记录无法读取。')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await manager.client?.subagents.history({
        parentSessionId,
        childSessionId: entry.id,
        mode: entry.mode,
        maxMessages: HISTORY_PAGE,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      } as never)
      if (result?.result.ok !== true) {
        setError(result?.result.ok === false ? `读取失败：${result.result.error.message}` : '读取失败：连接不可用。')
        return
      }
      const page = result.result.value.events
      setEvents(current => beforeSeq === undefined ? page : [...page, ...current])
      setHasMore(result.result.value.hasMore)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [manager, parentSessionId])

  useEffect(() => {
    if (selected !== null) void loadHistory(selected)
  }, [selected, loadHistory])

  const refreshCatalog = useCallback(async (): Promise<void> => {
    const result = await manager.client?.subagents.list({ parentSessionId } as never).catch(() => null)
    if (result?.result.ok !== true) {
      setError(result?.result.ok === false ? `刷新失败：${result.result.error.message}` : '刷新失败：连接不可用。')
      return
    }
    const fresh = result.result.value.entries
    if (selected === null) return
    const current = fresh.find(entry => entry.id === selected.id)
    if (current !== undefined) setSelected(current)
  }, [manager, parentSessionId, selected])

  const sendPrompt = async (): Promise<void> => {
    const text = prompt.trim()
    const entry = selected
    if (text === '' || entry === null || entry.kind !== 'child' || entry.mode !== 'continuable' || busy) return
    setBusy(true)
    setError('')
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const clientTimeZone = typeof tz === 'string' && (tz === 'UTC' || tz.includes('/')) ? tz : undefined
      const result = await manager.client?.subagents.prompt({
        parentSessionId,
        childSessionId: entry.id,
        mode: 'continuable',
        content: [{ type: 'text', text }],
        ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
      } as never)
      if (result?.result.ok !== true) {
        setError(result?.result.ok === false ? `发送失败：${result.result.error.message}` : '发送失败：连接不可用。')
        return
      }
      setPrompt('')
      await Promise.all([refreshCatalog(), loadHistory(entry)])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const interrupt = async (): Promise<void> => {
    const entry = selected
    if (entry === null || entry.kind !== 'child' || entry.mode !== 'continuable' || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await manager.client?.subagents.interrupt({
        parentSessionId,
        childSessionId: entry.id,
        mode: 'continuable',
      } as never)
      if (result?.result.ok !== true) {
        setError(result?.result.ok === false ? `打断失败：${result.result.error.message}` : '打断失败：连接不可用。')
        return
      }
      await Promise.all([refreshCatalog(), loadHistory(entry)])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const canPrompt = selected !== null
    && selected.kind === 'child'
    && selected.mode === 'continuable'
    && catalog.parentAvailable
  const canInterrupt = selected !== null
    && selected.kind === 'child'
    && selected.mode === 'continuable'
    && selected.activity === 'running'

  if (selected !== null) {
    return (
      <View style={styles.detailCard}>
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => { setSelected(null); setEvents([]); setPrompt('') }}>
            <Text style={styles.link}>返回列表</Text>
          </TouchableOpacity>
          <Text style={styles.detailTitle} numberOfLines={1}>{entryTitle(selected)}</Text>
          <TouchableOpacity onPress={() => onOpenSession(selected.id)}>
            <Text style={styles.link}>打开</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.detailMeta}>
          {statusText(selected)}{selected.kind === 'child' && selected.hasChildren ? ' · 有子级' : ''}
          {selected.kind === 'child' && selected.mode === 'continuable' ? ' · 可续' : selected.kind === 'child' ? ' · 一次性' : ''}
        </Text>
        {error !== '' && <Text style={styles.error}>{error}</Text>}
        {loading && events.length === 0 && <Text style={styles.meta}>正在读取历史…</Text>}
        {!loading && events.length === 0 && error === '' && (
          <Text style={styles.meta}>这个子代理还没有可见记录。</Text>
        )}
        <FlatList
          style={styles.history}
          data={items}
          keyExtractor={item => item.key}
          contentContainerStyle={styles.historyContent}
          renderItem={({ item }) => <TranscriptRow item={item} />}
        />
        {hasMore && (
          <TouchableOpacity
            style={styles.linkRow}
            disabled={loading}
            onPress={() => {
              const firstSeq = events[0]?.event.seq
              if (typeof firstSeq === 'number') void loadHistory(selected, firstSeq)
            }}
          >
            <Text style={styles.link}>{loading ? '加载中…' : '加载更早记录'}</Text>
          </TouchableOpacity>
        )}
        {selected.kind === 'child' && selected.mode === 'continuable' && (
          <View style={styles.promptRow}>
            <TextInput
              style={styles.input}
              value={prompt}
              editable={!busy && catalog.parentAvailable}
              onChangeText={setPrompt}
              placeholder={catalog.parentAvailable ? '继续向这个子代理发送…' : '父会话不可用，暂时无法继续。'}
              placeholderTextColor={colors.textDim}
              multiline
            />
            <TouchableOpacity
              style={[styles.primaryButton, (!canPrompt || prompt.trim() === '' || busy) && styles.disabled]}
              disabled={!canPrompt || prompt.trim() === '' || busy}
              onPress={() => void sendPrompt()}
            >
              <Text style={styles.primaryText}>发送</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, (!canInterrupt || busy) && styles.disabled]}
              disabled={!canInterrupt || busy}
              onPress={() => void interrupt()}
            >
              <Text style={styles.secondaryText}>打断</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    )
  }

  return (
    <ScrollView style={styles.listCard}>
      <Text style={styles.detailTitle}>子代理</Text>
      {!catalog.parentAvailable && (
        <Text style={styles.meta}>父会话当前不可用；列表仍可查看。</Text>
      )}
      {catalog.entries.length === 0 && <Text style={styles.meta}>没有子代理会话。</Text>}
      {catalog.entries.map(entry => (
        <TouchableOpacity key={entry.id} style={styles.entry} onPress={() => setSelected(entry)}>
          <View style={[styles.dot, { backgroundColor: statusColor(entry) }]} />
          <View style={styles.entryText}>
            <Text style={styles.entryTitle} numberOfLines={1}>{entryTitle(entry)}</Text>
            <Text style={styles.entryMeta} numberOfLines={1}>
              {statusText(entry)}
              {entry.kind === 'child' ? ` · ${entry.mode === 'continuable' ? '可续' : '一次性'}` : ''}
              {entry.kind === 'child' && entry.hasChildren ? ' · 有子级' : ''}
            </Text>
          </View>
          {entry.kind === 'child' && <Text style={styles.link}>查看</Text>}
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={[styles.secondaryButton, styles.closeButton]} onPress={onClose}>
        <Text style={styles.secondaryText}>关闭</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  listCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.card,
    marginHorizontal: spacing(5),
    marginVertical: spacing(12),
    padding: spacing(3),
    maxHeight: '80%',
  },
  detailCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.card,
    marginHorizontal: spacing(5),
    marginVertical: spacing(12),
    padding: spacing(3),
    maxHeight: '84%',
    gap: spacing(2),
  },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing(3) },
  detailTitle: { flex: 1, color: colors.text, fontSize: fontSize.body, fontWeight: '600' },
  detailMeta: { color: colors.textDim, fontSize: fontSize.tiny },
  meta: { color: colors.textDim, fontSize: fontSize.small },
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), paddingVertical: spacing(2) },
  entryText: { flex: 1 },
  entryTitle: { color: colors.text, fontSize: fontSize.small },
  entryMeta: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  linkRow: { alignItems: 'center', paddingVertical: spacing(2) },
  link: { color: colors.accent, fontSize: fontSize.small },
  history: { flex: 1, minHeight: 140 },
  historyContent: { gap: spacing(2), paddingBottom: spacing(2) },
  message: {
    alignSelf: 'stretch',
    backgroundColor: colors.bgBubbleAssistant,
    borderRadius: radius.card,
    padding: spacing(2.5),
  },
  messageUser: { backgroundColor: colors.bgBubbleUser },
  messageRole: { color: colors.textDim, fontSize: fontSize.tiny, marginBottom: spacing(1) },
  messageBody: { color: colors.text, fontSize: fontSize.small, lineHeight: 19 },
  promptRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing(2) },
  input: {
    flex: 1,
    maxHeight: 90,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    color: colors.text,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    fontSize: fontSize.small,
    backgroundColor: colors.bg,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.card,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  closeButton: { marginTop: spacing(2) },
  primaryText: { color: '#fff', fontSize: fontSize.small, fontWeight: '600' },
  secondaryText: { color: colors.textDim, fontSize: fontSize.small },
  error: { color: colors.danger, fontSize: fontSize.small },
  disabled: { opacity: 0.5 },
})
