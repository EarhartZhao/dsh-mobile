/**
 * One trajectory record, in full — the Web's inspector as a page of its own.
 *
 * The Web keeps the record it is inspecting in a panel beside the ledger, with
 * a row of tabs over it: 概述 always, then the pages that record can answer —
 * 预览 and 原始内容 for anything the model or the reader wrote, 参数 / 结果 /
 * Schema / 计时 for a call, 系统提示词 for a prompt. The phone has no beside,
 * so tapping a row pushes this page and the same tabs run across the top.
 *
 * 概述 is the inspector's own summary: where the record came from, whether it
 * finished, the step's token buckets, a clipped preview, and — for an answer —
 * the request's five timing readings. Nothing on the other tabs is truncated:
 * a call's parameters, its result and the schema the model was shown are all
 * here, and so are the sub-tool calls the record owns.
 *
 * It re-derives the same projection the list does and looks its record up by
 * `#N`, so the two can never disagree, and so the page keeps reading correctly
 * if the log grows under it while it is open.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import Markdown from 'react-native-markdown-display'
import {
  deriveConversation,
  groupTurns,
  type ConnectionManager,
  type Turn,
} from '@dsh-mobile/core'
import { useI18n } from '../i18n'
import { colors, chat, fontSize, radius, spacing } from '../theme'
import { Icon } from '../icons'
import { TouchableOpacity } from '../components/Touchable'
import { markdownPreviewRules, markdownStyles } from '../markdown'
import {
  projectTrajectory,
  trajectoryRecordByIndex,
  type TrajectoryRecord,
  type Translate,
} from '../trajectory-model'

interface Props {
  manager: ConnectionManager
  sessionId: string
  /** The `#N` of the record to show. */
  index: number
  onBack: () => void
}

/** The tabs the Web's inspector offers, one per page a record can answer. */
type RecordTab =
  | 'overview'
  | 'preview'
  | 'raw'
  | 'source'
  | 'payload'
  | 'result'
  | 'schema'
  | 'timing'
  | 'systemPrompt'

interface TabItem {
  id: RecordTab
  label: string
}

