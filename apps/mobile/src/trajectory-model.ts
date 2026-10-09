/**
 * The conversation's trajectory, projected once for every reader of it.
 *
 * The Web's own trajectory view is a table: records grouped by turn and then
 * by message and step, a timeline over the whole log, an inspector beside the
 * rows, and a toolbar that folds turns and calls in bulk. A phone has room for
 * none of the table, so the same projection is laid out as a list — every turn
 * a section header, the turn's preamble under a 「消息」 group, then one group
 * per step, in log order.
 *
 * Both the list and the record page that opens from it read this module, and
 * so do the timeline overview and the search box: one projection means the
 * three can never disagree about what the log holds. Nothing here touches the
 * store, the network or React — it maps the `Turn[]` the transcript already
 * derives onto the rows the Web's table would have drawn.
 */
import {
  compactJson,
  prettyJson,
  stepTokenUsage,
  type ConversationItem,
  type ToolSubCall,
  type Turn,
} from '@dsh-mobile/core'
import type { TranslationKey } from './i18n'
import { runDurationLabel, toolDisplayName } from './ui-labels'

/** A record's translator, narrowed to what the projection needs. */
export type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

/** The record kinds the Web's ledger knows, plus the rows only this list has. */
export type TrajectoryKind =
  | 'system'
  | 'user'
  | 'context'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'subtool'
  | 'compacted'
  | 'delivery'
  | 'other'

/** One labelled block inside a record's body (a tool's parameters, its schema, …). */
export interface TrajectorySection {
  label: string
  text: string
}

/** One step's billed buckets, laid out as the Web's three metric columns. */
export interface TrajectoryMetrics {
  input?: number
  output?: number
  think?: number
}

/** Everything a record carries before {@link projectTrajectory} numbers it. */
export interface RawTrajectoryRecord {
  /** The conversation item's own key, which is what a row is held by. */
  key: string
  kind: TrajectoryKind
  /** The left-hand chip: what this record is, in one or two words. */
  badge: string
  title: string
  /** The right-hand reading: status, token columns, clock. */
  meta: string
  /** The one-line body shown in the list. */
  preview: string
  /** The full body, shown on the record's own page. */
  body?: string
  /** Extra labelled blocks, shown on the record's own page. */
  sections: TrajectorySection[]
  /** Nested calls a tool row owns (the Web's 子工具 rows). */
  children: RawTrajectoryRecord[]
  /** The Web's three message columns; only assistant rows carry them. */
  metrics?: TrajectoryMetrics
  status?: 'running' | 'done' | 'error'
  /** When the log recorded it; 0 when the record carries no clock. */
  time: number
  /** When the work itself began, when the log recorded it apart from `time`. */
  startedAt?: number
  /** When the work finished, when that is later than `time`. */
  endedAt?: number
  /** The record's own measured wall time, which is what the timeline scales by. */
  durationMs?: number
}

/** A record placed in the log: its 1-based `#N`, its section, and its children. */
export interface TrajectoryRecord extends Omit<RawTrajectoryRecord, 'children'> {
  index: number
  children: TrajectoryRecord[]
  /** The 1-based turn ordinal this record sits in; `null` before any turn opened. */
  turn: number | null
  /** The 「消息」/「第 N 步」/「压缩 N」 section this record was filed under. */
  group: string
}

/** One 「消息」/「第 N 步」/「压缩 N」 section inside a turn. */
export interface TrajectoryGroup {
  key: string
  title: string
  /** The group's own wall span, when its records recorded one. */
  description?: string
  records: TrajectoryRecord[]
}

/** One turn: its section header facts and the groups filed under it. */
export interface TrajectoryTurn {
  key: string
  ordinal: number
  turn: Turn
  groups: TrajectoryGroup[]
}

/** Which projection of the log the timeline draws. */
export type TrajectoryTimelineMode = 'sequence' | 'duration'

/** One record projected into the timeline's domain. */
export interface TrajectoryTimelineSpan {
  index: number
  kind: TrajectoryKind
  label: string
  /** 0 输入 · 1 模型 · 2 工具, the Web's three lanes. */
  lane: number
  isError: boolean
  start: number
  end: number
}

/** One turn boundary in the timeline's domain. */
export interface TrajectoryTimelineTurnBoundary {
  turn: number
  time: number
}

/** The full-domain model the overview bar draws. */
export interface TrajectoryTimelineModel {
  start: number
  end: number
  spans: TrajectoryTimelineSpan[]
  turnBoundaries: TrajectoryTimelineTurnBoundary[]
  /** Whether the domain is recorded milliseconds rather than record slots. */
  timed: boolean
}

/** The Web's three timeline lanes, in the order its labels print them. */
export const TRAJECTORY_LANES = ['input', 'model', 'tools'] as const

