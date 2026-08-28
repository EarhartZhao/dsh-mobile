/**
 * Conversation screen: history tail + live stream (throttled re-render),
 * prompt input, cancel, and the bottom action bar for approvals/questions.
 * Chunks never set state directly — the store batches and the 50ms throttle
 * bounds render frequency regardless of chunk rate (docs/01 移植策略).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { deriveConversation, placementLabel, queuePreview, type ConnectionManager, type ConversationItem } from '@dsh-mobile/core'
import type { JobView, QueuedInboxItem } from '@dsh-mobile/protocol'
import { colors, fontSize, radius, spacing } from '../theme'

interface Props {
  manager: ConnectionManager
  sessionId: string
  onBack: () => void
}

export function ChatScreen({ manager, sessionId, onBack }: Props): React.JSX.Element {
  const [items, setItems] = useState<ConversationItem[]>([])
  const [draft, setDraft] = useState('')
  const [running, setRunning] = useState(false)
  const [queue, setQueue] = useState<QueuedInboxItem[]>([])
  const [jobs, setJobs] = useState<JobView[]>([])
  const [jobsOpen, setJobsOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<{ id: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<FlatList<ConversationItem>>(null)

  const refresh = useCallback(() => {
    const session = manager.store.sessions.get(sessionId)
    if (session === undefined) return
    setItems(deriveConversation(session))
    setRunning(session.running)
    setQueue([...session.queue])
    setJobs([...session.jobs])
  }, [manager, sessionId])

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])

  useEffect(() => {
    // Baseline: tail page (with projections watermark), then live frames take over.
    const client = manager.client
    if (client !== null) {
      void client.sessions.history({ sessionId } as never).then(result => {
        if (result.result.ok) {
          manager.store.applyHistory(
            sessionId,
            result.result.value.events,
            result.result.value.projections ?? undefined,
          )
        }
      }).catch(() => undefined)
    }
    let pending = false
    const off = manager.store.on('changed', ({ sessionId: changed }) => {
      if (changed !== undefined && changed !== sessionId) return
      if (pending) return
      pending = true
      setTimeout(() => {
        pending = false
        refresh()
      }, 50)
    })
    refresh()
    return off
  }, [manager, sessionId, refresh])

  const send = async (): Promise<void> => {
    const client = manager.client
    const text = draft.trim()
    if (client === null || text === '') return
    setDraft('')
    // Edit mode: rewrite the queued item in place instead of a new prompt.
    if (editingItem !== null) {
      const editResult = await client.sessions.updateQueue({
        sessionId,
        itemId: editingItem.id,
        action: { kind: 'edit', content: [{ type: 'text', text }] },
      } as never)
      if (!editResult.result.ok) setDraft(text)
      else setEditingItem(null)
      return
    }
    // Hermes may report a non-IANA zone (host validates strictly); omit then.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const clientTimeZone = typeof tz === 'string' && (tz === 'UTC' || tz.includes('/')) ? tz : undefined
    if (clientTimeZone === undefined) console.warn('[prompt] non-IANA timeZone omitted:', tz)
    const result = await client.sessions.prompt({
      sessionId,
      // Always queue: while a turn runs the message parks in the inbox FIFO
      // (dock below); explicit steering is the dock's 引导 action.
      mode: 'queue',
      content: [{ type: 'text', text }],
      clientTimeZone,
    } as never)
    if (!result.result.ok) {
      setDraft(text) // put the draft back on failure
      showNotice(`发送失败：${result.result.error.message}`)
      return
    }
    // Slash commands report their result in the command slot.
    const command = result.result.value.command
    if (command?.text !== undefined && command.text !== '') showNotice(command.text)
  }

  const cancel = async (): Promise<void> => {
    await manager.client?.sessions.cancel({ sessionId } as never).catch(() => undefined)
  }

  const queueAction = async (itemId: string, action: 'remove' | 'steer'): Promise<void> => {
    await manager.client?.sessions.updateQueue({ sessionId, itemId, action: { kind: action } } as never)
      .catch(() => undefined)
  }

  const startEdit = (item: QueuedInboxItem): void => {
    setEditingItem({ id: item.id })
    setDraft(queuePreview(item))
  }

  const session = manager.store.sessions.get(sessionId)
  const approvals = [...(session?.pendingApprovals.values() ?? [])]
  const questions = [...(session?.pendingQuestions.values() ?? [])]
  const title = manager.store.title(sessionId) ?? '会话'

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ 返回</Text></TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={styles.back} />
      </View>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={item => item.key}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => <Bubble item={item} />}
      />
      {notice !== null && (
        <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View>
      )}
      {jobs.length > 0 && (
        <JobsStrip jobs={jobs} open={jobsOpen} onToggle={() => setJobsOpen(o => !o)} />
      )}
      {queue.length > 0 && (
        <QueueDock
          queue={queue}
          editingId={editingItem?.id ?? null}
          onEdit={startEdit}
          onRemove={id => void queueAction(id, 'remove')}
          onSteer={id => void queueAction(id, 'steer')}
        />
      )}
      {(approvals.length > 0 || questions.length > 0) && (
        <ActionBar manager={manager} sessionId={sessionId} />
      )}
      <View style={styles.composer}>
        {editingItem !== null && (
          <TouchableOpacity style={styles.editCancel} onPress={() => { setEditingItem(null); setDraft('') }}>
            <Text style={styles.editCancelText}>✕</Text>
          </TouchableOpacity>
        )}
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={editingItem !== null ? '编辑排队消息…' : running ? '排队新消息…' : '发消息…'}
          placeholderTextColor={colors.textDim}
          multiline
        />
        {running ? (
          <View style={styles.runningButtons}>
            <TouchableOpacity style={[styles.sendButton, { backgroundColor: colors.danger }]} onPress={() => void cancel()}>
              <Text style={styles.sendText}>停止</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendButton, draft.trim() === '' && editingItem === null && styles.disabled]}
              disabled={draft.trim() === '' && editingItem === null}
              onPress={() => void send()}
            >
              <Text style={styles.sendText}>{editingItem !== null ? '保存' : '排队'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.sendButton, draft.trim() === '' && editingItem === null && styles.disabled]}
            disabled={draft.trim() === '' && editingItem === null}
            onPress={() => void send()}
          >
            <Text style={styles.sendText}>{editingItem !== null ? '保存' : '发送'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

function QueueDock({ queue, editingId, onEdit, onRemove, onSteer }: {
  queue: QueuedInboxItem[]
  editingId: string | null
  onEdit: (item: QueuedInboxItem) => void
  onRemove: (id: string) => void
  onSteer: (id: string) => void
}): React.JSX.Element {
  return (
    <View style={styles.dock}>
      <Text style={styles.dockTitle}>队列 · {queue.length}</Text>
      {queue.map(item => (
        <View key={item.id} style={styles.dockRow}>
          <View style={styles.dockBadge}><Text style={styles.dockBadgeText}>{placementLabel(item.placement)}</Text></View>
          <Text style={styles.dockPreview} numberOfLines={1}>{queuePreview(item)}</Text>
          <TouchableOpacity onPress={() => onEdit(item)} disabled={editingId === item.id}>
            <Text style={[styles.dockAction, editingId === item.id && { color: colors.textDim }]}>编辑</Text>
          </TouchableOpacity>
          {item.placement === 'queued' && (
            <TouchableOpacity onPress={() => onSteer(item.id)}>
              <Text style={styles.dockAction}>引导</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => onRemove(item.id)}>
            <Text style={[styles.dockAction, { color: colors.danger }]}>删除</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  )
}

function JobsStrip({ jobs, open, onToggle }: {
  jobs: JobView[]
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const live = jobs.filter(j => j.status === 'running' || j.status === 'stopping').length
  return (
    <View style={styles.jobs}>
      <TouchableOpacity style={styles.jobsHeader} onPress={onToggle}>
        <Text style={styles.jobsTitle}>任务 · {jobs.length}{live > 0 ? `（${live} 运行中）` : ''}</Text>
        <Text style={styles.jobsChevron}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open && jobs.map(job => (
        <View key={job.id} style={styles.jobRow}>
          <View style={[styles.jobDot, { backgroundColor: jobStatusColor(job.status) }]} />
          <View style={styles.jobText}>
            <Text style={styles.jobLabel} numberOfLines={1}>{job.label}</Text>
            <Text style={styles.jobMeta}>
              {job.kind} · {jobStatusLabel(job.status)}{job.detail !== undefined && job.detail !== '' ? ` · ${job.detail}` : ''}
            </Text>
          </View>
        </View>
      ))}
    </View>
  )
}

function jobStatusColor(status: JobView['status']): string {
  switch (status) {
    case 'running': return colors.running
    case 'stopping': return colors.warning
    case 'completed': return colors.success
    case 'failed': return colors.danger
    case 'killed': return colors.textDim
  }
}

function jobStatusLabel(status: JobView['status']): string {
  switch (status) {
    case 'running': return '运行中'
    case 'stopping': return '停止中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    case 'killed': return '已终止'
  }
}

function Bubble({ item }: { item: ConversationItem }): React.JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <View style={[styles.bubble, styles.bubbleUser]}>
          <Text style={styles.bubbleText}>{item.text}</Text>
        </View>
      )
    case 'assistant':
    case 'stream':
      return (
        <View style={[styles.bubble, styles.bubbleAssistant]}>
          {item.reasoning !== '' && <Text style={styles.reasoning}>{item.reasoning}</Text>}
          <Text style={styles.bubbleText}>
            {item.text}
            {item.kind === 'stream' && <Text style={styles.cursor}>▍</Text>}
            {item.kind === 'assistant' && item.interrupted && <Text style={styles.interrupted}>（已中断）</Text>}
          </Text>
        </View>
      )
    case 'tool':
      return <ToolCard item={item} />
  }
}

function ToolCard({ item }: { item: ConversationItem & { kind: 'tool' } }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const statusColor = item.status === 'running' ? colors.running : item.status === 'error' ? colors.danger : colors.success
  const statusText = item.status === 'running' ? '执行中' : item.status === 'error' ? '失败' : '完成'
  return (
    <TouchableOpacity style={styles.toolCard} onPress={() => setOpen(o => !o)} activeOpacity={0.8}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolName}>{item.name}</Text>
        <Text style={[styles.toolStatus, { color: statusColor }]}>{statusText} {open ? '▾' : '▸'}</Text>
      </View>
      {open && (
        <View>
          {item.args !== '' && <Text style={styles.toolBody}>{item.args}</Text>}
          {item.resultPreview !== '' && <Text style={styles.toolBody}>{item.resultPreview}</Text>}
        </View>
      )}
    </TouchableOpacity>
  )
}

function ActionBar({ manager, sessionId }: { manager: ConnectionManager; sessionId: string }): React.JSX.Element {
  const session = manager.store.sessions.get(sessionId)
  const approvals = [...(session?.pendingApprovals.values() ?? [])]
  const questions = [...(session?.pendingQuestions.values() ?? [])]
  const [selected, setSelected] = useState<Record<string, string>>({})

  const answerApproval = async (rpcId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> => {
    await manager.client?.respond({
      type: 'client-response',
      rpcId: rpcId as never,
      result: { ok: true, value: { sessionId, approvalId, outcome } },
    }).catch(() => undefined)
  }

  const answerQuestion = async (rpcId: string, items: { id: string }[]): Promise<void> => {
    const answers = items.map(q => ({ id: q.id, selected: selected[q.id] === undefined ? [] : [selected[q.id]] }))
    await manager.client?.respond({
      type: 'client-response',
      rpcId: rpcId as never,
      result: { ok: true, value: { sessionId, answer: { answers } } },
    }).catch(() => undefined)
  }

  return (
    <View style={styles.actionBar}>
      {approvals.map(approval => (
        <View key={approval.approvalId} style={styles.actionRow}>
          <Text style={styles.actionText} numberOfLines={2}>
            审批：{approval.toolName}{approval.reason !== undefined && approval.reason !== '' ? `（${approval.reason}）` : ''}
          </Text>
          <View style={styles.actionButtons}>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.success }]}
              onPress={() => void answerApproval(approval.rpcId, approval.approvalId, 'allowed-once')}>
              <Text style={styles.actionButtonText}>允许</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.danger }]}
              onPress={() => void answerApproval(approval.rpcId, approval.approvalId, 'rejected')}>
              <Text style={styles.actionButtonText}>拒绝</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
      {questions.map(question => {
        const items = question.questions as { id: string; question: string; options?: { label: string }[] }[]
        return (
          <View key={question.rpcId} style={styles.actionRow}>
            {items.map(q => (
              <View key={q.id}>
                <Text style={styles.actionText}>{q.question}</Text>
                <View style={styles.chips}>
                  {(q.options ?? []).map(option => (
                    <TouchableOpacity
                      key={option.label}
                      style={[styles.chip, selected[q.id] === option.label && styles.chipActive]}
                      onPress={() => setSelected(s => ({ ...s, [q.id]: option.label }))}
                    >
                      <Text style={styles.chipText}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.accent }]}
              onPress={() => void answerQuestion(question.rpcId, items)}>
              <Text style={styles.actionButtonText}>提交回答</Text>
            </TouchableOpacity>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing(2),
  },
  back: { color: colors.accent, fontSize: fontSize.body, width: 56 },
  headerTitle: { flex: 1, color: colors.text, fontSize: fontSize.body, fontWeight: '600', textAlign: 'center' },
  listContent: { padding: spacing(3), gap: spacing(2) },
  bubble: { maxWidth: '88%', borderRadius: radius.bubble, padding: spacing(3) },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.bgBubbleUser },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: colors.bgBubbleAssistant },
  bubbleText: { color: colors.text, fontSize: fontSize.body, lineHeight: 22 },
  reasoning: { color: colors.textDim, fontSize: fontSize.small, fontStyle: 'italic', marginBottom: spacing(1) },
  cursor: { color: colors.accent },
  interrupted: { color: colors.warning, fontSize: fontSize.small },
  toolCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing(2.5),
  },
  toolHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toolName: { color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
  toolStatus: { fontSize: fontSize.tiny },
  toolBody: { color: colors.textDim, fontSize: fontSize.tiny, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: spacing(2) },
  actionBar: {
    borderTopWidth: 1,
    borderTopColor: colors.warning,
    backgroundColor: colors.bgElevated,
    padding: spacing(3),
    gap: spacing(2),
  },
  actionRow: { gap: spacing(2) },
  actionText: { color: colors.text, fontSize: fontSize.small },
  actionButtons: { flexDirection: 'row', gap: spacing(2) },
  actionButton: { borderRadius: radius.card, paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
  actionButtonText: { color: '#fff', fontSize: fontSize.small, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1.5),
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.bgBubbleUser },
  chipText: { color: colors.text, fontSize: fontSize.small },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing(3),
    gap: spacing(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.bubble,
    color: colors.text,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    fontSize: fontSize.body,
    backgroundColor: colors.bgElevated,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.bubble,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2.5),
  },
  disabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontSize: fontSize.body, fontWeight: '600' },
  runningButtons: { flexDirection: 'column', gap: spacing(1.5) },
  editCancel: { alignSelf: 'center', padding: spacing(1) },
  editCancelText: { color: colors.textDim, fontSize: fontSize.body },
  notice: {
    marginHorizontal: spacing(3),
    marginBottom: spacing(2),
    backgroundColor: colors.bgBubbleUser,
    borderRadius: radius.card,
    padding: spacing(2.5),
  },
  noticeText: { color: colors.text, fontSize: fontSize.small },
  dock: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    gap: spacing(1.5),
  },
  dockTitle: { color: colors.textDim, fontSize: fontSize.tiny },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  dockBadge: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing(1.5),
    paddingVertical: 1,
  },
  dockBadgeText: { color: colors.textDim, fontSize: fontSize.tiny },
  dockPreview: { flex: 1, color: colors.text, fontSize: fontSize.small },
  dockAction: { color: colors.accent, fontSize: fontSize.small, paddingHorizontal: spacing(1) },
  jobs: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  jobsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobsTitle: { color: colors.textDim, fontSize: fontSize.tiny },
  jobsChevron: { color: colors.textDim, fontSize: fontSize.small },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginTop: spacing(2) },
  jobDot: { width: 8, height: 8, borderRadius: 4 },
  jobText: { flex: 1 },
  jobLabel: { color: colors.text, fontSize: fontSize.small },
  jobMeta: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: 1 },
})
