/**
 * One conversation's trajectory — the Web's Trajectory view on a phone.
 *
 * The Web's own view is a table: records grouped by turn and step, a timeline
 * over them, an inspector beside them, and a toolbar to widen the call column.
 * A phone has room for none of that, so this is the same projection laid out as
 * a list — every turn as a section header, then that turn's records in log
 * order, each row opening onto its own body. It reads the same log fold the
 * transcript reads and changes nothing, and it deliberately has no composer:
 * a trajectory is for reading what happened, not for asking for more.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { FlatList, Platform, StyleSheet, Text, View } from 'react-native'
import {
  compactJson,
  deriveConversation,
  groupTurns,
  prettyJson,
  stepTokenUsage,
  type ConnectionManager,
  type ConversationItem,
  type Turn,
} from '@dsh-mobile/core'
import { useI18n, type TranslationKey } from '../i18n'
import { chat, colors, fontSize, spacing } from '../theme'
import { Icon } from '../icons'
import { TouchableOpacity } from '../components/Touchable'
import { formatTokenCount, runDurationLabel, toolDisplayName } from '../ui-labels'

/** A row's translator, narrowed to what the record builder needs. */
type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

interface TrajectoryRecord {
  /** The conversation item's own key, which is what the row's fold is held by. */
  key: string
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'compaction' | 'other'
  /** The left-hand chip: what this record is, in one or two characters. */
  badge: string
  title: string
  /** The right-hand reading: time, status, tokens. */
  meta: string
  body: string
  /** Only shown once the row is open — a tool's arguments, or its result. */
  detail?: string
  /** When the log recorded it; 0 when the record carries no clock. */
  time: number
  status?: 'running' | 'done' | 'error'
}

interface Props {
  manager: ConnectionManager
  sessionId: string
  onBack: () => void
}

/**
 * How long a body has to be before folding it away is worth a control. Short
 * records (most tool rows) read better flat, and the Web's own trajectory rows
 * are not folded either — only the ones a phone would otherwise lose to.
 */
const FOLDABLE_CHARS = 160

export function TrajectoryScreen({ manager, sessionId, onBack }: Props): React.JSX.Element {
  const { locale, t } = useI18n()
  const [turns, setTurns] = useState<Turn[]>([])
  const [title, setTitle] = useState('')
  const [open, setOpen] = useState<readonly string[]>([])

  /**
   * The log fold, re-read on the store's own throttle.
   *
   * The screen is a pure projection of what this client already holds — the
   * conversation it was opened from has read its tail — so it subscribes to
   * the same `changed` stream and derives again, exactly as the transcript
   * does, rather than asking the Host for a second copy.
   */
  useEffect(() => {
    let alive = true
    let pending = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const apply = (): void => {
      const session = manager.store.sessions.get(sessionId)
      if (session === undefined) {
        setTurns([])
        return
      }
      setTitle(manager.store.title(sessionId) ?? '')
      setTurns(groupTurns(deriveConversation(session, {
        // `running` is only a statement when the Host has said it: an unread
        // Session must not settle a turn that is still open.
        running: session.runningKnown ? session.running : undefined,
      })))
    }
    const off = manager.store.on('changed', ({ sessionId: changed }) => {
      if (changed !== undefined && changed !== sessionId) return
      if (pending) return
      pending = true
      timer = setTimeout(() => {
        timer = null
        pending = false
        if (alive) apply()
      }, 50)
    })
    apply()
    return () => {
      alive = false
      off()
      if (timer !== null) clearTimeout(timer)
    }
  }, [manager, sessionId])

  const rows = useMemo<Row[]>(() => {
    const next: Row[] = []
    turns.forEach((turn, index) => {
      next.push({ kind: 'turn', key: `turn:${turn.key}`, turn, ordinal: index + 1 })
      for (const record of recordsOf(turn, t)) next.push({ kind: 'record', key: record.key, record })
    })
    return next
  }, [turns, t])

  const toggle = (key: string): void => {
    setOpen(current => current.includes(key)
      ? current.filter(entry => entry !== key)
      : [...current, key])
  }
  const opened = useMemo(() => new Set(open), [open])

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.back}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('chat.back')}
        >
          <Icon name="ChevronLeftOutline" size={22} color={colors.accent} />
          <Text style={styles.backLabel}>{t('chat.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{t('chat.trajectory')}</Text>
      </View>
      {title !== '' && <Text style={styles.sessionTitle} numberOfLines={1}>{title}</Text>}
      <FlatList
        data={rows}
        keyExtractor={row => row.key}
        contentContainerStyle={styles.content}
        style={styles.list}
        ListEmptyComponent={(
          <Text style={styles.empty}>{t('trajectory.empty')}</Text>
        )}
        renderItem={({ item }) => item.kind === 'turn'
          ? <TurnHeader turn={item.turn} ordinal={item.ordinal} t={t} />
          : (
            <RecordRow
              record={item.record}
              open={opened.has(item.key)}
              locale={locale}
              t={t}
              onToggle={toggle}
            />
          )}
      />
    </View>
  )
}