/**
 * Project one conversation's turns onto the Web's ledger rows.
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
 * @param turns - the transcript's own turn fold.
 * @param t - active locale lookup.
 * @returns one entry per turn, ready for the list and the record page.
 */
export function projectTrajectory(turns: Turn[], t: Translate): TrajectoryTurn[] {
  let index = 0
  const next: TrajectoryTurn[] = []
  turns.forEach((turn, position) => {
    const ordinal = position + 1
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
    const number = (record: RawTrajectoryRecord, group: string): TrajectoryRecord => ({
      ...record,
      index: ++index,
      turn: ordinal,
      group,
      children: record.children.map(child => number(child, group)),
    })
    for (const item of turn.items) {
      const step = stepOf(item)
      if (item.kind === 'compaction') {
        const key = `compaction:${item.seq}`
        const title = t('trajectory.group.compaction', { seq: item.seq })
        const group = stepGroup(key, title)
        group.records.push(...recordsFor(item, t, record => number(record, title)))
        continue
      }
      if (step === undefined) {
        const title = t('trajectory.group.message')
        pushMessage(recordsFor(item, t, record => number(record, title)))
        continue
      }
      const key = `step:${step}`
      const title = t('trajectory.group.step', { step })
      const group = stepGroup(key, title)
      group.records.push(...recordsFor(item, t, record => number(record, title)))
    }
    for (const group of groups) {
      const span = spanOf(group.records)
      if (span !== undefined && !isMessageGroup(group)) {
        // The Web floors a measured span at one second, so a step that resolved
        // inside the same second reads 「用时 1秒」 rather than 「用时 0秒」.
        group.description = runDurationLabel(Math.max(1_000, span), t)
      }
    }
    next.push({ key: turn.key, ordinal, turn, groups })
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

/** Every record of a projection, parents before their own children, in `#N` order. */
export function flattenTrajectory(turns: TrajectoryTurn[]): TrajectoryRecord[] {
  const flat: TrajectoryRecord[] = []
  const walk = (record: TrajectoryRecord): void => {
    flat.push(record)
    for (const child of record.children) walk(child)
  }
  for (const turn of turns) {
    for (const group of turn.groups) {
      for (const record of group.records) walk(record)
    }
  }
  return flat
}

/** The record carrying one `#N`, or `undefined` when the log no longer holds it. */
export function trajectoryRecordByIndex(
  turns: TrajectoryTurn[],
  index: number,
): TrajectoryRecord | undefined {
  return flattenTrajectory(turns).find(record => record.index === index)
}

/** The lanes a record's kind is drawn on, matching the Web's `laneFor`. */
function laneFor(kind: TrajectoryKind): number {
  if (kind === 'tool' || kind === 'subtool') return 2
  if (kind === 'assistant' || kind === 'thinking' || kind === 'compacted') return 1
  return 0
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value)
}

/**
 * The wall time one record occupies, or `null` when the log recorded none.
 *
 * The Web scales its timeline by the duration the request itself measured; the
 * projection here holds the same two numbers (`startedAt` and the span the log
 * measured) and falls back to the record's arrival, so a prompt still gets a
 * sliver in the overview instead of vanishing from it.
 */
function recordRange(record: TrajectoryRecord): { start: number; end: number } | null {
  const start = finite(record.startedAt)
    ? record.startedAt
    : finite(record.time) && record.time > 0 ? record.time : null
  if (start === null) return null
  const duration = finite(record.durationMs) ? Math.max(0, record.durationMs) : 0
  return { start, end: start + duration }
}

/** One record and everything it owns, parents first. */
function collect(record: TrajectoryRecord): TrajectoryRecord[] {
  return [record, ...record.children.flatMap(collect)]
}

/**
 * Project every record into the Web's three-lane overview.
 *
 * `sequence` gives every record one equal slot, so the bar reads as "what
 * happened, in order" however long each step took. `duration` scales each span
 * by the wall time the log recorded and compresses the idle gaps between
 * operations, which is the projection the Web's 时长 switch selects.
 * @param turns - the turn projection from {@link projectTrajectory}.
 * @param mode - equal-width operations, or recorded durations.
 * @returns the overview model, or `null` when the log holds nothing to draw.
 */
export function deriveTrajectoryTimeline(
  turns: TrajectoryTurn[],
  mode: TrajectoryTimelineMode,
): TrajectoryTimelineModel | null {
  const records = flattenTrajectory(turns)
  if (records.length === 0) return null

  if (mode === 'sequence') {
    const spans: TrajectoryTimelineSpan[] = []
    const turnBoundaries: TrajectoryTimelineTurnBoundary[] = []
    let slot = 0
    for (const turn of turns) {
      const own = turn.groups.flatMap(group => group.records).flatMap(collect)
      if (own.length === 0) continue
      turnBoundaries.push({ turn: turn.ordinal, time: slot })
      for (const record of own) {
        spans.push({
          index: record.index,
          kind: record.kind,
          label: record.title,
          lane: laneFor(record.kind),
          isError: record.status === 'error',
          start: slot,
          end: slot + 1,
        })
        slot += 1
      }
    }
    return spans.length === 0 ? null : {
      start: 0,
      end: spans.length,
      spans,
      turnBoundaries,
      timed: false,
    }
  }

  const timed: { record: TrajectoryRecord; start: number; end: number }[] = []
  for (const record of records) {
    const range = recordRange(record)
    if (range !== null) timed.push({ record, ...range })
  }
  if (timed.length === 0) return null
  const sorted = [...timed].sort((left, right) => left.start - right.start || left.end - right.end)
  const removedByRecord = new Map<number, number>()
  let removed = 0
  let coveredUntil: number | null = null
  for (const entry of sorted) {
    if (coveredUntil !== null && entry.start > coveredUntil) removed += entry.start - coveredUntil
    removedByRecord.set(entry.record.index, removed)
    coveredUntil = coveredUntil === null ? entry.end : Math.max(coveredUntil, entry.end)
  }

  const spans: TrajectoryTimelineSpan[] = timed.map((entry) => {
    const offset = removedByRecord.get(entry.record.index) ?? 0
    return {
      index: entry.record.index,
      kind: entry.record.kind,
      label: entry.record.title,
      lane: laneFor(entry.record.kind),
      isError: entry.record.status === 'error',
      start: entry.start - offset,
      end: entry.end - offset,
    }
  })
  const byIndex = new Map(spans.map(span => [span.index, span]))
  const turnBoundaries: TrajectoryTimelineTurnBoundary[] = []
  for (const turn of turns) {
    const own = turn.groups
      .flatMap(group => group.records)
      .flatMap(collect)
      .flatMap(record => byIndex.get(record.index) ?? [])
    if (own.length === 0) continue
    turnBoundaries.push({
      turn: turn.ordinal,
      time: Math.min(...own.map(span => span.start)),
    })
  }
  return {
    start: Math.min(...spans.map(span => span.start)),
    end: Math.max(...spans.map(span => span.end)),
    spans,
    turnBoundaries,
    timed: true,
  }
}

/**
 * Every `#N` whose record holds the query, or `null` without a query.
 *
 * The terms are separated by spaces and all of them must match, exactly as the
 * Web's own `TrajectorySearchIndex` reads a query. The haystack is a record's
 * every printed field — chip, title, meta, body, its labelled blocks and the
 * section it sits in — so searching for a tool's result text finds the call
 * that produced it.
 * @param turns - the turn projection from {@link projectTrajectory}.
 * @param query - what the reader typed into the toolbar's search box.
 * @returns matching record indexes, or `null` when the box is empty.
 */
export function searchTrajectory(turns: TrajectoryTurn[], query: string): Set<number> | null {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return null
  const matches = new Set<number>()
  for (const turn of turns) {
    const turnLabel = `第 ${turn.ordinal} 轮`
    for (const group of turn.groups) {
      const section = `${group.title}\n${turnLabel}`.toLowerCase()
      for (const record of group.records) {
        for (const candidate of collect(record)) {
          const text = [
            section,
            candidate.badge,
            candidate.title,
            candidate.meta,
            candidate.preview,
            candidate.body ?? '',
            ...candidate.sections.flatMap(entry => [entry.label, entry.text]),
          ].join('\n').toLowerCase()
          if (terms.every(term => text.includes(term))) matches.add(candidate.index)
        }
      }
    }
  }
  return matches
}

/** The step a record belongs to, which is what separates 消息 from 第 N 步. */
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
  number: (record: RawTrajectoryRecord) => TrajectoryRecord,
): TrajectoryRecord[] {
  return rawRecordsFor(item, t).map(number)
}

/**
 * One item's contribution to the list.
 *
 * An array, because one log line can be two records: a step records its
 * reasoning and the answer it produced under a single `assistant/message`, and
 * both are rows here (思考 and 助手), the way the Web's own ledger lists them.
 * Turn boundaries carry the section header instead, and record nothing.
 */
function rawRecordsFor(item: ConversationItem, t: Translate): RawTrajectoryRecord[] {
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
      const records: RawTrajectoryRecord[] = []
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
        ...(duration === undefined ? {} : { durationMs: duration }),
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
): RawTrajectoryRecord {
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
    ...(duration === undefined ? {} : { durationMs: duration }),
  }
}

/** One nested call under a tool row: the Web's 子工具 record. */
function subtoolRecord(parentKey: string, call: ToolSubCall, t: Translate): RawTrajectoryRecord {
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
    children: call.subCalls.map(nested => subtoolRecord(`${parentKey}:${call.callId}`, nested, t)),
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

/** One line, whatever the body holds: the list row's own preview. */
export function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > 120 ? `${collapsed.slice(0, 119)}…` : collapsed
}
