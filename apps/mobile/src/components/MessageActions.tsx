/**
 * The web's per-message IconActions row, seated under a message.
 *
 * The browser puts a copy control on every message, a like/dislike pair inside
 * an answer's row, a branch control on a turn tail, and a date-aware clock on
 * the side that belongs to the author (before the actions on a prompt, after
 * them on an answer). The phone has no 24×24 icon set, so the same controls are
 * short labels with the same visibility rules — and the same rule that matters
 * most here: nothing is invented client-side. Copy rides the clipboard, the
 * rating pair calls the Host's message-feedback RPC, and a branch either sends
 * the turn's real `turn/end` boundary or is shown inert while that turn is still
 * running.
 */
import React from 'react'
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { TurnBranchAnchor, TurnTokenUsage } from '@dsh-mobile/core'
import type { MobileFeedbackItem, MobileFeedbackRating } from '@dsh-mobile/protocol'
import { ModalBackdrop } from './ModalBackdrop'
import { DatabaseGlyph, StatPanel, exactTokens, type StatPanelRow } from './strips'
import { useI18n } from '../i18n'
import { chat, colors, radius, spacing } from '../theme'

/**
 * The web's message clock: `HH:mm` for today, a date plus the time once the
 * message is older — the same three-way cut (`clock.md` / `clock.ymd`) the web
 * applies, rendered with the locale's own numeric date.
 * @param time - Unix epoch ms of the message.
 * @param locale - the active locale id (`zh-CN` / `en-US`).
 * @param now - Reference instant, injectable for tests.
 * @returns the display string, or null when the message carries no time.
 */
export function messageClock(time: number, locale: string, now: number = Date.now()): string | null {
  if (!Number.isFinite(time) || time <= 0) return null
  const at = new Date(time)
  const reference = new Date(now)
  const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  if (
    at.getFullYear() === reference.getFullYear()
    && at.getMonth() === reference.getMonth()
    && at.getDate() === reference.getDate()
  ) {
    return clock
  }
  const date = at.getFullYear() === reference.getFullYear()
    ? at.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })
    : at.toLocaleDateString(locale, { year: 'numeric', month: 'numeric', day: 'numeric' })
  return `${date} ${clock}`
}

export interface MessageActionRowProps {
  /** Epoch ms of the message; a missing time simply drops the clock. */
  time: number
  /** Clock before the actions (a prompt) or after them (an answer). */
  clock: 'start' | 'end'
  /** Durable rating of this message, when one exists. */
  rating?: MobileFeedbackItem | undefined
  /** The Host serves per-message feedback for this message. */
  canRate: boolean
  /** The turn boundary this message may fork at; absent hides the control. */
  branch?: TurnBranchAnchor | undefined
  /** The turn's billed tokens; absent when it recorded none. */
  usage?: TurnTokenUsage | undefined
  onCopy: () => void
  /** A rating click: the chosen rating, or null to retract the stored one. */
  onRate: (rating: MobileFeedbackRating | null) => void
  /** A branch click; the caller decides what an inert control reports. */
  onBranch: () => void
}

export function MessageActionRow({
  time, clock, rating, canRate, branch, usage, onCopy, onRate, onBranch,
}: MessageActionRowProps): React.JSX.Element {
  const { t, locale } = useI18n()
  const [usageOpen, setUsageOpen] = React.useState(false)
  const label = messageClock(time, locale)
  const clockLabel = label === null ? null : (
    <Text style={[styles.clock, clock === 'start' && styles.clockStart]}>{label}</Text>
  )
  return (
    <View
      style={[styles.row, clock === 'start' ? styles.rowStart : styles.rowEnd]}
      accessibilityRole="toolbar"
      accessibilityLabel={t('actions.message')}
    >
      {clock === 'start' && clockLabel}
      <TouchableOpacity onPress={onCopy} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('actions.copy')}>
        <Text style={styles.action}>{t('actions.copy')}</Text>
      </TouchableOpacity>
      {canRate && (
        <>
          <TouchableOpacity
            onPress={() => onRate(rating?.rating === 'positive' ? null : 'positive')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: rating?.rating === 'positive' }}
            accessibilityLabel={t('actions.feedbackUp')}
          >
            <Text style={[styles.action, rating?.rating === 'positive' && styles.active]}>👍</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onRate(rating?.rating === 'negative' ? null : 'negative')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: rating?.rating === 'negative' }}
            accessibilityLabel={t('actions.feedbackDown')}
          >
            <Text style={[styles.action, rating?.rating === 'negative' && styles.active]}>👎</Text>
          </TouchableOpacity>
        </>
      )}
      {branch !== undefined && (
        <TouchableOpacity
          onPress={onBranch}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={branch.unavailable === true ? t('actions.branchUnavailable') : t('actions.branch')}
          accessibilityState={{ disabled: branch.unavailable === true }}
        >
          <Text style={[styles.action, branch.unavailable === true && styles.unavailable]}>
            {t('actions.branch')}
          </Text>
        </TouchableOpacity>
      )}
      {usage !== undefined && (
        <TouchableOpacity
          style={styles.usagePill}
          hitSlop={6}
          onPress={() => setUsageOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('message.turnUsage.title')}
        >
          <DatabaseGlyph color={chat.labelTertiary} />
          <Text style={styles.usageText}>
            {t('message.turnUsage.consumed', { total: usageLabel(usage) })}
          </Text>
        </TouchableOpacity>
      )}
      {clock === 'end' && clockLabel}
      {usage !== undefined && (
        <TurnUsageDialog usage={usage} visible={usageOpen} onClose={() => setUsageOpen(false)} />
      )}
    </View>
  )
}