type Row =
  | { kind: 'turn'; key: string; turn: Turn; ordinal: number }
  | { kind: 'record'; key: string; record: TrajectoryRecord }

/**
 * The turn's own boundary row.
 *
 * The Web marks the same boundary with a group header carrying the turn's
 * status, its recorded duration and its accounting; the phone folds those into
 * one line, because a section header that wraps eats the records under it.
 */
function TurnHeader({ turn, ordinal, t }: {
  turn: Turn
  ordinal: number
  t: Translate
}): React.JSX.Element {
  const status = turn.live || turn.running
    ? t('trajectory.status.running')
    : turn.endReason === 'aborted'
      ? t('trajectory.status.stopped')
      : turn.endReason === 'error' || turn.endReason === 'max-tokens'
        ? t('trajectory.status.failed')
        : t('trajectory.status.done')
  // The Web floors a measured turn at one second, so a turn that resolved
  // within the same second reads `用时 1秒`, never `用时 0秒`.
  const duration = turn.durationMs === undefined
    ? undefined
    : runDurationLabel(Math.max(1_000, turn.durationMs), t)
  const facts = [
    status,
    ...(duration === undefined ? [] : [t('chat.turn.took', { duration })]),
    ...(turn.toolCallCount === 0 ? [] : [t('trajectory.calls', { count: turn.toolCallCount })]),
  ]
  return (
    <View style={styles.turnHeader}>
      <Text style={styles.turnLabel}>{t('trajectory.turn', { turn: ordinal })}</Text>
      <Text style={styles.turnFacts} numberOfLines={1}>{facts.join(t('chat.step.separator'))}</Text>
    </View>
  )
}

/**
 * One record, folded to a single line by default.
 *
 * The chip names the record's kind, the title is what the conversation calls
 * it (a tool's own display name, a prompt's first line), and the body holds the
 * text the reader came for. Tap opens the rest.
 */
function RecordRow({ record, open, locale, t, onToggle }: {
  record: TrajectoryRecord
  open: boolean
  locale: string
  t: Translate
  onToggle: (key: string) => void
}): React.JSX.Element {
  const foldable = record.detail !== undefined
    || record.body.includes('\n')
    || record.body.length > FOLDABLE_CHARS
  const time = record.time === 0 ? '' : new Date(record.time).toLocaleTimeString(locale, { hour12: false })
  const meta = [record.meta, time].filter(part => part !== '').join(t('chat.step.separator'))
  return (
    <TouchableOpacity
      style={styles.record}
      disabled={!foldable}
      onPress={() => onToggle(record.key)}
      accessibilityRole={foldable ? 'button' : undefined}
      accessibilityLabel={foldable ? t('trajectory.detail') : undefined}
    >
      <View style={styles.recordHead}>
        <Text style={styles.badge} numberOfLines={1}>{record.badge}</Text>
        <Text style={styles.recordTitle} numberOfLines={1}>{record.title}</Text>
        {record.status !== undefined && <StatusDot status={record.status} />}
        <Text style={styles.recordMeta} numberOfLines={1}>{meta}</Text>
        {foldable && (
          <Icon
            name={open ? 'ChevronUpOutline' : 'ChevronDownOutline'}
            size={12}
            color={chat.labelTertiary}
          />
        )}
      </View>
      {record.body !== '' && (
        <Text style={styles.recordBody} numberOfLines={open ? undefined : 1}>{record.body}</Text>
      )}
      {open && record.detail !== undefined && (
        <Text style={styles.recordDetail} selectable>{record.detail}</Text>
      )}
    </TouchableOpacity>
  )
}

