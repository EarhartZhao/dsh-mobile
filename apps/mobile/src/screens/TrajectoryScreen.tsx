/**
 * One conversation's trajectory — the Web's Trajectory view on a phone.
 *
 * The Web's own view is a table: records grouped by turn and then by message
 * and step, a duration overview over the whole log, an inspector beside the
 * rows, and a toolbar that switches the timeline's scale and folds turns and
 * calls in bulk. A phone has room for none of the table, so this is the same
 * projection laid out as a list — every turn a section header, the turn's
 * preamble under a 「消息」 group, then one group per step, in log order — with
 * the Web's own toolbar and overview above it.
 *
 * Rows do not unfold here. The Web opens the record into its inspector, and
 * the phone pushes {@link TrajectoryRecordScreen} instead, where the whole
 * record fits; the list stays a list. It reads the same log fold the transcript
 * reads and changes nothing, and it deliberately has no composer: a trajectory
 * is for reading what happened, not for asking for more.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  deriveConversation,
  groupTurns,
  type ConnectionManager,
  type Turn,
} from '@dsh-mobile/core'
import { useI18n } from '../i18n'
import { colors, chat, fontSize, spacing } from '../theme'
import { Icon } from '../icons'
import { TouchableOpacity } from '../components/Touchable'
import { TrajectoryTimeline } from '../components/TrajectoryTimeline'
import { formatTokenCount, runDurationLabel } from '../ui-labels'
import {
  deriveTrajectoryTimeline,
  projectTrajectory,
  searchTrajectory,
  type TrajectoryGroup,
  type TrajectoryRecord,
  type TrajectoryTimelineMode,
  type TrajectoryTurn,
  type Translate,
} from '../trajectory-model'

interface Props {
  manager: ConnectionManager
  sessionId: string
  onBack: () => void
  /** Open one record's own page, the phone's stand-in for the Web's inspector. */
  onOpenRecord: (index: number) => void
}

