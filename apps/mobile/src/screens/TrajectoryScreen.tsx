/**
 * One conversation's trajectory — the Web's Trajectory view on a phone.
 *
 * The Web's own view is a table: records grouped by turn and then by message
 * and step, a timeline over them, an inspector beside them, and a toolbar to
 * widen the call column. A phone has room for none of the chrome, so this is
 * the same projection laid out as a list — every turn a section header, the
 * turn's preamble under a 「消息」 group, then one group per step, in log order,
 * each record opening onto its own body. It reads the same log fold the
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
  type ToolSubCall,
  type Turn,
} from '@dsh-mobile/core'
import { useI18n, type TranslationKey } from '../i18n'
import { chat, colors, fontSize, spacing } from '../theme'
import { Icon } from '../icons'
import { TouchableOpacity } from '../components/Touchable'
import { formatTokenCount, runDurationLabel, toolDisplayName } from '../ui-labels'

/** A row's translator, narrowed to what the record builder needs. */
type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

/** One labelled block inside a record's expanded body (a tool's parameters, its schema, …). */
interface TrajectorySection {
  label: string
  text: string
}

/** One step's billed buckets, laid out as the Web's three metric columns. */
interface TrajectoryMetrics {
  input?: number
  output?: number
  think?: number
}

/** Everything a record carries before {@link project} has placed it in the list. */
interface RawRecord {
  /** The conversation item's own key, which is what the row's fold is held by. */
  key: string
  kind: 'system' | 'user' | 'context' | 'assistant' | 'thinking' | 'tool' | 'subtool' | 'compacted' | 'delivery' | 'other'
  /** The left-hand chip: what this record is, in one or two characters. */
  badge: string
  title: string
  /** The right-hand reading: status, token columns, clock. */
  meta: string
  /** The one-line body shown while collapsed. */
  preview: string
  /** The full body, shown once the row is open. */
  body?: string
  /** Extra labelled blocks, shown once the row is open. */
  sections: TrajectorySection[]
  /** Nested calls a tool row owns (the Web's 子工具 rows). */
  children: RawRecord[]
  /** The Web's three message columns; only assistant rows carry them. */
  metrics?: TrajectoryMetrics
  status?: 'running' | 'done' | 'error'
  /** When the log recorded it; 0 when the record carries no clock. */
  time: number
  /** When the work itself began, when the log recorded it apart from `time`. */
  startedAt?: number
  /** When the work finished, when that is later than `time`. */
  endedAt?: number
}

/** A record placed in the list: its 1-based `#N`, and children placed with it. */
interface TrajectoryRecord extends Omit<RawRecord, 'children'> {
  index: number
  children: TrajectoryRecord[]
}

/** One 「消息」/「第 N 步」/「压缩 N」 section inside a turn. */
interface TrajectoryGroup {
  key: string
  title: string
  /** The group's own wall span, when its records recorded one. */
  description?: string
  records: TrajectoryRecord[]
}

interface TrajectoryTurn {
  key: string
  ordinal: number
  turn: Turn
  groups: TrajectoryGroup[]
}