export function TrajectoryRecordScreen({ manager, sessionId, index, onBack }: Props): React.JSX.Element {
  const { t } = useI18n()
  const [turns, setTurns] = useState<Turn[]>([])
  const [tab, setTab] = useState<RecordTab>('overview')

  /** The same live fold the list reads, so the record stays current. */
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
      setTurns(groupTurns(deriveConversation(session, {
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

  /** A new record opens on its summary, whichever one was open before. */
  useEffect(() => { setTab('overview') }, [index])

  const model = useMemo(() => projectTrajectory(turns, t), [turns, t])
  const record = useMemo(() => trajectoryRecordByIndex(model, index), [model, index])
  const tabs = useMemo<TabItem[]>(() => record === undefined ? [] : recordTabs(record, t), [record, t])
  // A record can change under an open page — a stream becomes a message — and
  // the tab it was reading may no longer exist, so a page that is gone falls
  // back to the record's first tab (the summary, for every kind that has one).
  const active = tabs.some(entry => entry.id === tab) ? tab : tabs[0]?.id ?? 'overview'

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
      </View>
      {record === undefined
        ? <Text style={styles.empty}>{t('trajectory.record.missing')}</Text>
        : (
          <>
            <View style={styles.heading}>
              <View style={styles.headingTop}>
                <Text style={styles.badge}>{record.badge}</Text>
                {record.title !== record.badge && (
                  <Text style={styles.headingTitle} numberOfLines={1}>{record.title}</Text>
                )}
                {record.status !== undefined && <StatusDot status={record.status} />}
                {record.meta !== '' && (
                  <Text style={styles.headingMeta} numberOfLines={1}>{record.meta}</Text>
                )}
              </View>
              <Text style={styles.headingSub} numberOfLines={1}>{hierarchy(record, t)}</Text>
            </View>
            <TabBar tabs={tabs} active={active} onSelect={setTab} />
            <ScrollView contentContainerStyle={styles.content}>
              <RecordPage
                record={record}
                tab={active}
                t={t}
                onOpenTab={setTab}
              />
            </ScrollView>
          </>
        )}
    </View>
  )
}

/** 「第 N 轮 · 第 M 步」 — where this record sits, the Web's own breadcrumb. */
function hierarchy(record: TrajectoryRecord, t: Translate): string {
  const turn = record.turn === null
    ? t('trajectory.record.betweenTurns')
    : t('trajectory.turn', { turn: record.turn })
  return `${turn}${t('chat.step.separator')}${record.group}`
}

/**
 * The pages one record can answer, in the order the Web's inspector lists them.
 *
 * A prompt or an answer is Markdown, so it gets 预览 and 原始内容; a call has
 * the payload it was given, the result it returned, the schema the model was
 * shown, and its own clock; a compaction only has a summary and its raw text.
 */
function recordTabs(record: TrajectoryRecord, t: Translate): TabItem[] {
  const overview: TabItem = { id: 'overview', label: t('trajectory.detail.tab.overview') }
  switch (record.kind) {
    case 'system':
      return [{ id: 'systemPrompt', label: t('trajectory.detail.tab.systemPrompt') }]
    case 'compacted':
      return [overview, { id: 'raw', label: t('trajectory.raw') }]
    case 'user':
    case 'context':
    case 'assistant':
    case 'thinking': {
      const tabs: TabItem[] = [
        overview,
        { id: 'preview', label: t('trajectory.detail.tab.preview') },
        { id: 'raw', label: t('trajectory.raw') },
      ]
      if (record.sourceJson !== undefined) {
        tabs.push({ id: 'source', label: t('trajectory.detail.tab.source') })
      }
      return tabs
    }
    case 'tool':
    case 'subtool': {
      const tabs: TabItem[] = [overview]
      if (record.payload !== undefined) tabs.push({ id: 'payload', label: t('trajectory.args') })
      if (record.body !== undefined && record.body !== '') {
        tabs.push({ id: 'result', label: t('trajectory.result') })
      }
      if (record.schema !== undefined) tabs.push({ id: 'schema', label: t('trajectory.schema') })
      tabs.push({ id: 'timing', label: t('trajectory.detail.tab.timing') })
      return tabs
    }
    default:
      return record.body === undefined || record.body === ''
        ? [overview]
        : [overview, { id: 'raw', label: t('trajectory.raw') }]
  }
}

/** The tab strip: the Web's own, with the open page underlined. */
function TabBar({ tabs, active, onSelect }: {
  tabs: TabItem[]
  active: RecordTab
  onSelect: (tab: RecordTab) => void
}): React.JSX.Element {
  return (
    <View style={styles.tabBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={styles.tab}
            onPress={() => { onSelect(tab.id) }}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab.id === active }}
            accessibilityLabel={tab.label}
          >
            <Text style={[styles.tabLabel, tab.id === active && styles.tabLabelOn]}>{tab.label}</Text>
            <View style={[styles.tabRule, tab.id === active && styles.tabRuleOn]} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )
}

/** Whichever page the strip has open. */
function RecordPage({ record, tab, t, onOpenTab }: {
  record: TrajectoryRecord
  tab: RecordTab
  t: Translate
  onOpenTab: (tab: RecordTab) => void
}): React.JSX.Element {
  switch (tab) {
    case 'preview':
    case 'systemPrompt':
      return <PreviewPage record={record} />
    case 'raw':
      return <PlainPage text={rawText(record)} />
    case 'source':
      return <PlainPage text={jsonText(record.sourceJson)} />
    case 'payload':
      return <PlainPage text={record.payload ?? ''} />
    case 'schema':
      return <PlainPage text={record.schema ?? ''} />
    case 'result':
      return <PlainPage text={record.body ?? ''} />
    case 'timing':
      return <TimingPage record={record} t={t} />
    default:
      return <OverviewPage record={record} t={t} onOpenTab={onOpenTab} />
  }
}

/**
 * 概述 — the inspector's summary of one record.
 *
 * The order is the Web's: where it came from, what state it is in, what it
 * cost, a clipped look at its content, and then the clocks. Sections whose
 * title carries a chevron open the page that holds them in full.
 */
function OverviewPage({ record, t, onOpenTab }: {
  record: TrajectoryRecord
  t: Translate
  onOpenTab: (tab: RecordTab) => void
}): React.JSX.Element {
  const usage = record.metrics
  const content = usage?.output === undefined || usage.think === undefined
    ? undefined
    : Math.max(0, usage.output - usage.think)
  const timing = assistantTiming(record)
  return (
    <View>
      <View style={styles.facts}>
        {record.source !== undefined && (
          <Fact label={t('trajectory.detail.tab.source')} value={record.source} />
        )}
        {record.requestNumber !== undefined && (
          <Fact
            label={t('trajectory.detail.tab.source')}
            value={t('trajectory.request.label', { request: record.requestNumber })}
          />
        )}
        <Fact label={t('trajectory.detail.hierarchy')} value={hierarchy(record, t)} />
        {record.status !== undefined && (
          <Fact label={t('trajectory.detail.status')} value={statusLabel(record.status, t)} />
        )}
        {record.kind === 'assistant' && (
          <>
            <Fact
              label={t('trajectory.detail.tokens')}
              value={usage?.output === undefined ? '—' : tokenLabel(usage.output, t)}
            />
            {usage?.think !== undefined && (
              <Fact label={t('trajectory.detail.reasoning')} value={tokenLabel(usage.think, t)} />
            )}
            {content !== undefined && (
              <Fact label={t('trajectory.detail.content')} value={tokenLabel(content, t)} />
            )}
          </>
        )}
        {(record.kind === 'user' || record.kind === 'context') && (
          <Fact
            label={t('trajectory.detail.duration')}
            value={elapsedLabel(record.durationMs, t)}
          />
        )}
      </View>
      {isMarkdown(record) && (
        <Section
          title={t('trajectory.detail.tab.preview')}
          onOpen={() => { onOpenTab('preview') }}
        >
          <View style={styles.clip}>
            <PreviewPage record={record} />
          </View>
        </Section>
      )}
      {record.payload !== undefined && (
        <Section title={t('trajectory.args')} onOpen={() => { onOpenTab('payload') }}>
          <Text style={[styles.body, styles.mono]} numberOfLines={8} selectable>{record.payload}</Text>
        </Section>
      )}
      {record.body !== undefined && record.body !== '' && !isMarkdown(record) && (
        <Section title={t('trajectory.result')} onOpen={() => { onOpenTab('result') }}>
          <Text style={styles.body} numberOfLines={8} selectable>{record.body}</Text>
        </Section>
      )}
      {record.schema !== undefined && (
        <Section title={t('trajectory.schema')} onOpen={() => { onOpenTab('schema') }}>
          <Text style={[styles.body, styles.mono]} numberOfLines={8} selectable>{record.schema}</Text>
        </Section>
      )}
      {timing !== null && (
        <Section title={t('trajectory.detail.requestTiming')}>
          <AssistantTiming timing={timing} t={t} />
        </Section>
      )}
      {timing === null && record.kind !== 'compacted' && isMarkdown(record) === false
        && (record.startedAt !== undefined || record.durationMs !== undefined) && (
        <Section title={t('trajectory.detail.tab.timing')} onOpen={() => { onOpenTab('timing') }}>
          <RecordTiming record={record} t={t} />
        </Section>
      )}
      {record.children.length > 0 && (
        <Section title={`${t('trajectory.record.children')}${t('chat.step.separator')}${t('trajectory.subtools', { count: record.children.length })}`}>
          {record.children.map(child => (
            <View key={child.key} style={styles.child}>
              <View style={styles.headingTop}>
                <Text style={styles.index}>#{child.index}</Text>
                <Text style={styles.badge}>{child.badge}</Text>
                <Text style={styles.childTitle} numberOfLines={1}>{child.title}</Text>
                {child.status !== undefined && <StatusDot status={child.status} />}
                {child.meta !== '' && (
                  <Text style={styles.headingMeta} numberOfLines={1}>{child.meta}</Text>
                )}
              </View>
              {child.payload !== undefined && (
                <Text style={[styles.body, styles.mono]} numberOfLines={6} selectable>{child.payload}</Text>
              )}
              {child.body !== undefined && child.body !== '' && (
                <Text style={styles.body} numberOfLines={6} selectable>{child.body}</Text>
              )}
            </View>
          ))}
        </Section>
      )}
    </View>
  )
}

/** 预览 — the record's own Markdown, thinking block first, exactly as the Web renders it. */
function PreviewPage({ record }: { record: TrajectoryRecord }): React.JSX.Element {
  const { t } = useI18n()
  const thinking = record.thinking ?? ''
  const body = record.body ?? ''
  return (
    <View>
      {thinking !== '' && (
        <View style={styles.thinking}>
          <Text style={styles.thinkingTitle}>{t('trajectory.kind.thinking')}</Text>
          <Markdown style={markdownStyles} rules={markdownPreviewRules}>{thinking}</Markdown>
        </View>
      )}
      {body !== '' && (
        <Markdown style={markdownStyles} rules={markdownPreviewRules}>{body}</Markdown>
      )}
    </View>
  )
}

/** 原始内容 / 参数 / 结果 / Schema — the same text, unrendered and selectable. */
function PlainPage({ text }: { text: string }): React.JSX.Element {
  return <Text style={[styles.body, styles.mono]} selectable>{text}</Text>
}

/** 计时 — one record's own clock, the Web's RecordTiming panel. */
function TimingPage({ record, t }: {
  record: TrajectoryRecord
  t: Translate
}): React.JSX.Element {
  const timing = assistantTiming(record)
  return (
    <View style={styles.facts}>
      {timing !== null
        ? <AssistantTiming timing={timing} t={t} />
        : <RecordTiming record={record} t={t} />}
    </View>
  )
}

/**
 * An answer's five timing readings, the Web's AssistantTimingPanel.
 *
 * The numbers only exist when the log recorded them: a session that kept no
 * stream has no first-token anchor, and a step still running has no completion
 * time. Each missing piece says which one it is rather than printing zero.
 */
function AssistantTiming({ timing, t }: {
  timing: AssistantTimingModel
  t: Translate
}): React.JSX.Element {
  return (
    <>
      <Fact label={t('trajectory.timing.started')} value={formatStartedAt(timing.startedAt, t)} />
      <Fact label={t('trajectory.timing.totalDuration')} value={durationLabel(timing, 'total', t)} />
      <Fact label={t('trajectory.timing.ttft')} value={durationLabel(timing, 'ttft', t)} />
      <Fact label={t('trajectory.timing.generation')} value={durationLabel(timing, 'generation', t)} />
      <Fact label={t('trajectory.timing.throughput')} value={throughputLabel(timing, t)} />
    </>
  )
}

/** A call's own clock: when it started, how long it ran, and where that came from. */
function RecordTiming({ record, t }: { record: TrajectoryRecord; t: Translate }): React.JSX.Element {
  return (
    <>
      <Fact
        label={t('trajectory.timing.started')}
        value={record.startedAt === undefined
          ? t('trajectory.timing.notAvailable')
          : formatStartedAt(record.startedAt, t)}
      />
      <Fact label={t('trajectory.timing.duration')} value={elapsedLabel(record.durationMs, t)} />
      <Fact
        label={t('trajectory.timing.source')}
        value={record.durationMs === undefined
          ? t('trajectory.timing.notAvailable')
          : t('trajectory.timing.sessionTimestamps')}
      />
    </>
  )
}

/** One label/value line of a record's own facts. */
function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} selectable>{value}</Text>
    </View>
  )
}

