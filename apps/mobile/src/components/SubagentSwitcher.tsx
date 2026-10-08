/**
 * The conversation header's subagent switcher, the Web's
 * `SubagentHeaderLineage`.
 *
 * A conversation that spawned children carries one control beside its title —
 * `N 个子智能体`, or `N 个子智能体，正在运行` while any of them works. Opening it
 * lists the direct children underneath, each row carrying its state dot, its
 * label, what it is doing (`title · mode · activity`), and what it has spent
 * (`882K tok  2分31秒`). Tapping a row opens that child's conversation; a child
 * with children of its own discloses them in place, one level at a time.
 *
 * The rows themselves come from `@dsh-mobile/core`'s `subagentRows`, which reads
 * the same projections the Web's catalog does — this file owns only the shape.
 */
import React from 'react'
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { TouchableOpacity } from './Touchable'
import type { SubagentRow } from '@dsh-mobile/core'
import { chat, colors, fontSize, radius, spacing } from '../theme'
import { durationLabel, exactDurationLabel, formatTokenCount } from '../ui-labels'
import { useI18n, type TranslationKey } from '../i18n'
import { Icon } from '../icons'
import { ModalBackdrop } from './ModalBackdrop'

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

/** The trigger's own text: the Web picks between exactly these four strings. */
function triggerLabel(rows: readonly SubagentRow[], t: Translate): string {
  const running = rows.filter(row => row.activity === 'running').length
  if (running > 0) {
    return t(running === 1 ? 'subagent.countRunning.one' : 'subagent.countRunning.other', { count: running })
  }
  return t(rows.length === 1 ? 'subagent.count.one' : 'subagent.count.other', { count: rows.length })
}

function modeLabel(row: SubagentRow, t: Translate): string {
  if (row.mode === 'unknown') return t('subagent.mode.unknown')
  return row.mode === 'one-shot' ? t('subagent.mode.oneShot') : t('subagent.mode.continuable')
}

function activityLabel(row: SubagentRow, t: Translate): string {
  if (row.activity === 'running') return t('subagent.activity.running')
  return row.completed ? t('subagent.activity.completed') : t('subagent.activity.inactive')
}

/**
 * The state dot: an ongoing child rings in the running colour, a child whose
 * last turn closed normally is filled in, and anything else reads as idle —
 * the three states the Web hands its own `StateDot`.
 */
function StateDot({ row }: { row: SubagentRow }): React.JSX.Element {
  const color = row.activity === 'running'
    ? colors.running
    : row.completed ? colors.success : chat.labelCaption
  return <View style={[styles.dot, { borderColor: color }, row.completed && { backgroundColor: color }]} />
}

function SubagentRowView({ row, level, expanded, rowsOf, currentSessionId, onToggleBranch, onSwitch, now }: {
  row: SubagentRow
  level: number
  expanded: boolean
  rowsOf: (sessionId: string, now: number) => SubagentRow[]
  currentSessionId: string
  onToggleBranch: (sessionId: string) => void
  onSwitch: (sessionId: string) => void
  now: number
}): React.JSX.Element {
  const { t } = useI18n()
  const children = expanded ? rowsOf(row.id, now) : []
  const secondary = [row.title, modeLabel(row, t), activityLabel(row, t)]
    .filter(value => value !== undefined && value !== '')
    .join(' · ')
  const tokenMetric = row.tokens === undefined
    ? undefined
    : t('subagent.tokensTotal', { value: formatTokenCount(row.tokens) })
  const durationMetric = row.activeMs === undefined ? undefined : durationLabel(row.activeMs, t)
  return (
    <>
      <TouchableOpacity
        style={[styles.row, level > 0 && styles.rowNested]}
        onPress={() => onSwitch(row.id)}
        accessibilityRole="button"
        accessibilityLabel={[row.label, secondary, tokenMetric, durationMetric]
          .filter(value => value !== undefined && value !== '')
          .join(' ')}
      >
        {row.hasChildren
          ? (
            <TouchableOpacity
              style={styles.disclosure}
              onPress={() => onToggleBranch(row.id)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t(expanded ? 'subagent.collapseBranch' : 'subagent.expandBranch', { label: row.label })}
            >
              <Icon
                name={expanded ? 'ChevronDownOutline' : 'ChevronRightOutline'}
                size={12}
                color={chat.labelTertiary}
              />
            </TouchableOpacity>
          )
          : <View style={styles.disclosureSpace} />}
        <StateDot row={row} />
        <View style={styles.rowCopy}>
          <Text style={[styles.label, row.id === currentSessionId && styles.labelCurrent]} numberOfLines={1}>{row.label}</Text>
          {secondary !== '' && <Text style={styles.secondary} numberOfLines={1}>{secondary}</Text>}
        </View>
        {(tokenMetric !== undefined || durationMetric !== undefined) && (
          <View style={styles.metrics}>
            {tokenMetric !== undefined && <Text style={styles.metric} numberOfLines={1}>{tokenMetric}</Text>}
            {durationMetric !== undefined && (
              <Text
                style={styles.metric}
                numberOfLines={1}
                accessibilityLabel={t('subagent.durationTitle', { duration: exactDurationLabel(row.activeMs ?? 0, t) })}
              >
                {durationMetric}
              </Text>
            )}
          </View>
        )}
      </TouchableOpacity>
      {children.map(child => (
        <SubagentRowView
          key={child.id}
          row={child}
          level={level + 1}
          expanded={false}
          rowsOf={rowsOf}
          currentSessionId={currentSessionId}
          onToggleBranch={onToggleBranch}
          onSwitch={onSwitch}
          now={now}
        />
      ))}
    </>
  )
}