export function TrajectoryScreen({ manager, sessionId, onBack, onOpenRecord }: Props): React.JSX.Element {
  const { locale, t } = useI18n()
  const [turns, setTurns] = useState<Turn[]>([])
  const [title, setTitle] = useState('')
  /**
   * The toolbar's three switches, exactly the Web's own: 时长 scales the
   * overview by recorded durations instead of one slot per record, 轮次 folds
   * every turn body, 调用 drops the tool rows out of the ledger.
   */
  const [mode, setMode] = useState<TrajectoryTimelineMode>('sequence')
  const [collapsedTurns, setCollapsedTurns] = useState<readonly number[]>([])
  const [callsCollapsed, setCallsCollapsed] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const listRef = useRef<FlatList<Row>>(null)

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

  const model = useMemo<TrajectoryTurn[]>(() => projectTrajectory(turns, t), [turns, t])
  const timeline = useMemo(() => deriveTrajectoryTimeline(model, mode), [model, mode])
  const matches = useMemo(() => searchTrajectory(model, query), [model, query])

  const rows = useMemo<Row[]>(
    () => buildRows(model, {
      // A search answers with hits, so it also opens every turn it hits.
      collapsedTurns: matches === null ? new Set(collapsedTurns) : new Set<number>(),
      callsCollapsed: matches === null && callsCollapsed,
      matches,
    }),
    [model, collapsedTurns, callsCollapsed, matches],
  )

  /**
   * The rows as the overview sees them: a tap resolves its `#N` against this
   * after the fold it opened has already been rebuilt into the list.
   */
  const rowsRef = useRef<Row[]>(rows)
  useEffect(() => { rowsRef.current = rows }, [rows])

  const collapsibleTurns = useMemo(
    () => model.filter(turn => turn.groups.some(group => group.records.length > 0))
      .map(turn => turn.ordinal),
    [model],
  )
  const allTurnsCollapsed = collapsibleTurns.length > 0
    && collapsibleTurns.every(turn => collapsedTurns.includes(turn))

  const toggleTurn = (ordinal: number): void => {
    setCollapsedTurns(current => current.includes(ordinal)
      ? current.filter(entry => entry !== ordinal)
      : [...current, ordinal])
  }

  const toggleAllTurns = (): void => {
    setCollapsedTurns(allTurnsCollapsed ? [] : [...collapsibleTurns])
  }

  /**
   * The overview's own hop: a tap lands on a record that a folded turn — or
   * the 调用 switch — may be hiding, so the fold opens before the scroll. The
   * scroll waits a frame because the rows it lands on have not been rebuilt
   * yet when the tap returns.
   */
  const revealFromTimeline = (index: number): void => {
    const owner = model.find(turn =>
      turn.groups.some(group => group.records.some(record => record.index === index)))
    if (owner !== undefined) {
      setCollapsedTurns(current => current.filter(entry => entry !== owner.ordinal))
    }
    if (callsCollapsed) {
      const target = model.flatMap(turn => turn.groups).flatMap(group => group.records)
        .find(record => record.index === index)
      if (target !== undefined && (target.kind === 'tool' || target.kind === 'subtool')) {
        setCallsCollapsed(false)
      }
    }
    setSelected(index)
    requestAnimationFrame(() => {
      const position = rowsRef.current
        .findIndex(row => row.kind === 'record' && row.record.index === index)
      if (position < 0) return
      listRef.current?.scrollToIndex({ index: position, viewPosition: 0.4, animated: true })
    })
  }

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
        {/* The title centres in what is left between the header's two side
            slots, so the back button's width is reserved on the right as well;
            without it the title centres on the remaining box and reads shifted
            to the right. */}
        <View style={styles.sideSpacer} />
      </View>
      <Toolbar
        t={t}
        mode={mode}
        onModeChange={setMode}
        allTurnsCollapsed={allTurnsCollapsed}
        onToggleAllTurns={toggleAllTurns}
        allCallsCollapsed={callsCollapsed}
        onToggleAllCalls={() => { setCallsCollapsed(current => !current) }}
        query={query}
        onQueryChange={setQuery}
      />
      {timeline !== null && (
        <TrajectoryTimeline
          t={t}
          model={timeline}
          matchIndexes={matches}
          selectedIndex={selected}
          onSelect={revealFromTimeline}
        />
      )}
      {title !== '' && <Text style={styles.sessionTitle} numberOfLines={1}>{title}</Text>}
      {matches !== null && (
        <Text style={styles.searchCount}>
          {matches.size === 0
            ? t('trajectory.search.empty')
            : t('trajectory.search.count', { count: matches.size })}
        </Text>
      )}
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={row => row.key}
        contentContainerStyle={styles.content}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={(
          <Text style={styles.empty}>
            {matches === null ? t('trajectory.empty') : t('trajectory.search.empty')}
          </Text>
        )}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          listRef.current?.scrollToOffset({
            offset: Math.max(0, index * averageItemLength),
            animated: true,
          })
        }}
        renderItem={({ item }) => item.kind === 'turn'
          ? (
            <TurnHeader
              turn={item.turn}
              ordinal={item.ordinal}
              folded={item.folded}
              onToggle={() => toggleTurn(item.ordinal)}
              t={t}
            />
          )
          : item.kind === 'group'
            ? <GroupHeader group={item.group} />
            : (
              <RecordRow
                record={item.record}
                locale={locale}
                selected={item.record.index === selected}
                onOpen={() => { setSelected(item.record.index); onOpenRecord(item.record.index) }}
                t={t}
              />
            )}
      />
    </View>
  )
}

type Row =
  | { kind: 'turn'; key: string; turn: Turn; ordinal: number; folded: boolean }
  | { kind: 'group'; key: string; group: TrajectoryGroup }
  | { kind: 'record'; key: string; record: TrajectoryRecord }

/**
 * The rows the list shows, given the two folds and the search box.
 *
 * A folded turn keeps its header and drops its body; 调用 drops the tool rows
 * instead of shortening them, because a row here has no body of its own to
 * fold — the record page holds that. A search answers with hits, so it opens
 * whatever fold was hiding them.
 */