interface Props {
  manager: ConnectionManager
  sessionId: string
  onBack: () => void
}

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

  const model = useMemo<TrajectoryTurn[]>(() => project(turns, t), [turns, t])

  const rows = useMemo<Row[]>(() => {
    const next: Row[] = []
    for (const turn of model) {
      next.push({ kind: 'turn', key: `turn:${turn.key}`, turn: turn.turn, ordinal: turn.ordinal })
      for (const group of turn.groups) {
        next.push({ kind: 'group', key: `group:${turn.key}:${group.key}`, group })
        for (const record of group.records) {
          next.push({ kind: 'record', key: `${turn.key}:${record.key}`, record, depth: 0 })
        }
      }
    }
    return next
  }, [model])

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
          : item.kind === 'group'
            ? <GroupHeader group={item.group} />
            : (
              <RecordRow
                record={item.record}
                depth={item.depth}
                open={opened.has(item.record.key)}
                opened={opened}
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
  | { kind: 'group'; key: string; group: TrajectoryGroup }
  | { kind: 'record'; key: string; record: TrajectoryRecord; depth: number }

/**
 * The turn's own boundary row.
 *
 * The Web marks the same boundary with a sticky header carrying the turn's
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

/** The Web's 「消息」/「第 N 步」/「压缩 N」 section marker inside a turn. */
function GroupHeader({ group }: { group: TrajectoryGroup }): React.JSX.Element {
  return (
    <View style={styles.groupHeader}>
      <Text style={styles.groupTitle}>{group.title}</Text>
      {group.description !== undefined && group.description !== '' && (
        <Text style={styles.groupDescription} numberOfLines={1}>{group.description}</Text>
      )}
    </View>
  )
}

/**
 * One record, folded to a single line by default.
 *
 * The chip names the record's kind, the title is what the conversation calls
 * it (a tool's own display name, a prompt's first line), and the body holds the
 * text the reader came for. Tap opens the rest: the full body, the labelled
 * blocks (a tool's arguments, its result, the schema the model was shown) and
 * any nested sub-tool rows.
 */
function RecordRow({ record, depth, open, opened, locale, t, onToggle }: {
  record: TrajectoryRecord
  depth: number
  open: boolean
  opened: ReadonlySet<string>
  locale: string
  t: Translate
  onToggle: (key: string) => void
}): React.JSX.Element {
  const hasBody = record.body !== undefined && record.body !== record.preview
  const foldable = hasBody || record.sections.length > 0 || record.children.length > 0
  const time = record.time === 0 ? '' : new Date(record.time).toLocaleTimeString(locale, { hour12: false })
  const meta = [record.meta, time].filter(part => part !== '').join(t('chat.step.separator'))
  const indent = 34 + spacing(1.5) + depth * spacing(3)
  return (
    <View style={[styles.record, depth > 0 && styles.recordNested]}>
      <TouchableOpacity
        style={styles.recordPress}
        disabled={!foldable}
        onPress={() => onToggle(record.key)}
        accessibilityRole={foldable ? 'button' : undefined}
        accessibilityLabel={foldable ? t('trajectory.detail') : undefined}
      >
        <View style={styles.recordHead}>
          <Text style={styles.index} numberOfLines={1}>#{record.index}</Text>
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
        {record.metrics !== undefined && <MetricsRow metrics={record.metrics} t={t} indent={indent} />}
        {record.preview !== '' && (
          <Text
            style={[styles.recordBody, { marginLeft: indent }, depth > 0 && styles.recordBodyNested]}
            numberOfLines={open ? undefined : 1}
          >
            {open ? (record.body ?? record.preview) : record.preview}
          </Text>
        )}
        {open && record.sections.map(section => (
          <View key={section.label} style={[styles.section, { marginLeft: indent }]}>
            <Text style={styles.sectionLabel}>{section.label}</Text>
            <Text style={styles.sectionBody} selectable>{section.text}</Text>
          </View>
        ))}
      </TouchableOpacity>
      {open && record.children.map(child => (
        <RecordRow
          key={child.key}
          record={child}
          depth={depth + 1}
          open={opened.has(child.key)}
          opened={opened}
          locale={locale}
          t={t}
          onToggle={onToggle}
        />
      ))}
    </View>
  )
}

/** The Web's three message columns: 输入 / 输出 / 思考, in the order it prints them. */
function MetricsRow({ metrics, t, indent }: {
  metrics: TrajectoryMetrics
  t: Translate
  indent: number
}): React.JSX.Element {
  const cells = [
    ...(metrics.input === undefined ? [] : [t('trajectory.metric.input', { value: formatTokenCount(metrics.input) })]),
    ...(metrics.output === undefined ? [] : [t('trajectory.metric.output', { value: formatTokenCount(metrics.output) })]),
    ...(metrics.think === undefined ? [] : [t('trajectory.metric.think', { value: formatTokenCount(metrics.think) })]),
  ]
  if (cells.length === 0) return <View />
  return (
    <View style={[styles.metrics, { marginLeft: indent }]}>
      {cells.map(cell => <Text key={cell} style={styles.metric}>{cell}</Text>)}
    </View>
  )
}

/** The Web's record status: a coloured dot, not a second word. */
function StatusDot({ status }: { status: 'running' | 'done' | 'error' }): React.JSX.Element {
  const color = status === 'running' ? colors.running : status === 'error' ? colors.danger : colors.success
  return <View style={[styles.statusDot, { backgroundColor: color }]} />
}

/**
 * One turn's records, grouped the way the Web groups them.
 *
 * A turn is a preamble plus its steps. The preamble — the prompts and the
 * context the model was given — is the Web's 「消息」 group; each numbered step
 * (every record whose log entry carried a `step`) is a 「第 N 步」 group; a
 * compaction owns its own 「压缩 N」 group. Records keep the order the log
 * recorded them in, which is what makes the fold readable at all.
 *
 * A record with no step does not always belong at the top: a turn's delivered
 * files land after its last step, and dropping them into the preamble group
 * would print a 13:35 row above a 13:31 one. The Web meets this by only
 * appending to a 「消息」 group it is already standing on and otherwise opening
 * a fresh one where the record fell, so a late delivery gets its own group
 * below the steps instead of being lifted over them.
 */
function project(turns: Turn[], t: Translate): TrajectoryTurn[] {
  let index = 0
  const next: TrajectoryTurn[] = []
  turns.forEach((turn, position) => {
    const groups: TrajectoryGroup[] = []
    /** The group a record whose log entry carried a `step` belongs to. */
    const stepGroup = (key: string, title: string): TrajectoryGroup => {
      const existing = groups.find(candidate => candidate.key === key)
      if (existing !== undefined) return existing
      const created: TrajectoryGroup = { key, title, records: [] }
      groups.push(created)
      return created
    }
    /** Where a record with no step goes: the trailing 「消息」 group, or a new one here. */
    const pushMessage = (records: TrajectoryRecord[]): void => {
      const last = groups[groups.length - 1]
      if (last !== undefined && isMessageGroup(last)) {
        last.records.push(...records)
        return
      }
      groups.push({
        key: `message:${groups.length}`,
        title: t('trajectory.group.message'),
        records: [...records],
      })
    }
    const number = (record: RawRecord): TrajectoryRecord => ({
      ...record,
      index: ++index,
      children: record.children.map(number),
    })
    for (const item of turn.items) {
      const step = stepOf(item)
      const records = recordsFor(item, t, number)
      if (item.kind === 'compaction') {
        stepGroup(`compaction:${item.seq}`, t('trajectory.group.compaction', { seq: item.seq }))
          .records.push(...records)
        continue
      }
      if (step === undefined) {
        pushMessage(records)
        continue
      }
      stepGroup(`step:${step}`, t('trajectory.group.step', { step })).records.push(...records)
    }
    for (const group of groups) {
      const span = spanOf(group.records)
      if (span !== undefined && !isMessageGroup(group)) {
        group.description = runDurationLabel(Math.max(1_000, span), t)
      }
    }
    next.push({ key: turn.key, ordinal: position + 1, turn, groups })
  })
  return next
}

/**
 * Whether a group is one of the turn's 「消息」 sections.
 *
 * A turn can hold more than one of them — the preamble, and then whatever
 * stepless record fell later — so they are keyed by position and recognised by
 * key rather than being a single well-known name.
 */
function isMessageGroup(group: TrajectoryGroup): boolean {
  return group.key.startsWith('message:')
}

/**
 * The wall time a group's records span.
 *
 * A step's own clock is not always recorded, so this reads from the earliest
 * `startedAt` (or arrival) to the latest `endedAt` (or arrival) — the same span
 * the Web prints beside a step's title. `undefined` means the group recorded
 * nothing to measure, which is not the same as a group that took no time.
 */
function spanOf(records: TrajectoryRecord[]): number | undefined {
  let from: number | undefined
  let to: number | undefined
  const consider = (value: number | undefined, lower: boolean): void => {
    if (value === undefined || value <= 0) return
    if (lower) from = from === undefined ? value : Math.min(from, value)
    else to = to === undefined ? value : Math.max(to, value)
  }
  for (const record of records) {
    consider(record.startedAt ?? record.time, true)
    consider(record.endedAt ?? record.time, false)
  }
  if (from === undefined || to === undefined || to <= from) return undefined
  return to - from
}

/**
 * One item's contribution to the list — an array, because one log line can be
 * two records: a step records its reasoning and the answer it produced under a
 * single `assistant/message`, and the Web's own view lists them as separate
 * rows (思考 and 助手). Turn boundaries carry the section header instead, and
 * record nothing of their own.
 */
/**
 * The step a record belongs to.
 *
 * Only the records a request produced carry one; a prompt, an injected context
 * message, a compaction and a turn boundary do not, which is exactly what
 * separates the Web's 「消息」 group from its numbered steps.
 */
function stepOf(item: ConversationItem): number | undefined {
  switch (item.kind) {
    case 'assistant':
    case 'tool':
    case 'stream':
    case 'preparing':
      return item.step
    default:
      return undefined
  }
}

function recordsFor(
  item: ConversationItem,
  t: Translate,
  number: (record: RawRecord) => TrajectoryRecord,
): TrajectoryRecord[] {
  return rawRecordsFor(item, t).map(number)
}

function rawRecordsFor(item: ConversationItem, t: Translate): RawRecord[] {
  switch (item.kind) {
    case 'user':
      return [{
        key: item.key,
        kind: 'user',
        badge: t('trajectory.kind.user'),
        title: firstLine(item.text) || t('trajectory.kind.user'),
        meta: item.images.length === 0 ? '' : t('trajectory.images', { count: item.images.length }),
        preview: oneLine(item.text),
        body: item.text,
        sections: [],
        children: [],
        time: item.time,
      }]
    case 'system':
      return [{
        key: item.key,
        kind: 'system',
        badge: t('trajectory.kind.system'),
        title: item.initial ? t('trajectory.system.initial') : t('trajectory.system.updated'),
        meta: '',
        preview: oneLine(item.text),
        body: item.text,
        sections: [],
        children: [],
        time: item.time,
      }]
    case 'context':
      return [{
        key: item.key,
        kind: 'context',
        badge: t('trajectory.kind.context'),
        title: item.sourceKind === undefined
          ? t('trajectory.kind.context')
          : t('trajectory.context.from', { source: item.sourceKind }),
        meta: '',
        preview: oneLine(item.text),
        body: item.text,
        sections: [],
        children: [],
        time: item.time,
      }]
    case 'assistant': {
      const records: RawRecord[] = []
      if (item.reasoning.trim() !== '') {
        records.push({
          key: `${item.key}:reasoning`,
          kind: 'thinking',
          badge: t('trajectory.kind.thinking'),
          title: t('trajectory.kind.thinking'),
          meta: '',
          preview: firstLine(item.reasoning),
          body: item.reasoning,
          sections: [],
          children: [],
          time: item.time,
          ...(item.startedAt === undefined ? {} : { startedAt: item.startedAt }),
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
      const duration = item.startedAt === undefined || item.endedAt === undefined
        ? undefined
        : Math.max(0, item.endedAt - item.startedAt)
      const sections: TrajectorySection[] = [
        ...(args === '' ? [] : [{ label: t('trajectory.args'), text: compactJson(item.args, 4_000) }]),
        ...(item.schema === undefined ? [] : [{ label: t('trajectory.schema'), text: prettyJson(item.schema) }]),
      ]
      const meta = [
        toolStatusLabel(item.status, t),
        ...(duration === undefined || duration <= 0 ? [] : [runDurationLabel(duration, t)]),
        ...(item.subCalls.length === 0 ? [] : [t('trajectory.subtools', { count: item.subCalls.length })]),
      ].join(t('chat.step.separator'))
      return [{
        key: item.key,
        kind: 'tool',
        badge: t('trajectory.kind.tool'),
        title: toolDisplayName(item.name, t),
        meta,
        status: item.status === 'running' ? 'running' : item.status === 'error' ? 'error' : 'done',
        preview: result !== '' ? oneLine(result) : item.resultPreview,
        ...(result === '' ? {} : { body: result }),
        sections,
        children: item.subCalls.map(subCall => subtoolRecord(item.key, subCall, t)),
        time: item.time,
        ...(item.startedAt === undefined ? {} : { startedAt: item.startedAt }),
        ...(item.endedAt === undefined ? {} : { endedAt: item.endedAt }),
      }]
    }
    case 'preparing':
      return [{
        key: item.key,
        kind: 'tool',
        badge: t('trajectory.kind.preparing'),
        title: toolDisplayName(item.name, t),
        meta: t('trajectory.status.running'),
        status: 'running',
        preview: '',
        sections: [],
        children: [],
        time: item.time,
      }]
    case 'compaction':
      return [{
        key: item.key,
        kind: 'compacted',
        badge: t('trajectory.kind.compacted'),
        title: t('trajectory.kind.compaction'),
        meta: '',
        preview: oneLine(item.summary),
        body: item.summary,
        sections: [],
        children: [],
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
        preview: compactJson(item.data, 160),
        sections: [{ label: t('trajectory.raw'), text: prettyJson(item.data) }],
        children: [],
        time: item.time,
      }]
    case 'delivery':
      return [{
        key: item.key,
        kind: 'delivery',
        badge: t('trajectory.kind.delivery'),
        title: t('trajectory.delivered', { count: item.files.length }),
        meta: '',
        preview: item.files.map(file => file.path).join(t('chat.step.separator')),
        body: item.files.map(file => file.path).join('\n'),
        sections: [],
        children: [],
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
): RawRecord {
  const usage = item?.usage === undefined ? null : stepTokenUsage(item.usage)
  const metrics: TrajectoryMetrics | undefined = usage === null
    ? undefined
    : {
      input: usage.uncachedInputTokens,
      output: usage.outputTokens,
      ...(usage.reasoningTokens === undefined ? {} : { think: usage.reasoningTokens }),
    }
  const duration = item?.startedAt === undefined || item.time <= item.startedAt
    ? undefined
    : item.time - item.startedAt
  const meta = [
    ...(duration === undefined ? [] : [runDurationLabel(duration, t)]),
    ...(item?.interrupted === true ? [t('chat.interrupted')] : []),
  ].join(t('chat.step.separator'))
  return {
    key,
    kind: 'assistant',
    badge: t('trajectory.kind.assistant'),
    title: running ? t('trajectory.status.running') : t('trajectory.kind.assistant'),
    meta,
    status: running ? 'running' : 'done',
    preview: oneLine(text),
    body: text,
    sections: [],
    children: [],
    ...(metrics === undefined ? {} : { metrics }),
    time: item?.time ?? 0,
    ...(item?.startedAt === undefined ? {} : { startedAt: item.startedAt }),
  }
}

/** One nested call under a tool row: the Web's 子工具 record. */
function subtoolRecord(parentKey: string, call: ToolSubCall, t: Translate): RawRecord {
  const args = call.args.trim()
  const result = call.resultText.trim()
  const sections: TrajectorySection[] = [
    ...(args === '' ? [] : [{ label: t('trajectory.args'), text: compactJson(call.args, 4_000) }]),
  ]
  return {
    key: `${parentKey}:sub:${call.callId}`,
    kind: 'subtool',
    badge: t('trajectory.kind.subtool'),
    title: toolDisplayName(call.name, t),
    meta: toolStatusLabel(call.status, t),
    status: call.status === 'running' ? 'running' : call.status === 'error' ? 'error' : 'done',
    preview: result !== '' ? oneLine(result) : call.resultPreview,
    ...(result === '' ? {} : { body: result }),
    sections,
    children: [],
    time: call.time,
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

/** One line, whatever the body holds: the collapsed row's own preview. */
function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > 120 ? `${collapsed.slice(0, 119)}…` : collapsed
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
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing(2),
    marginTop: spacing(2),
    marginBottom: spacing(0.5),
  },
  groupTitle: { color: chat.labelSecondary, fontSize: fontSize.tiny, fontWeight: '600' },
  groupDescription: { flexShrink: 1, color: chat.labelTertiary, fontSize: fontSize.tiny },
  record: { paddingVertical: spacing(0.5) },
  recordNested: {
    marginLeft: spacing(3),
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: chat.borderL1,
    paddingLeft: spacing(2),
  },
  recordPress: { paddingVertical: spacing(1) },
  recordHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  index: { minWidth: 26, color: chat.labelTertiary, fontSize: fontSize.tiny, fontVariant: ['tabular-nums'] },
  badge: {
    width: 34,
    color: chat.labelTertiary,
    fontSize: fontSize.tiny,
  },
  recordTitle: { flexShrink: 1, color: chat.labelPrimary, fontSize: fontSize.small },
  recordMeta: { marginLeft: 'auto', flexShrink: 1, color: chat.labelTertiary, fontSize: fontSize.tiny },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(0.5) },
  metric: { color: chat.labelTertiary, fontSize: fontSize.tiny, fontVariant: ['tabular-nums'] },
  recordBody: {
    marginTop: spacing(0.5),
    color: chat.labelSecondary,
    fontSize: fontSize.tiny,
    lineHeight: fontSize.tiny + 6,
  },
  recordBodyNested: { color: chat.labelTertiary },
  section: {
    marginTop: spacing(1),
    paddingTop: spacing(1),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chat.borderL1,
  },
  sectionLabel: { color: chat.labelTertiary, fontSize: fontSize.tiny, fontWeight: '600' },
  sectionBody: {
    marginTop: spacing(0.5),
    color: chat.labelSecondary,
    fontFamily: mono,
    fontSize: fontSize.tiny,
    lineHeight: fontSize.tiny + 6,
  },
})
