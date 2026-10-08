/** Composer-context strips: todo plan, goal bar, usage meter, plan chip. */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { TouchableOpacity } from './Touchable'
import { billedInputTokens, formatCacheHitPercent, formatTokensPerSecond, type ContextBreakdownProjection, type SessionStatsView, type TodoItemView, type UsageView } from '@dsh-mobile/core'
import { chat, colors, fontSize, radius, shadow, spacing } from '../theme'
import { useI18n } from '../i18n'
import { Icon } from '../icons'

export function TodoStrip({ todos }: { todos: TodoItemView[] }): React.JSX.Element | null {
  const { t } = useI18n()
  if (todos.length === 0) return null
  const done = todos.filter(t => t.status === 'completed').length
  return (
    <View style={styles.strip}>
      <View style={styles.stripHead}>
        <Icon name="ChecklistOutline" size={14} color={colors.textDim} />
        <Text style={styles.stripHeadTitle}>{t('plan.todoTitle', { done, total: todos.length })}</Text>
      </View>
      {todos.map((t, i) => (
        <View key={i} style={styles.todoRow}>
          <View style={styles.todoMark}>
            {t.status === 'completed'
              ? <Icon name="CheckOutline" size={14} color={colors.textDim} />
              : t.status === 'in_progress'
                ? <Icon name="PlayOutline" size={14} color={colors.accent} />
                : <View style={styles.todoPending} />}
          </View>
          <Text style={[styles.todoText, t.status === 'completed' && styles.todoDone]} numberOfLines={1}>{t.content}</Text>
        </View>
      ))}
    </View>
  )
}

export interface GoalViewLite {
  id: string
  revision: number
  objective: string
  phase: 'active' | 'paused' | 'blocked' | 'complete'
  /** Process-local continuation eligibility from `goals/get`; absent when unread. */
  activation?: 'armed' | 'disarmed'
}

export function GoalBar({ goal, onEdit, onPause, onResume, onComplete, onClear }: {
  goal: GoalViewLite | null
  onEdit: () => void
  onPause: () => void
  onResume: () => void
  onComplete: () => void
  onClear: () => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  if (goal === null) return null
  const phaseKey = goal.phase === 'active' ? 'goal.active' : goal.phase === 'paused' ? 'goal.paused' : goal.phase === 'blocked' ? 'goal.blocked' : 'goal.complete'
  return (
    <View style={styles.strip}>
      <View style={styles.goalHeader}>
        <Text style={styles.stripTitle}>{t('goal.title', { phase: t(phaseKey) })}</Text>
        <View style={styles.goalActions}>
          {goal.phase === 'active' && <ActionText label={t('goal.pause')} onPress={onPause} />}
          {goal.phase === 'paused' && <ActionText label={t('goal.resume')} onPress={onResume} />}
          <ActionText label={t('goal.edit')} onPress={onEdit} />
          {goal.phase !== 'complete' && <ActionText label={t('goal.completeAction')} onPress={onComplete} />}
          <ActionText label={t('goal.clear')} onPress={onClear} danger />
        </View>
      </View>
      <Text style={styles.goalObjective} numberOfLines={2}>{goal.objective}</Text>
      {goal.phase === 'active' && goal.activation === 'disarmed' && (
        <Text style={styles.goalHint}>{t('goal.disarmed')}</Text>
      )}
    </View>
  )
}

function ActionText({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }): React.JSX.Element {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={6}>
      <Text style={[styles.goalAction, danger && { color: colors.danger }]}>{label}</Text>
    </TouchableOpacity>
  )
}

export function UsageBar({ usage }: { usage: UsageView | null }): React.JSX.Element | null {
  const { t } = useI18n()
  if (usage === null) return null
  const total = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0)
  if (total === 0) return null
  const k = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  return (
    <View style={styles.usageRow}>
      <Text style={styles.usageText}>
        {t('stats.usage', { input: k(usage.inputTokens), output: k(usage.outputTokens) })}
        {usage.cacheReadTokens !== undefined ? t('stats.cacheUsage', { cache: k(usage.cacheReadTokens) }) : ''}
      </Text>
    </View>
  )
}

function compactTokens(value: number): string {
  const round = (n: number): string => n < 100 ? (Math.round(n * 10) / 10).toString() : Math.round(n).toString()
  if (value < 1_000) return String(Math.round(value))
  if (value < 1_000_000) return `${round(value / 1_000)}K`
  return `${round(value / 1_000_000)}M`
}