/** The Web's record status: a coloured dot, not a second word. */
function StatusDot({ status }: { status: 'running' | 'done' | 'error' }): React.JSX.Element {
  const color = status === 'running' ? colors.running : status === 'error' ? colors.danger : colors.success
  return <View style={[styles.statusDot, { backgroundColor: color }]} />
}

/**
 * One turn's records, in the order the log recorded them.
 *
 * Taken from the turn's whole membership rather than from what the transcript
 * renders: a tool call and a reasoning block have no row of their own in Chat,
 * and hiding them is exactly what a trajectory is for.
 */
function recordsOf(turn: Turn, t: Translate): TrajectoryRecord[] {
  const records: TrajectoryRecord[] = []
  for (const item of turn.items) records.push(...recordsFor(item, t))
  return records
}

/**
 * One item's contribution to the list — an array, because one log line can be
 * two records: a step records its reasoning and the answer it produced under a
 * single `assistant/message`, and the Web's own view lists them as separate
 * rows (思考 and 助手). Turn boundaries carry the section header instead, and
 * record nothing of their own.
 */
function recordsFor(item: ConversationItem, t: Translate): TrajectoryRecord[] {
  switch (item.kind) {
    case 'user':
      return [{
        key: item.key,
        kind: 'user',
        badge: t('trajectory.kind.user'),
        title: firstLine(item.text) || t('trajectory.kind.user'),
        meta: item.images.length === 0 ? '' : t('trajectory.images', { count: item.images.length }),
        body: item.text,
        time: item.time,
      }]
    case 'assistant': {
      const records: TrajectoryRecord[] = []
      if (item.reasoning.trim() !== '') {
        records.push({
          key: `${item.key}:reasoning`,
          kind: 'thinking',
          badge: t('trajectory.kind.thinking'),
          title: t('trajectory.kind.thinking'),
          meta: '',
          body: item.reasoning,
          time: item.time,
        })
      }
      if (item.text.trim() !== '') records.push(assistantRecord(item.key, item.text, item, t))
      return records
    }
    case 'stream':
      // The answer still arriving: the same record, wearing the live turn's
      // own state, and replaced by the `assistant` line when the step lands.
      return item.text.trim() === ''
        ? []
        : [assistantRecord(item.key, item.text, undefined, t, true)]
    case 'tool': {
      const result = item.resultText.trim()
      const args = item.args.trim()
      const detail = [
        ...(args === '' ? [] : [`${t('trajectory.args')}\n${compactJson(item.args, 4_000)}`]),
        ...(result === '' ? [] : [`${t('trajectory.result')}\n${result}`]),
      ].join('\n\n')
      return [{
        key: item.key,
        kind: 'tool',
        badge: t('trajectory.kind.tool'),
        title: toolDisplayName(item.name, t),
        meta: `${toolStatusLabel(item.status, t)}${item.subCalls.length === 0 ? '' : t('chat.step.separator') + t('trajectory.calls', { count: item.subCalls.length })}`,
        status: item.status === 'running' ? 'running' : item.status === 'error' ? 'error' : 'done',
        body: result !== '' ? result : item.resultPreview,
        ...(detail === '' ? {} : { detail }),
        time: item.time,
      }]
    }
    case 'preparing':
      return [{
        key: item.key,
        kind: 'other',
        badge: t('trajectory.kind.preparing'),
        title: toolDisplayName(item.name, t),
        meta: t('trajectory.status.running'),
        status: 'running',
        body: '',
        time: item.time,
      }]
    case 'compaction':
      return [{
        key: item.key,
        kind: 'compaction',
        badge: t('trajectory.kind.compaction'),
        title: t('trajectory.kind.compaction'),
        meta: '',
        body: item.summary,
        time: item.time,
      }]
    case 'unknown':
      // The Web's own "no renderer for this" row: what arrived, verbatim.
      return [{
        key: item.key,
        kind: 'other',
        badge: t('common.unknown'),
        title: item.eventType,
        meta: '',
        body: compactJson(item.data, 160),
        detail: prettyJson(item.data),
        time: item.time,
      }]
    case 'delivery':
      return [{
        key: item.key,
        kind: 'other',
        badge: t('trajectory.kind.tool'),
        title: t('trajectory.delivered', { count: item.files.length }),
        meta: '',
        body: item.files.map(file => file.path).join('\n'),
        time: item.time,
      }]
    default:
      return []
  }
}