export function SubagentSwitcher({ rows, currentSessionId, open, now, rowsOf, onToggle, onClose, onSwitch }: {
  /** The parent's direct children, already derived. */
  rows: SubagentRow[]
  /** The conversation on screen, highlighted in the list. */
  currentSessionId: string
  open: boolean
  /** This render's clock, for a running child's open interval. */
  now: number
  /** One child's own children; the list discloses branches with it. */
  rowsOf: (sessionId: string, now: number) => SubagentRow[]
  onToggle: () => void
  onClose: () => void
  onSwitch: (sessionId: string) => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const [branches, setBranches] = React.useState<ReadonlySet<string>>(() => new Set())
  // A conversation with no children shows no control at all; an empty switcher
  // would be a control that opens onto nothing.
  if (rows.length === 0) return null
  const label = triggerLabel(rows, t)
  const toggleBranch = (sessionId: string): void => {
    setBranches((current) => {
      const next = new Set(current)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }
  return (
    <>
      <TouchableOpacity
        style={styles.trigger}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Icon name="PresetOutline" size={14} color={chat.labelTertiary} />
        <Text style={styles.triggerText} numberOfLines={1}>{label}</Text>
        <View style={open ? styles.triggerChevronOpen : undefined}>
          <Icon name="ChevronDownOutline" size={12} color={chat.labelTertiary} />
        </View>
      </TouchableOpacity>
      <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
        <ModalBackdrop onClose={onClose} style={styles.backdrop}>
          <View style={styles.menu}>
            <ScrollView style={styles.menuScroll} keyboardShouldPersistTaps="handled">
              {rows.map(row => (
                <SubagentRowView
                  key={row.id}
                  row={row}
                  level={0}
                  expanded={branches.has(row.id)}
                  rowsOf={rowsOf}
                  currentSessionId={currentSessionId}
                  onToggleBranch={toggleBranch}
                  onSwitch={(id) => { onClose(); onSwitch(id) }}
                  now={now}
                />
              ))}
            </ScrollView>
          </View>
        </ModalBackdrop>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  /** The Web's count pill: quiet chrome that still reads as a control. */
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chat.borderL2,
    borderRadius: radius.card,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    flexShrink: 0,
  },
  triggerText: { color: chat.labelTertiary, fontSize: fontSize.tiny },
  triggerChevronOpen: { transform: [{ rotate: '180deg' }] },
  /**
   * A dropdown, not a dialog: no scrim, anchored just under the band that
   * carries the trigger — the safe area, the title row, then the row the count
   * shares with the model.
   */
  backdrop: { backgroundColor: 'transparent', justifyContent: 'flex-start', paddingTop: 148 },
  menu: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.panel,
    marginHorizontal: spacing(3),
    maxHeight: '60%',
    paddingVertical: spacing(1),
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  menuScroll: { paddingVertical: spacing(1) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(2),
    gap: spacing(2),
  },
  rowNested: { paddingLeft: spacing(7) },
  disclosure: { width: 16, alignItems: 'center' },
  disclosureSpace: { width: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  rowCopy: { flex: 1, gap: 2 },
  label: { color: chat.labelPrimary, fontSize: fontSize.small },
  labelCurrent: { color: colors.accent },
  secondary: { color: chat.labelTertiary, fontSize: fontSize.tiny },
  metrics: { alignItems: 'flex-end', gap: 2 },
  metric: { color: chat.labelTertiary, fontSize: fontSize.tiny },
})
