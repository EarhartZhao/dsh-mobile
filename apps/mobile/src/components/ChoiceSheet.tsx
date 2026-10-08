/**
 * One-choice menu: a flat list of named options with the current one marked.
 * The Web picks a permission preset and an agent preset from menus anchored to
 * the chip that owns them; a phone has no room for that row beside the draft,
 * so both drop the same floating panel the header's subagent switcher uses —
 * no scrim, panel radius, soft elevation — over the messages.
 */
import React from 'react'
import {
  Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native'
import { ModalBackdrop } from './ModalBackdrop'
import { TouchableOpacity } from './Touchable'
import { chat, colors, fontSize, radius, spacing } from '../theme'
import { Icon } from '../icons'

export interface ChoiceSheetOption {
  key: string
  label: string
  subtitle?: string
  /** Rendered in the danger tone and, for permissions, gated by a confirmation. */
  danger?: boolean
  current?: boolean
  disabled?: boolean
}

export function ChoiceSheet({ visible, title, options, anchorTop, onClose, onSelect }: {
  visible: boolean
  title: string
  options: ChoiceSheetOption[]
  /**
   * The trigger's own top edge in window space. The panel hangs off it, so it
   * clears the composer whether or not the keyboard has raised the draft.
   */
  anchorTop?: number
  onClose: () => void
  onSelect: (key: string) => void
}): React.JSX.Element {
  const { height: windowHeight } = useWindowDimensions()
  const gap = spacing(2)
  // Anchor the panel just above the chip that opened it; without a measurement
  // it still has to clear the composer band.
  const drop = anchorTop === undefined ? spacing(30) : Math.max(spacing(3), windowHeight - anchorTop + gap)
  const ceiling = anchorTop === undefined ? windowHeight * 0.6 : Math.max(160, anchorTop - spacing(16))
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ModalBackdrop onClose={onClose} style={[styles.backdrop, { paddingBottom: drop }]}>
        <View style={[styles.menu, { maxHeight: ceiling }]}>
          <Text style={styles.menuTitle} numberOfLines={1}>{title}</Text>
          <ScrollView style={styles.menuScroll} keyboardShouldPersistTaps="handled">
            {options.map(option => (
              <TouchableOpacity
                key={option.key}
                style={styles.row}
                disabled={option.disabled === true}
                onPress={() => onSelect(option.key)}
                accessibilityRole="button"
                accessibilityLabel={option.label}
              >
                <View style={styles.rowCopy}>
                  <Text
                    style={[
                      styles.label,
                      option.current === true && styles.labelCurrent,
                      option.danger === true && styles.danger,
                    ]}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                  {option.subtitle !== undefined && (
                    <Text style={styles.subtitle} numberOfLines={2}>{option.subtitle}</Text>
                  )}
                </View>
                {option.current === true && <Icon name="CheckOutline" size={14} color={colors.accent} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </ModalBackdrop>
    </Modal>
  )
}

const styles = StyleSheet.create({
  /** A dropdown, not a dialog: no scrim, and the panel clears the composer. */
  backdrop: { backgroundColor: 'transparent', justifyContent: 'flex-end' },
  menu: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.panel,
    marginHorizontal: spacing(3),
    paddingVertical: spacing(1),
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  menuTitle: {
    color: chat.labelTertiary,
    fontSize: fontSize.tiny,
    paddingHorizontal: spacing(2),
    paddingTop: spacing(1),
    paddingBottom: spacing(1),
  },
  menuScroll: { paddingVertical: spacing(1) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(2),
    gap: spacing(2),
  },
  rowCopy: { flex: 1, gap: 2 },
  label: { color: chat.labelPrimary, fontSize: fontSize.small },
  labelCurrent: { color: colors.accent },
  subtitle: { color: chat.labelTertiary, fontSize: fontSize.tiny },
  danger: { color: colors.danger },
})