function buildRows(
  model: TrajectoryTurn[],
  state: {
    collapsedTurns: ReadonlySet<number>
    callsCollapsed: boolean
    matches: ReadonlySet<number> | null
  },
): Row[] {
  const rows: Row[] = []
  const { matches, callsCollapsed } = state
  for (const turn of model) {
    const folded = state.collapsedTurns.has(turn.ordinal)
    rows.push({ kind: 'turn', key: `turn:${turn.key}`, turn: turn.turn, ordinal: turn.ordinal, folded })
    if (folded) continue
    for (const group of turn.groups) {
      const visible = matches === null
        ? group.records.filter(record => !callsCollapsed || !isCall(record))
        : group.records.filter(record => matches.has(record.index))
      if (visible.length === 0) continue
      rows.push({ kind: 'group', key: `group:${turn.key}:${group.key}`, group: { ...group, records: visible } })
      for (const record of visible) {
        rows.push({ kind: 'record', key: `${turn.key}:${record.key}`, record })
      }
    }
  }
  return rows
}

/** Whether a record is one of the turn's tool calls, which 调用 folds away. */
function isCall(record: TrajectoryRecord): boolean {
  return record.kind === 'tool' || record.kind === 'subtool'
}

/**
 * The Web's toolbar: 时长 scales the overview, 轮次 and 调用 fold in bulk, and
 * the box on the right is its live ledger search.
 */