/** One section of the summary: an optional title that opens the full page. */
function Section({ title, onOpen, children }: {
  title: string
  onOpen?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      {onOpen === undefined
        ? <Text style={styles.sectionTitle}>{title}</Text>
        : (
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={title}
          >
            <Text style={styles.sectionTitleLink}>{title}</Text>
            <Icon name="ChevronRightOutline" size={14} color={chat.labelTertiary} />
          </TouchableOpacity>
        )}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

function StatusDot({ status }: { status: 'running' | 'done' | 'error' }): React.JSX.Element {
  const color = status === 'running' ? colors.running : status === 'error' ? colors.danger : colors.success
  return <View style={[styles.statusDot, { backgroundColor: color }]} />
}

function statusLabel(status: 'running' | 'done' | 'error', t: Translate): string {
  return status === 'running'
    ? t('trajectory.status.pending')
    : status === 'error' ? t('trajectory.status.failed') : t('trajectory.status.done')
}

/** Whether a record's body is Markdown the reader expects rendered. */
function isMarkdown(record: TrajectoryRecord): boolean {
  return record.kind === 'user'
    || record.kind === 'context'
    || record.kind === 'assistant'
    || record.kind === 'thinking'
    || record.kind === 'compacted'
    || record.kind === 'system'
}

/** Everything the raw page prints: the thinking block and the body, verbatim. */
function rawText(record: TrajectoryRecord): string {
  const thinking = record.thinking ?? ''
  const body = record.body ?? ''
  if (thinking === '') return body
  return body === '' ? thinking : `${thinking}\n\n${body}`
}

/** A JSON block as text, tolerating a source that is not an object at all. */
function jsonText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return String(value)
  }
}

