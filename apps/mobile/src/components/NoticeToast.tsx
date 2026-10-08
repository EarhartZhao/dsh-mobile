/**
 * The app's one transient notice: a card floating over whatever is on screen.
 *
 * It replaces the full-width strip the shell used to push in above the header.
 * A strip displaced the whole screen for as long as it stood — and its
 * two-line cap cut the longest failures off at exactly the point they got
 * interesting, which is how a Host error (a refusal naming the session with it)
 * became a sentence ending in an ellipsis. A card carries the same words
 * without moving anything, and any tap opens them in full.
 */
import React, { useEffect, useState } from 'react'
import { Clipboard, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../icons'
import { colors, fontSize, radius, spacing } from '../theme'
import { TouchableOpacity } from './Touchable'

/** What a notice is: a confirmation, or something that went wrong. */
export type NoticeLevel = 'info' | 'error'

interface Props {
  /** The words to show — a tool's own output can be the whole message. */
  text: string
  level: NoticeLevel
  /** The card's time ran out, or the reader closed it. */
  onDismiss: () => void
  /** The text reached the clipboard, so the shell can say so. */
  onCopied: () => void
}

/**
 * How long a card stands on its own. A failure earns longer than a
 * confirmation: "已复制" has been read by the time it is up, a refusal has not.
 */
const NOTICE_MS: Record<NoticeLevel, number> = { info: 3_000, error: 5_000 }

/**
 * How long an opened card stands: long enough to read a paragraph, and
 * restarted by every tap so a reader mid-sentence never loses it.
 */
const OPEN_MS = 5_000

/**
 * Draw the current notice.
 * @param props.text - the message.
 * @param props.level - colour and initial lifetime.
 * @param props.onDismiss - called when the card's time is up or it is closed.
 * @param props.onCopied - called after a long press copies the text.
 * @returns the floating card, with its close control once it is open.
 */
export function NoticeToast({ text, level, onDismiss, onCopied }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  /** Every tap bumps this; the countdown below depends on it, so it restarts. */
  const [taps, setTaps] = useState(0)
  /**
   * An absolutely positioned child sits against the screen edge whatever
   * padding its parent carries, so the status bar has to be stepped over here
   * by hand — otherwise the card lands under the clock and its first line is
   * the one the reader loses.
   */
  const insets = useSafeAreaInsets()
  useEffect(() => {
    const timer = setTimeout(onDismiss, open ? OPEN_MS : NOTICE_MS[level])
    return () => clearTimeout(timer)
  }, [level, onDismiss, open, taps])
  return (
    <View style={[styles.host, { top: insets.top + spacing(2) }]} pointerEvents="box-none">
      <TouchableOpacity
        accessibilityLabel="notice.toast"
        style={[styles.card, level === 'error' ? styles.cardError : styles.cardInfo]}
        // A long press copies instead of opening: the reader asked for the text
        // itself, and React Native does not also fire the press after it.
        onPress={() => { setOpen(true); setTaps(count => count + 1) }}
        onLongPress={() => { Clipboard.setString(text); onCopied() }}
      >
        <Icon
          name={level === 'error' ? 'WarningOutline' : 'CheckOutline'}
          size={16}
          color={level === 'error' ? colors.danger : colors.accent}
        />
        {open ? (
          <ScrollView style={styles.openBody} contentContainerStyle={styles.openBodyContent}>
            <Text style={styles.text}>{text}</Text>
          </ScrollView>
        ) : (
          <Text style={styles.text} numberOfLines={1} ellipsizeMode="tail">{text}</Text>
        )}
      </TouchableOpacity>
      {/**
        * The close control sits under the card rather than inside it: the card
        * is one pressable surface — tap opens, long press copies — and a button
        * within it could only compete with both.
        */}
      {open && (
        <TouchableOpacity accessibilityLabel="notice.dismiss" style={styles.close} onPress={onDismiss}>
          <Icon name="CloseOutline" size={16} color={colors.textDim} />
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  /**
   * The floating seat: clear of the safe area and of both edges, over whatever
   * screen is under it — which is what keeps a notice from displacing anything.
   */
  host: {
    position: 'absolute',
    left: spacing(4),
    right: spacing(4),
    zIndex: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2.5),
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  cardInfo: { borderColor: colors.accent },
  cardError: { borderColor: colors.danger },
  text: { flex: 1, color: colors.text, fontSize: fontSize.small, lineHeight: 18 },
  /** Opened text scrolls instead of growing over the screen. */
  openBody: { flex: 1, maxHeight: 260 },
  openBodyContent: { paddingVertical: 0 },
  close: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    marginTop: spacing(2),
    borderRadius: 16,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
})