function compactDuration(ms: number): string {
  const seconds = ms / 1_000
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** The session-statistics pill's leading mark, the web's own gauge artwork. */
function GaugeGlyph({ color, size = 14 }: { color: string; size?: number }): React.JSX.Element {
  return <Icon name="GaugeOutline" size={size} color={color} />
}

/** The web's database glyph, worn by every token-usage reading. */
export function DatabaseGlyph({ color, size = 14 }: { color: string; size?: number }): React.JSX.Element {
  return <Icon name="DatabaseOutline" size={size} color={color} />
}

/** Exact token count, grouped the way the reader's locale groups numbers. */
export function exactTokens(value: number, locale: string): string {
  return Math.round(value).toLocaleString(locale)
}

/** One row of a stat panel's definition list. */
export interface StatPanelRow {
  label: string
  value: string
  /** Route strings and any other value that must break instead of truncate. */
  wrap?: boolean
}

/**
 * The web's stat-dialog skin, shared by the composer dock's two panels and the
 * per-turn usage pill: menu surface, panel radius, prominent elevation, a
 * heading row carrying the section's glyph and headline value, a hairline rule,
 * then a two-column definition list.
 */
export function StatPanel({ title, icon, value, rows, extra }: {
  title: string
  icon: React.ReactNode
  /** The section's headline figure, right-aligned; omitted when it has none. */
  value?: string | undefined
  rows: StatPanelRow[]
  /** A trailing block under the list (the context meter's segmented bar). */
  extra?: React.ReactNode
}): React.JSX.Element {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        {icon}
        <Text style={styles.panelTitle} numberOfLines={1}>{title}</Text>
        {value !== undefined && <Text style={styles.panelValueHead}>{value}</Text>}
      </View>
      <View style={styles.panelRule} />
      {rows.map(row => (
        <View key={row.label} style={styles.panelRow}>
          <Text style={styles.panelLabel} numberOfLines={1}>{row.label}</Text>
          <Text style={[styles.panelValue, row.wrap === true && styles.panelValueWrap]}>{row.value}</Text>
        </View>
      ))}
      {extra}
    </View>
  )
}

/**
 * One stat pill: transparent at rest, tertiary 12/20 text, a 14px glyph and a
 * hover-ish fill once its panel is open. A pill without a panel stays a plain
 * reading rather than opening an empty dialog.
 */
function StatPill({ icon, label, open, onPress, accessibilityLabel }: {
  icon: React.ReactNode
  label: string
  open: boolean
  onPress?: (() => void) | undefined
  accessibilityLabel: string
}): React.JSX.Element {
  const body = (
    <>
      {icon}
      <Text style={styles.pillText} numberOfLines={1}>{label}</Text>
    </>
  )
  if (onPress === undefined) return <View style={styles.pill}>{body}</View>
  return (
    <TouchableOpacity
      style={[styles.pill, open && styles.pillOpen]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded: open }}
    >
      {body}
    </TouchableOpacity>
  )
}

/**
 * The web's composer statistics dock: two pills centred above the input card —
 * a gauge carrying the session's counts and decode speed, a database carrying
 * its billed total and cache-hit share — each opening the shared stat panel for
 * the figures that do not fit a phone's width. A pill with no rows behind it
 * stays a plain reading, exactly as the web leaves it.
 */
