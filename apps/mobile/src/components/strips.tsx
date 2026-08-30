/** Composer-context strips: todo plan, goal bar, usage meter, plan chip. */
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Path, Svg } from 'react-native-svg'
import type { ContextBreakdownProjection, SessionStatsView, TodoItemView, UsageView } from '@dsh-mobile/core'
import { colors, fontSize, spacing } from '../theme'

export function TodoStrip({ todos }: { todos: TodoItemView[] }): React.JSX.Element | null {
  if (todos.length === 0) return null
  const done = todos.filter(t => t.status === 'completed').length
  return (
    <View style={styles.strip}>
      <Text style={styles.stripTitle}>计划 · {done}/{todos.length}</Text>
      {todos.map((t, i) => (
        <View key={i} style={styles.todoRow}>
          <Text style={[styles.todoMark, t.status === 'completed' && styles.todoDone]}>{t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '·'}</Text>
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
}

export function GoalBar({ goal, onEdit, onPause, onResume, onComplete, onClear }: {
  goal: GoalViewLite | null
  onEdit: () => void
  onPause: () => void
  onResume: () => void
  onComplete: () => void
  onClear: () => void
}): React.JSX.Element | null {
  if (goal === null) return null
  const phaseText = goal.phase === 'active' ? '进行中' : goal.phase === 'paused' ? '已暂停' : goal.phase === 'blocked' ? '受阻' : '已完成'
  return (
    <View style={styles.strip}>
      <View style={styles.goalHeader}>
        <Text style={styles.stripTitle}>目标 · {phaseText}</Text>
        <View style={styles.goalActions}>
          {goal.phase === 'active' && <ActionText label="暂停" onPress={onPause} />}
          {goal.phase === 'paused' && <ActionText label="恢复" onPress={onResume} />}
          <ActionText label="编辑" onPress={onEdit} />
          {goal.phase !== 'complete' && <ActionText label="完成" onPress={onComplete} />}
          <ActionText label="清除" onPress={onClear} danger />
        </View>
      </View>
      <Text style={styles.goalObjective} numberOfLines={2}>{goal.objective}</Text>
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
  if (usage === null) return null
  const total = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0)
  if (total === 0) return null
  const k = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  return (
    <View style={styles.usageRow}>
      <Text style={styles.usageText}>
        输入 {k(usage.inputTokens)} · 输出 {k(usage.outputTokens)}
        {usage.cacheReadTokens !== undefined ? ` · 缓存 ${k(usage.cacheReadTokens)}` : ''}
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

function StatChip({ label, emphasis }: { label: string; emphasis?: boolean }): React.JSX.Element {
  return (
    <View style={[styles.statChip, emphasis && styles.statChipEmphasis]}>
      <Text style={[styles.statChipText, emphasis && styles.statChipTextEmphasis]} numberOfLines={1}>{label}</Text>
    </View>
  )
}

function VerticalArrowGlyph({ direction }: { direction: 'up' | 'down' }): React.JSX.Element {
  return (
    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      {direction === 'up' ? <Path d="m6 15 6-6 6 6" /> : <Path d="m6 9 6 6 6-6" />}
    </Svg>
  )
}

/**
 * Mobile edition of Web's stats line/context meter. Authoritative projection
 * values are preferred; long facts are segmented so they do not truncate on
 * narrow phones.
 */
export function SessionStatsBar({ view }: { view: SessionStatsView | null }): React.JSX.Element | null {
  const [expanded, setExpanded] = React.useState(false)
  if (view === null) return null
  const { stats, usage, pressure, breakdown } = view
  const billedInput = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const hasUsage = billedInput > 0 || usage.outputTokens > 0
  const chips: { key: string; label: string; emphasis?: boolean }[] = []
  if (stats.steps > 0) {
    chips.push({ key: 'counts', label: `${stats.turns} 轮 · ${stats.steps} 步`, emphasis: true })
    if (stats.llmMs > 0) chips.push({ key: 'llm', label: `LLM ${compactDuration(stats.llmMs)}` })
    if (stats.toolMs > 0) chips.push({ key: 'tools', label: `工具调用 ${compactDuration(stats.toolMs)}` })
    if (stats.ttftSteps > 0) {
      chips.push({ key: 'ttft', label: `首 token 平均 ${compactDuration(stats.ttftMs / stats.ttftSteps)}` })
    }
    if (stats.decodeMs > 0) {
      const rate = stats.decodeTokens / (stats.decodeMs / 1_000)
      chips.push({ key: 'rate', label: `${rate < 10 ? Math.round(rate * 10) / 10 : Math.round(rate)} tok/s` })
    }
  }
  if (hasUsage && billedInput > 0) {
    chips.push({ key: 'cache', label: `缓存命中 ${Math.round(usage.cacheReadTokens / billedInput * 100)}%` })
  }
  if (hasUsage) {
    chips.push({ key: 'input', label: `输入 ${compactTokens(billedInput)} tok` })
    chips.push({ key: 'output', label: `输出 ${compactTokens(usage.outputTokens)} tok` })
  }

  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  const windowTokens = pressure?.contextWindow
  const hasContext = usedTokens !== undefined && windowTokens !== undefined && windowTokens > 0
  const contextPercent = hasContext ? Math.min(100, Math.round(usedTokens! / windowTokens! * 100)) : null
  if (chips.length === 0 && !hasContext) return null
  const contextSize = contextPercent === null ? null : `上下文 ${compactTokens(usedTokens!)} / ${compactTokens(windowTokens!)}`

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

  return (
    <View style={styles.statsCard}>
      <View style={styles.statsHeader}>
        <Text style={styles.statsTitle}>会话统计</Text>
        <TouchableOpacity
          style={styles.statsToggle}
          accessibilityRole="button"
          accessibilityLabel={expanded ? '收起会话统计' : '展开会话统计'}
          accessibilityState={{ expanded }}
          hitSlop={10}
          onPress={() => setExpanded(current => !current)}
        >
          <VerticalArrowGlyph direction={expanded ? 'down' : 'up'} />
        </TouchableOpacity>
        {contextSize === null ? <View style={styles.statsHeaderSpacer} /> : (
          <Text style={styles.contextBadge} numberOfLines={1}>{contextSize}</Text>
        )}
      </View>
      {expanded && chips.length > 0 && (
        <View style={styles.statsChips}>
          {chips.map(chip => <StatChip key={chip.key} label={chip.label} emphasis={chip.emphasis} />)}
        </View>
      )}
      {expanded && contextPercent !== null && (
        <View style={styles.contextSection}>
          <View style={styles.contextTrack}>
            {segments.map(segment => (
              <View key={segment.key} style={[styles.contextSegment, { backgroundColor: segment.color, flex: segment.width }]} />
            ))}
          </View>
          <Text style={styles.contextText} numberOfLines={1}>
            约 {compactTokens(usedTokens!)} / {compactTokens(windowTokens!)} tok
            {breakdown !== null && breakdownTotal > 0
              ? ` · 系统 ${compactTokens(breakdown.systemTokens)} · 工具 ${compactTokens(breakdown.toolsTokens)} · 消息 ${compactTokens(breakdown.messageTokens)}`
              : ''}
          </Text>
        </View>
      )}
    </View>
  )
}

export function PlanChip({ mode }: { mode: string | undefined }): React.JSX.Element | null {
  if (mode === undefined || mode === null || mode === '') return null
  return (
    <View style={styles.planChip}>
      <Text style={styles.planChipText}>计划模式 · {mode}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  strip: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  stripTitle: { color: colors.textDim, fontSize: fontSize.tiny, marginBottom: spacing(1.5) },
  todoRow: { flexDirection: 'row', gap: spacing(2), marginTop: 2 },
  todoMark: { color: colors.accent, fontSize: fontSize.small, width: 14 },
  todoDone: { color: colors.textDim },
  todoText: { color: colors.text, fontSize: fontSize.small, flex: 1 },
  goalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalActions: { flexDirection: 'row', gap: spacing(3) },
  goalAction: { color: colors.accent, fontSize: fontSize.small },
  goalObjective: { color: colors.text, fontSize: fontSize.small, marginTop: spacing(1) },
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
  statsCard: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: spacing(3),
    paddingTop: spacing(2),
    paddingBottom: spacing(2.5),
  },
  statsHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  statsTitle: { color: colors.textDim, fontSize: fontSize.tiny, fontWeight: '600', flex: 1 },
  statsToggle: { padding: spacing(1) },
  statsHeaderSpacer: { flex: 1 },
  contextBadge: { color: colors.accent, fontSize: fontSize.tiny, fontWeight: '600', flex: 1, textAlign: 'right' },
  statsChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1.5), marginTop: spacing(2) },
  statChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1),
    maxWidth: '100%',
  },
  statChipEmphasis: { borderColor: colors.accent, backgroundColor: colors.bgBubbleUser },
  statChipText: { color: colors.textDim, fontSize: fontSize.tiny },
  statChipTextEmphasis: { color: colors.text, fontWeight: '600' },
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
