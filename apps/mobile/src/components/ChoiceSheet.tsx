/**
 * One-choice bottom sheet: a flat list of named options with the current one
 * marked. The Web picks a permission preset and an agent preset from anchored
 * menus; a phone has no room beside the composer, so both open this sheet.
 */
import React from 'react'
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ModalBackdrop } from './ModalBackdrop'
import { colors, fontSize, radius, spacing } from '../theme'
import { useI18n } from '../i18n'

export interface ChoiceSheetOption {
  key: string
  label: string
  subtitle?: string
  /** Rendered in the danger tone and, for permissions, gated by a confirmation. */
  danger?: boolean
  current?: boolean
  disabled?: boolean
}

export function ChoiceSheet({ visible, title, options, onClose, onSelect }: {
  visible: boolean
  title: string
  options: ChoiceSheetOption[]
  onClose: () => void
  onSelect: (key: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ModalBackdrop onClose={onClose} style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {options.map(option => (
              <TouchableOpacity
                key={option.key}
                style={[styles.option, option.current === true && styles.optionCurrent]}
                disabled={option.disabled === true}
                onPress={() => onSelect(option.key)}
                accessibilityRole="button"
                accessibilityLabel={option.label}
              >
                <View style={styles.optionText}>
                  <Text style={[styles.optionLabel, option.danger === true && styles.danger]} numberOfLines={1}>
                    {option.label}
                  </Text>
                  {option.subtitle !== undefined && (
                    <Text style={styles.optionSubtitle} numberOfLines={2}>{option.subtitle}</Text>
                  )}
                </View>
                {option.current === true && <Text style={styles.current}>{t('common.current')}</Text>}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.close} onPress={onClose}>
            <Text style={styles.closeText}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      </ModalBackdrop>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    maxHeight: '55%',
    paddingBottom: spacing(3),
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: spacing(2) },
  title: { color: colors.text, fontSize: fontSize.body, fontWeight: '700', paddingHorizontal: spacing(4), paddingTop: spacing(2) },
  scroll: { flexGrow: 0 },
  content: { paddingVertical: spacing(1), paddingHorizontal: spacing(3), gap: spacing(1) },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing(2.5),
  },
  optionCurrent: { borderColor: colors.accent, backgroundColor: colors.bgBubbleUser },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
  optionSubtitle: { color: colors.textDim, fontSize: fontSize.tiny },
  current: { color: colors.textDim, fontSize: fontSize.tiny },
  danger: { color: colors.danger },
  close: { alignItems: 'center', paddingVertical: spacing(2) },
  closeText: { color: colors.accent, fontSize: fontSize.small },
})
