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
import { deriveConversation, type ConnectionManager, type ConversationItem } from '@dsh-mobile/core'
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
  const listRef = useRef<FlatList<ConversationItem>>(null)

  const refresh = useCallback(() => {
    const session = manager.store.sessions.get(sessionId)
    if (session === undefined) return
    setItems(deriveConversation(session))
    setRunning(session.running)
  }, [manager, sessionId])

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
    // Hermes may report a non-IANA zone (host validates strictly); omit then.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const clientTimeZone = typeof tz === 'string' && (tz === 'UTC' || tz.includes('/')) ? tz : undefined
    if (clientTimeZone === undefined) console.warn('[prompt] non-IANA timeZone omitted:', tz)
    const result = await client.sessions.prompt({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
      clientTimeZone,
    } as never)
    if (!result.result.ok) setDraft(text) // put the draft back on failure
  }

  const cancel = async (): Promise<void> => {
    await manager.client?.sessions.cancel({ sessionId } as never).catch(() => undefined)
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
      {(approvals.length > 0 || questions.length > 0) && (
        <ActionBar manager={manager} sessionId={sessionId} />
      )}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="发消息…"
          placeholderTextColor={colors.textDim}
          multiline
        />
        {running ? (
          <TouchableOpacity style={[styles.sendButton, { backgroundColor: colors.danger }]} onPress={() => void cancel()}>
            <Text style={styles.sendText}>停止</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendButton, draft.trim() === '' && styles.disabled]}
            disabled={draft.trim() === ''}
            onPress={() => void send()}
          >
            <Text style={styles.sendText}>发送</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  )
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
})
