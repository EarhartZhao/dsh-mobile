/** Bottom action list shared by message actions and other quick menus. */
import React from 'react'
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ModalBackdrop } from './ModalBackdrop'
import { colors, fontSize, radius, spacing } from '../theme'
import { useI18n } from '../i18n'

export interface SheetAction {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
}

export function ActionSheet({ visible, title, actions, onClose, onAction }: {
  visible: boolean
  title: string
  actions: SheetAction[]
  onClose: () => void
  onAction: (key: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ModalBackdrop onClose={onClose} style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {actions.map(action => (
              <TouchableOpacity
                key={action.key}
                style={[styles.action, action.disabled && styles.disabled]}
                disabled={action.disabled === true}
                onPress={() => onAction(action.key)}
              >
                <Text style={[styles.actionText, action.danger === true && styles.danger]} numberOfLines={1}>
                  {action.label}
                </Text>
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
    maxHeight: '45%',
    paddingBottom: spacing(3),
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: spacing(2) },
  title: { color: colors.text, fontSize: fontSize.body, fontWeight: '700', paddingHorizontal: spacing(4), paddingTop: spacing(2) },
  scroll: { flexGrow: 0 },
  content: { paddingVertical: spacing(1), paddingHorizontal: spacing(3) },
  action: { paddingVertical: spacing(3), paddingHorizontal: spacing(1) },
  disabled: { opacity: 0.35 },
  actionText: { color: colors.text, fontSize: fontSize.body },
  danger: { color: colors.danger },
  close: { alignItems: 'center', paddingVertical: spacing(2) },
  closeText: { color: colors.accent, fontSize: fontSize.small },
})