export function SessionStatsBar({ view }: { view: SessionStatsView | null }): React.JSX.Element | null {
  const { t, locale } = useI18n()
  const [open, setOpen] = React.useState<'time' | 'usage' | null>(null)
  if (view === null) return null
  const { stats, usage, pressure, breakdown } = view
  const billedInput = billedInputTokens(usage)
  const hasUsage = billedInput > 0 || usage.outputTokens > 0
  if (stats.steps === 0 && !hasUsage) return null

  const counts = t('stats.counts', { turns: stats.turns, steps: stats.steps })
  const speed = stats.decodeMs > 0
    ? t('stats.tokensPerSecond', { tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)) })
    : null
  // Web parity: a partial hit is never rounded up to a full one.
  const cacheHit = hasUsage ? formatCacheHitPercent(usage.cacheReadTokens, billedInput) : null
  const total = billedInput + usage.outputTokens
  const totalCompact = hasUsage ? t('stats.totalTokens', { tokens: compactTokens(total) }) : null
  const cacheText = cacheHit === null ? null : t('stats.cacheHit', { percent: cacheHit })
  const exact = (value: number): string => t('message.turnUsage.count', { count: exactTokens(value, locale) })

  /**
   * The gauge's panel: the timings behind the speed reading. The web keeps the
   * pill a plain reading when there is no timed figure, so an untimed session
   * never opens an empty dialog here either.
   */
  const timeRows: StatPanelRow[] = []
  if (stats.llmMs > 0) timeRows.push({ label: t('stats.dialog.llmTime'), value: compactDuration(stats.llmMs) })
  if (stats.toolMs > 0) timeRows.push({ label: t('stats.dialog.toolTime'), value: compactDuration(stats.toolMs) })
  if (stats.ttftSteps > 0) timeRows.push({ label: t('stats.dialog.ttft'), value: compactDuration(stats.ttftMs / stats.ttftSteps) })
  if (speed !== null) timeRows.push({ label: t('stats.dialog.speed'), value: speed })

  const usageRows: StatPanelRow[] = []
  if (cacheText !== null) usageRows.push({ label: t('message.turnUsage.cacheHit'), value: `${cacheHit}%` })
  if (hasUsage) {
    usageRows.push({ label: t('message.turnUsage.input'), value: exact(usage.uncachedInputTokens) })
    usageRows.push({ label: t('message.turnUsage.cacheRead'), value: exact(usage.cacheReadTokens) })
    if (usage.cacheWriteTokens !== 0) {
      usageRows.push({ label: t('message.turnUsage.cacheWrite'), value: exact(usage.cacheWriteTokens) })
    }
    usageRows.push({ label: t('message.turnUsage.output'), value: exact(usage.outputTokens) })
  }

  /**
   * The context meter rides the usage panel rather than a third pill: how full
   * the window is, then the host's three-way split of what fills it.
   */
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  const windowTokens = pressure?.contextWindow
  const hasContext = usedTokens !== undefined && windowTokens !== undefined && windowTokens > 0
  const contextPercent = hasContext ? Math.min(100, Math.round(usedTokens! / windowTokens! * 100)) : null
  const breakdownTotal = breakdown === null
    ? 0
    : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  const segments: { key: keyof ContextBreakdownProjection | 'total'; color: string; width: number }[] =
    breakdown === null || breakdownTotal === 0
      ? [{ key: 'total', color: colors.accent, width: contextPercent ?? 0 }]
      : (['systemTokens', 'toolsTokens', 'messageTokens'] as const).map(key => ({
          key,
          color: key === 'systemTokens' ? colors.accent : key === 'toolsTokens' ? colors.warning : colors.success,
          width: contextPercent === null ? 0 : contextPercent * breakdown[key] / breakdownTotal,
        })).filter(segment => segment.width > 0)
  if (contextPercent !== null) {
    usageRows.push({
      label: t('stats.dialog.context'),
      value: t('stats.approx', { used: compactTokens(usedTokens!), total: compactTokens(windowTokens!) }),
    })
  }
  const contextExtra = contextPercent === null
    ? undefined
    : (
      <View style={styles.contextSection}>
        <View style={styles.contextTrack}>
          {segments.map(segment => (
            <View key={segment.key} style={[styles.contextSegment, { backgroundColor: segment.color, flex: segment.width }]} />
          ))}
        </View>
        {breakdown !== null && breakdownTotal > 0 && (
          <Text style={styles.contextText} numberOfLines={2}>
            {t('stats.breakdown', {
              system: compactTokens(breakdown.systemTokens),
              tools: compactTokens(breakdown.toolsTokens),
              messages: compactTokens(breakdown.messageTokens),
            })}
          </Text>
        )}
      </View>
    )

  return (
    <View style={styles.statsDock}>
      {open === 'time' && (
        <StatPanel title={t('stats.dialog.title')} icon={<GaugeGlyph color={chat.labelTertiary} />} rows={timeRows} />
      )}
      {open === 'usage' && (
        <StatPanel
          title={t('stats.dialog.usageTitle')}
          icon={<DatabaseGlyph color={chat.labelTertiary} />}
          value={hasUsage ? exact(total) : undefined}
          rows={usageRows}
          extra={contextExtra}
        />
      )}
      <View style={styles.statsRow}>
        {stats.steps > 0 && (
          <StatPill
            icon={<GaugeGlyph color={chat.labelTertiary} />}
            label={[counts, speed].filter((part): part is string => part !== null).join(' · ')}
            open={open === 'time'}
            accessibilityLabel={t('stats.dialog.title')}
            {...timeRows.length === 0
              ? {}
              : { onPress: () => setOpen(current => current === 'time' ? null : 'time') }}
          />
        )}
        {hasUsage && (
          <StatPill
            icon={<DatabaseGlyph color={chat.labelTertiary} />}
            label={[totalCompact, cacheText].filter((part): part is string => part !== null).join(' · ')}
            open={open === 'usage'}
            accessibilityLabel={t('stats.dialog.usageTitle')}
            onPress={() => setOpen(current => current === 'usage' ? null : 'usage')}
          />
        )}
      </View>
    </View>
  )
}

