/** Composer-context strips: todo plan, goal bar, usage meter, plan chip. */
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { TodoItemView, UsageView } from '@dsh-mobile/core'
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
})