/** The web's compact count: `12.3K`, `1.4M`, or a plain integer below 1K. */
export function usageLabel(usage: TurnTokenUsage): string {
  const round = (value: number): string =>
    value < 100 ? (Math.round(value * 10) / 10).toString() : Math.round(value).toString()
  if (usage.totalTokens < 1_000) return String(Math.round(usage.totalTokens))
  if (usage.totalTokens < 1_000_000) return `${round(usage.totalTokens / 1_000)}K`
  return `${round(usage.totalTokens / 1_000_000)}M`
}

/**
 * The web's per-turn usage dialog: the turn's own buckets, exact to the token,
 * with the cache share and the reasoning share the summary figures hide. It
 * wears the shared stat-panel skin the composer dock's pills open.
 */
function TurnUsageDialog({ usage, visible, onClose }: {
  usage: TurnTokenUsage
  visible: boolean
  onClose: () => void
}): React.JSX.Element {
  const { t, locale } = useI18n()
  const billedInput = usage.totalTokens - usage.outputTokens
  const cacheHit = billedInput > 0 ? Math.min(100, Math.round(usage.cacheReadTokens / billedInput * 1000) / 10) : null
  const count = (value: number): string => t('message.turnUsage.count', { count: exactTokens(value, locale) })
  const rows: StatPanelRow[] = []
  if (cacheHit !== null) rows.push({ label: t('message.turnUsage.cacheHit'), value: `${cacheHit}%` })
  rows.push({ label: t('message.turnUsage.input'), value: count(usage.uncachedInputTokens) })
  rows.push({ label: t('message.turnUsage.cacheRead'), value: count(usage.cacheReadTokens) })
  if (usage.cacheWriteTokens !== 0) rows.push({ label: t('message.turnUsage.cacheWrite'), value: count(usage.cacheWriteTokens) })
  rows.push({
    label: t('message.turnUsage.output'),
    value: `${count(usage.outputTokens)}${usage.reasoningTokens === undefined
      ? ''
      : t('message.turnUsage.reasoning', { tokens: count(usage.reasoningTokens) })}`,
  })
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <ModalBackdrop onClose={onClose}>
        <View style={styles.usagePanel}>
          <StatPanel
            title={t('message.turnUsage.title')}
            icon={<DatabaseGlyph color={chat.labelTertiary} />}
            value={count(usage.totalTokens)}
            rows={rows}
          />
        </View>
      </ModalBackdrop>
    </Modal>
  )
}

const styles = StyleSheet.create({
  /**
   * The web's message action row: one 28px line with 8px between its controls.
   * The prompt's clock keeps a 12px gap before the actions; the answer's row
   * keeps the web's own 16px drop and 6px optical overhang under the narration.
   */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 28,
  },
  rowStart: { justifyContent: 'flex-start' },
  rowEnd: { justifyContent: 'flex-start', marginTop: 16, marginLeft: -6 },
  action: { color: chat.labelTertiary, fontSize: 13 },
  /**
   * The turn-usage trigger: the web's 28px pill — a 15px data glyph, 4px to its
   * label, 8px of pill padding — seated with the other actions.
   */
  usagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
  },
  usageText: { color: chat.labelTertiary, fontSize: 12, lineHeight: 24 },
  /** The dialog keeps the web's 12px viewport margin around the panel. */
  usagePanel: { alignSelf: 'stretch', marginHorizontal: spacing(3) },
  active: { color: colors.accent, fontWeight: '700' },
  /** A branch control on a turn that has not closed yet: visible, inert. */
  unavailable: { opacity: 0.45 },
  clock: { color: chat.labelTertiary, fontSize: 13, lineHeight: 24 },
  clockStart: { paddingRight: 12 },
})