export function PlanChip({ mode }: { mode: string | undefined }): React.JSX.Element | null {
  const { t } = useI18n()
  if (mode === undefined || mode === null || mode === '') return null
  return (
    <View style={styles.planChip}>
      <Text style={styles.planChipText}>{t('plan.mode', { mode })}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  strip: {
    marginHorizontal: spacing(2),
    marginBottom: spacing(2),
    borderRadius: radius.lg,
    backgroundColor: chat.menu,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chat.borderL1,
    boxShadow: shadow.panel,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  stripTitle: { color: colors.textDim, fontSize: fontSize.tiny, marginBottom: spacing(1.5) },
  stripHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), marginBottom: spacing(1.5) },
  stripHeadTitle: { color: colors.textDim, fontSize: fontSize.tiny },
  todoRow: { flexDirection: 'row', gap: spacing(2), marginTop: 2 },
  todoMark: { width: 14, alignItems: 'center', justifyContent: 'center' },
  todoPending: { width: 10, height: 10, borderWidth: 1, borderColor: colors.textDim, borderRadius: 2 },
  todoDone: { color: colors.textDim },
  todoText: { color: colors.text, fontSize: fontSize.small, flex: 1 },
  goalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalActions: { flexDirection: 'row', gap: spacing(3) },
  goalAction: { color: colors.accent, fontSize: fontSize.small },
  goalObjective: { color: colors.text, fontSize: fontSize.small, marginTop: spacing(1) },
  goalHint: { color: colors.warning, fontSize: fontSize.tiny, marginTop: spacing(0.5) },
  usageRow: { alignItems: 'flex-end', paddingHorizontal: spacing(3), paddingVertical: spacing(1) },
  usageText: { color: colors.textDim, fontSize: fontSize.tiny },
  planChip: {
    alignSelf: 'flex-start',
    marginHorizontal: spacing(3),
    marginTop: spacing(2),
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: spacing(3),
    paddingVertical: 2,
  },
  planChipText: { color: colors.accent, fontSize: fontSize.tiny },
  /** The web's dock: the pills centred with 12px between them, 4px of top pad. */
  statsDock: { alignItems: 'center', gap: 12, paddingTop: spacing(1), paddingBottom: spacing(1) },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, minWidth: 0, maxWidth: '100%' },
  /** A stat pill: transparent at rest, one tier up once its panel is open. */
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 999,
  },
  pillOpen: { backgroundColor: chat.hover },
  pillText: { color: chat.labelTertiary, fontSize: 12, lineHeight: 20, flexShrink: 1 },
  /**
   * The shared stat panel skin: menu surface, large radius and the prominent
   * elevation, a heading row with the section glyph and its headline figure,
   * then the two-column list.
   */
  panel: {
    alignSelf: 'stretch',
    backgroundColor: chat.menu,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chat.borderL1,
    boxShadow: shadow.prominent,
    padding: spacing(4),
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  panelTitle: { color: chat.labelPrimary, fontSize: 12, lineHeight: 18, fontWeight: '500', flexShrink: 1 },
  panelValueHead: { marginLeft: 'auto', color: chat.labelPrimary, fontSize: 12, lineHeight: 18, fontWeight: '500' },
  panelRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: chat.borderL2, marginBottom: 10 },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(4), paddingVertical: 3 },
  panelLabel: { color: chat.labelTertiary, fontSize: 12, lineHeight: 18, flexShrink: 0 },
  panelValue: {
    flex: 1,
    minWidth: 0,
    color: chat.labelSecondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  panelValueWrap: { textAlign: 'right' },
  contextSection: { marginTop: spacing(2) },
  contextTrack: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  contextSegment: { height: '100%' },
  contextText: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: spacing(1.5) },
})