function Toolbar({
  t,
  mode,
  onModeChange,
  allTurnsCollapsed,
  onToggleAllTurns,
  allCallsCollapsed,
  onToggleAllCalls,
  query,
  onQueryChange,
}: {
  t: Translate
  mode: TrajectoryTimelineMode
  onModeChange: (mode: TrajectoryTimelineMode) => void
  allTurnsCollapsed: boolean
  onToggleAllTurns: () => void
  allCallsCollapsed: boolean
  onToggleAllCalls: () => void
  query: string
  onQueryChange: (query: string) => void
}): React.JSX.Element {
  const actualDuration = mode === 'duration'
  return (
    <View style={styles.toolbar} accessibilityRole="toolbar" accessibilityLabel={t('trajectory.toolbar.aria')}>
      <TouchableOpacity
        style={[styles.tool, actualDuration && styles.toolOn]}
        accessibilityRole="button"
        accessibilityState={{ selected: actualDuration }}
        accessibilityLabel={actualDuration
          ? t('trajectory.toolbar.useEqualWidth')
          : t('trajectory.toolbar.useActualDuration')}
        onPress={() => { onModeChange(actualDuration ? 'sequence' : 'duration') }}
      >
        <ClockGlyph color={actualDuration ? chat.infoFill : chat.labelSecondary} />
        <Text style={[styles.toolLabel, actualDuration && styles.toolLabelOn]}>
          {t('trajectory.toolbar.duration')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.tool}
        accessibilityRole="button"
        accessibilityState={{ selected: allTurnsCollapsed }}
        accessibilityLabel={allTurnsCollapsed
          ? t('trajectory.toolbar.expandTurns')
          : t('trajectory.toolbar.collapseTurns')}
        onPress={onToggleAllTurns}
      >
        <Text style={styles.toolGlyph}>{allTurnsCollapsed ? '⊞' : '⊟'}</Text>
        <Text style={styles.toolLabel}>{t('trajectory.toolbar.turns')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.tool}
        accessibilityRole="button"
        accessibilityState={{ selected: allCallsCollapsed }}
        accessibilityLabel={allCallsCollapsed
          ? t('trajectory.toolbar.expandCalls')
          : t('trajectory.toolbar.collapseCalls')}
        onPress={onToggleAllCalls}
      >
        <Text style={styles.toolGlyph}>{allCallsCollapsed ? '⊞' : '⊟'}</Text>
        <Text style={styles.toolLabel}>{t('trajectory.toolbar.calls')}</Text>
      </TouchableOpacity>
      <View style={styles.search}>
        <Icon name="SearchOutline" size={11} color={chat.labelTertiary} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={onQueryChange}
          placeholder={t('trajectory.toolbar.searchPlaceholder')}
          placeholderTextColor={chat.labelCaption}
          accessibilityLabel={t('trajectory.toolbar.search')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query !== '' && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('trajectory.toolbar.searchClear')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => { onQueryChange('') }}
          >
            <Icon name="CloseOutline" size={12} color={chat.labelTertiary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

/** The 时长 button's clock: the Web's own circle and hands, drawn inline. */
function ClockGlyph({ color }: { color: string }): React.JSX.Element {
  return (
    <View style={styles.clock}>
      <View style={[styles.clockFace, { borderColor: color }]} />
      <View style={[styles.clockHand, { backgroundColor: color }]} />
    </View>
  )
}

/**
 * The header's two side slots, in points.
 *
 * The back button needs room for its chevron and its label; the right slot is
 * the same width and holds nothing, which is what puts the title in the middle
 * of the screen rather than in the middle of the space the back button left.
 */
const HEADER_SIDE = 88

/**
 * The turn's own boundary row.
 *
 * The Web marks the same boundary with a sticky header carrying the turn's
 * status, its recorded duration and its accounting, and folds the turn's body
 * when it is pressed; the phone folds those facts into one line, because a
 * section header that wraps eats the records under it.
 */
function TurnHeader({ turn, ordinal, folded, onToggle, t }: {
  turn: Turn
  ordinal: number
  folded: boolean
  onToggle: () => void
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
    <TouchableOpacity
      style={styles.turnHeader}
      accessibilityRole="button"
      accessibilityState={{ expanded: !folded }}
      accessibilityLabel={folded
        ? t('trajectory.turn.expand')
        : t('trajectory.turn.collapse')}
      onPress={onToggle}
    >
      <Text style={styles.turnLabel}>{t('trajectory.turn', { turn: ordinal })}</Text>
      <Text style={styles.turnFacts} numberOfLines={1}>{facts.join(t('chat.step.separator'))}</Text>
      <Icon
        name={folded ? 'ChevronDownOutline' : 'ChevronUpOutline'}
        size={12}
        color={chat.labelTertiary}
      />
    </TouchableOpacity>
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
 * One record, folded to a single line.
 *
 * The chip names the record's kind, the title is what the conversation calls
 * it (a tool's own display name, a prompt's first line), the right-hand
 * reading is its status, accounting and clock, and the body is the text the
 * reader came for. Tapping opens the record's own page — the Web's inspector,
 * with room for the whole body, its labelled blocks and its sub-tools.
 */
function RecordRow({ record, locale, selected, onOpen, t }: {
  record: TrajectoryRecord
  locale: string
  selected: boolean
  onOpen: () => void
  t: Translate
}): React.JSX.Element {
  const time = record.time === 0 ? '' : new Date(record.time).toLocaleTimeString(locale, { hour12: false })
  const meta = [record.meta, time].filter(part => part !== '').join(t('chat.step.separator'))
  return (
    <TouchableOpacity
      style={[styles.record, selected && styles.recordSelected]}
      accessibilityRole="button"
      accessibilityLabel={t('trajectory.record.open')}
      onPress={onOpen}
    >
      <View style={styles.recordHead}>
        <Text style={styles.index} numberOfLines={1}>#{record.index}</Text>
        <Text style={styles.badge} numberOfLines={1}>{record.badge}</Text>
        <Text style={styles.recordTitle} numberOfLines={1}>{record.title}</Text>
        {record.status !== undefined && <StatusDot status={record.status} />}
        <Text style={styles.recordMeta} numberOfLines={1}>{meta}</Text>
        <Icon name="ChevronRightOutline" size={12} color={chat.labelCaption} />
      </View>
      {record.metrics !== undefined && <MetricsRow metrics={record.metrics} t={t} />}
      {record.preview !== '' && (
        <Text style={styles.recordBody} numberOfLines={1}>{record.preview}</Text>
      )}
    </TouchableOpacity>
  )
}

/** The Web's three message columns: 输入 / 输出 / 思考, in the order it prints them. */
function MetricsRow({ metrics, t }: {
  metrics: NonNullable<TrajectoryRecord['metrics']>
  t: Translate
}): React.JSX.Element {
  const cells = [
    ...(metrics.input === undefined ? [] : [t('trajectory.metric.input', { value: formatTokenCount(metrics.input) })]),
    ...(metrics.output === undefined ? [] : [t('trajectory.metric.output', { value: formatTokenCount(metrics.output) })]),
    ...(metrics.think === undefined ? [] : [t('trajectory.metric.think', { value: formatTokenCount(metrics.think) })]),
  ]
  if (cells.length === 0) return <View />
  return (
    <View style={styles.metrics}>
      {cells.map(cell => <Text key={cell} style={styles.metric}>{cell}</Text>)}
    </View>
  )
}

/** The Web's record status: a coloured dot, not a second word. */
function StatusDot({ status }: { status: 'running' | 'done' | 'error' }): React.JSX.Element {
  const color = status === 'running' ? colors.running : status === 'error' ? colors.danger : colors.success
  return <View style={[styles.statusDot, { backgroundColor: color }]} />
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: chat.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.5),
    gap: spacing(2),
  },
  back: { flexDirection: 'row', alignItems: 'center', width: HEADER_SIDE, gap: 2 },
  backLabel: { color: colors.accent, fontSize: fontSize.body },
  title: { flex: 1, color: colors.text, fontSize: fontSize.body, fontWeight: '600', textAlign: 'center' },
  sideSpacer: { width: HEADER_SIDE },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    paddingHorizontal: spacing(3),
    paddingBottom: spacing(1.5),
  },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1),
    borderRadius: 6,
  },
  toolOn: { backgroundColor: chat.hover },
  toolGlyph: { color: chat.labelSecondary, fontSize: 11, lineHeight: 13 },
  toolLabel: { color: chat.labelSecondary, fontSize: fontSize.tiny },
  toolLabelOn: { color: chat.infoFill },
  clock: { width: 11, height: 11 },
  clockFace: {
    position: 'absolute',
    left: 0.5,
    top: 0.5,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
  },
  clockHand: { position: 'absolute', width: 1, height: 3, top: 2.5, left: 5 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    height: 28,
    paddingHorizontal: spacing(2),
    borderRadius: 14,
    backgroundColor: chat.hover,
  },
  /**
   * The pill is a fixed 28 points tall, and the input fills it.
   *
   * Android lays a single-line input's text out from the top of its box and
   * pads the font's ascent asymmetrically, so the placeholder rode high in the
   * pill while the magnifier beside it sat on the middle line. Centring the
   * text vertically and dropping the font padding puts both on the same line.
   */
  searchInput: {
    flex: 1,
    height: 28,
    padding: 0,
    paddingVertical: 0,
    color: chat.labelPrimary,
    fontSize: fontSize.tiny,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  sessionTitle: {
    paddingHorizontal: spacing(4),
    paddingBottom: spacing(1),
    color: chat.labelTertiary,
    fontSize: fontSize.tiny,
  },
  searchCount: {
    paddingHorizontal: spacing(4),
    paddingBottom: spacing(1),
    color: chat.labelTertiary,
    fontSize: fontSize.tiny,
  },
  list: { flex: 1 },
  content: { paddingHorizontal: spacing(4), paddingBottom: spacing(6) },
  empty: { color: colors.textDim, fontSize: fontSize.small, paddingVertical: spacing(6), textAlign: 'center' },
  turnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    marginTop: spacing(4),
    marginBottom: spacing(1.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chat.borderL2,
    paddingBottom: spacing(1.5),
  },
  turnLabel: { color: chat.labelPrimary, fontSize: fontSize.small, fontWeight: '600' },
  turnFacts: { flex: 1, color: chat.labelTertiary, fontSize: fontSize.tiny },
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
  record: {
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1.5),
    borderRadius: 6,
  },
  recordSelected: { backgroundColor: chat.hover },
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
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(0.5), marginLeft: 60 },
  metric: { color: chat.labelTertiary, fontSize: fontSize.tiny, fontVariant: ['tabular-nums'] },
  recordBody: {
    marginTop: spacing(0.5),
    marginLeft: 60,
    color: chat.labelSecondary,
    fontSize: fontSize.tiny,
    lineHeight: fontSize.tiny + 6,
  },
})