/** `4556 tok` — the Web prints the count raw, without a compact suffix. */
function tokenLabel(value: number, t: Translate): string {
  return t('trajectory.unit.tokens', { value })
}

/** The Web's elapsed ladder: whole milliseconds with separators, `—` without a clock. */
function elapsedLabel(milliseconds: number | undefined, t: Translate): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return '—'
  return t('trajectory.duration.ms', { value: grouped(Math.round(milliseconds)) })
}

/**
 * The Web's duration ladder: milliseconds under a second, then seconds with
 * two decimals up to ten and one beyond — the precision the sample it prints
 * was measured at.
 */
function formatDurationMs(milliseconds: number, t: Translate): string {
  if (milliseconds < 1_000) return t('trajectory.unit.ms', { value: Math.round(milliseconds) })
  return t('trajectory.unit.seconds', {
    value: (milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1),
  })
}

/** `2026-10-08 18:07:34.706` — local time with the milliseconds the Web shows. */
function formatStartedAt(timestamp: number | null, t: Translate): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return t('trajectory.timing.notAvailable')
  const date = new Date(timestamp)
  const two = (value: number): string => String(value).padStart(2, '0')
  const three = (value: number): string => String(value).padStart(3, '0')
  const time = `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${three(date.getMilliseconds())}`
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
  return `${day} ${time}`
}