/** One answer — a step's own text, or the stream carrying it before it lands. */
function assistantRecord(
  key: string,
  text: string,
  item: Extract<ConversationItem, { kind: 'assistant' }> | undefined,
  t: Translate,
  running = false,
): TrajectoryRecord {
  const usage = item?.usage === undefined ? null : stepTokenUsage(item.usage)
  const meta = [
    ...(usage === null ? [] : [t('message.turnUsage.consumed', { total: formatTokenCount(usage.totalTokens) })]),
    ...(item?.interrupted === true ? [t('chat.interrupted')] : []),
  ].join(t('chat.step.separator'))
  return {
    key,
    kind: 'assistant',
    badge: t('trajectory.kind.assistant'),
    title: running ? t('trajectory.status.running') : t('trajectory.kind.assistant'),
    meta,
    status: running ? 'running' : 'done',
    body: text,
    time: item?.time ?? 0,
  }
}

function toolStatusLabel(status: 'running' | 'done' | 'error', t: Translate): string {
  return status === 'running'
    ? t('trajectory.status.running')
    : status === 'error' ? t('trajectory.status.failed') : t('trajectory.status.done')
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: chat.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.5),
    gap: spacing(2),
  },
  back: { flexDirection: 'row', alignItems: 'center', minWidth: 88, gap: 2 },
  backLabel: { color: colors.accent, fontSize: fontSize.body },
  title: { flex: 1, color: colors.text, fontSize: fontSize.body, fontWeight: '600', textAlign: 'center' },
  sessionTitle: {
    paddingHorizontal: spacing(4),
    paddingBottom: spacing(2),
    color: chat.labelTertiary,
    fontSize: fontSize.tiny,
  },
  list: { flex: 1 },
  content: { paddingHorizontal: spacing(4), paddingBottom: spacing(6) },
  empty: { color: colors.textDim, fontSize: fontSize.small, paddingVertical: spacing(6), textAlign: 'center' },
  turnHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing(2),
    marginTop: spacing(4),
    marginBottom: spacing(1.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chat.borderL2,
    paddingBottom: spacing(1.5),
  },
  turnLabel: { color: chat.labelPrimary, fontSize: fontSize.small, fontWeight: '600' },
  turnFacts: { flexShrink: 1, color: chat.labelTertiary, fontSize: fontSize.tiny },
  record: { paddingVertical: spacing(1.5) },
  recordHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  badge: {
    width: 34,
    color: chat.labelTertiary,
    fontSize: fontSize.tiny,
  },
  recordTitle: { flexShrink: 1, color: chat.labelPrimary, fontSize: fontSize.small },
  recordMeta: { marginLeft: 'auto', flexShrink: 1, color: chat.labelTertiary, fontSize: fontSize.tiny },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  recordBody: {
    marginLeft: 34 + spacing(1.5),
    marginTop: spacing(0.5),
    color: chat.labelSecondary,
    fontSize: fontSize.tiny,
    lineHeight: fontSize.tiny + 6,
  },
  recordDetail: {
    marginLeft: 34 + spacing(1.5),
    marginTop: spacing(1),
    paddingTop: spacing(1),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chat.borderL1,
    color: chat.labelSecondary,
    fontFamily: mono,
    fontSize: fontSize.tiny,
    lineHeight: fontSize.tiny + 6,
  },
})
