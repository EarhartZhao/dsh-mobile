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
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { TurnBranchAnchor } from '@dsh-mobile/core'
import type { MobileFeedbackItem, MobileFeedbackRating } from '@dsh-mobile/protocol'
import { useI18n } from '../i18n'
import { colors, fontSize, spacing } from '../theme'

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
  onCopy: () => void
  /** A rating click: the chosen rating, or null to retract the stored one. */
  onRate: (rating: MobileFeedbackRating | null) => void
  /** A branch click; the caller decides what an inert control reports. */
  onBranch: () => void
}

export function MessageActionRow({
  time, clock, rating, canRate, branch, onCopy, onRate, onBranch,
}: MessageActionRowProps): React.JSX.Element {
  const { t, locale } = useI18n()
  const label = messageClock(time, locale)
  const clockLabel = label === null ? null : <Text style={styles.clock}>{label}</Text>
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
      {clock === 'end' && clockLabel}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    marginTop: spacing(1.5),
  },
  rowStart: { justifyContent: 'flex-start' },
  rowEnd: { justifyContent: 'flex-end' },
  action: { color: colors.textDim, fontSize: fontSize.tiny },
  active: { color: colors.accent, fontWeight: '700' },
  /** A branch control on a turn that has not closed yet: visible, inert. */
  unavailable: { opacity: 0.45 },
  clock: { color: colors.textDim, fontSize: fontSize.tiny },
})