/** What an answer's timing panel reads from: the log's own clocks, or nulls. */
interface AssistantTimingModel {
  startedAt: number | null
  firstTokenTime: number | null
  completedTime: number | null
  outputTokens: number | null
}

function assistantTiming(record: TrajectoryRecord): AssistantTimingModel | null {
  if (record.kind !== 'assistant') return null
  return {
    startedAt: record.startedAt ?? null,
    firstTokenTime: record.firstTokenTime ?? null,
    completedTime: record.completedTime ?? null,
    outputTokens: record.metrics?.output ?? null,
  }
}

/**
 * One row of the timing panel.
 *
 * Each field can be missing for its own reason, and the Web names the reason:
 * no recorded start, no recorded token, or a step that has not finished yet.
 */
function durationLabel(timing: AssistantTimingModel, field: 'total' | 'ttft' | 'generation', t: Translate): string {
  if (timing.startedAt === null) return t('trajectory.timing.stepStartUnavailable')
  if (field === 'total') {
    if (timing.completedTime === null) return t('trajectory.status.pending')
    return formatDurationMs(Math.max(0, timing.completedTime - timing.startedAt), t)
  }
  if (timing.firstTokenTime === null) return t('trajectory.timing.firstTokenUnavailable')
  if (field === 'ttft') return formatDurationMs(Math.max(0, timing.firstTokenTime - timing.startedAt), t)
  // 生成 runs from the first token to the last: the decode window, not the wait.
  if (timing.completedTime === null) return t('trajectory.status.pending')
  return formatDurationMs(Math.max(0, timing.completedTime - timing.firstTokenTime), t)
}

function throughputLabel(timing: AssistantTimingModel, t: Translate): string {
  if (timing.outputTokens === null) return t('trajectory.timing.outputTokensUnavailable')
  if (timing.firstTokenTime === null) return t('trajectory.timing.firstTokenUnavailable')
  if (timing.completedTime === null) return t('trajectory.status.pending')
  const seconds = (timing.completedTime - timing.firstTokenTime) / 1_000
  if (seconds <= 0) return t('trajectory.timing.durationTooShort')
  return t('trajectory.unit.tps', { value: (timing.outputTokens / seconds).toFixed(1) })
}

/** The Web prints its durations as integer milliseconds with thousands separators. */
function grouped(milliseconds: number): string {
  return String(milliseconds).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const mono = 'monospace'

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: chat.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(3),
    paddingTop: spacing(2.5),
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backLabel: { color: colors.accent, fontSize: fontSize.body },
  heading: {
    paddingHorizontal: spacing(4),
    paddingTop: spacing(1),
    paddingBottom: spacing(2),
    gap: spacing(0.5),
  },
  headingTop: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  headingTitle: { flexShrink: 1, color: chat.labelPrimary, fontSize: fontSize.body, fontWeight: '600' },
  headingSub: { color: chat.labelTertiary, fontSize: fontSize.tiny },
  headingMeta: { marginLeft: 'auto', color: chat.labelTertiary, fontSize: fontSize.tiny },
  badge: { color: chat.labelTertiary, fontSize: fontSize.tiny, minWidth: 34 },
  index: { color: chat.labelTertiary, fontSize: fontSize.tiny, fontVariant: ['tabular-nums'] },
  childTitle: { flexShrink: 1, color: chat.labelPrimary, fontSize: fontSize.small },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  tabBar: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: chat.borderL2 },
  tabRow: { paddingHorizontal: spacing(3), gap: spacing(4) },
  tab: { alignItems: 'center', gap: spacing(1), paddingTop: spacing(1) },
  tabLabel: { color: chat.labelSecondary, fontSize: fontSize.small },
  tabLabelOn: { color: chat.labelPrimary, fontWeight: '600' },
  tabRule: { height: 2, alignSelf: 'stretch', borderRadius: 1, backgroundColor: 'transparent' },
  tabRuleOn: { backgroundColor: chat.infoFill },
  content: { paddingHorizontal: spacing(4), paddingBottom: spacing(8), paddingTop: spacing(2) },
  empty: { color: colors.textDim, fontSize: fontSize.small, paddingVertical: spacing(6), textAlign: 'center' },
  facts: { gap: spacing(1) },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(2) },
  factLabel: { width: 92, color: chat.labelTertiary, fontSize: fontSize.tiny },
  factValue: { flex: 1, color: chat.labelSecondary, fontSize: fontSize.tiny },
  section: { marginTop: spacing(3) },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing(0.5), alignSelf: 'flex-start' },
  sectionTitle: { color: chat.labelTertiary, fontSize: fontSize.tiny, fontWeight: '600' },
  sectionTitleLink: { color: chat.labelSecondary, fontSize: fontSize.tiny, fontWeight: '600' },
  sectionBody: { marginTop: spacing(1) },
  clip: { maxHeight: 190, overflow: 'hidden', borderRadius: radius.sm },
  body: { color: chat.labelSecondary, fontSize: fontSize.small, lineHeight: fontSize.small + 7 },
  mono: { fontFamily: mono },
  thinking: {
    borderLeftWidth: 2,
    borderLeftColor: chat.borderL2,
    paddingLeft: spacing(3),
    marginBottom: spacing(2),
  },
  thinkingTitle: { color: chat.labelTertiary, fontSize: fontSize.tiny, fontWeight: '600', marginBottom: spacing(1) },
  child: {
    marginTop: spacing(2),
    paddingLeft: spacing(2),
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: chat.borderL2,
  },
})
