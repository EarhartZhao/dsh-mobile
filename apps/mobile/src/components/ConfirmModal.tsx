/**
 * Destructive-action confirmation. The repo already uses the native Alert for
 * one case, but this dialog carries multi-line consequence text that sits
 * inside the app's own dark theme, so it matches the other modals instead.
 */
import React from 'react'
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ModalBackdrop } from './ModalBackdrop'
import { colors, fontSize, radius, spacing } from '../theme'

export function ConfirmModal({ visible, title, message, confirmLabel, cancelLabel, danger = false, onCancel, onConfirm }: {
  visible: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  /** Paint the confirming button in the destructive colour. */
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <ModalBackdrop onClose={onCancel}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={styles.button}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.confirm, danger && styles.danger]}
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ModalBackdrop>
    </Modal>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bgElevated, borderRadius: radius.card, padding: spacing(4), marginHorizontal: spacing(5), gap: spacing(3) },
  title: { color: colors.text, fontSize: fontSize.body, fontWeight: '700' },
  message: { color: colors.textDim, fontSize: fontSize.small, lineHeight: 20 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(2) },
  button: { paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
  confirm: { backgroundColor: colors.accent, borderRadius: radius.card },
  danger: { backgroundColor: colors.danger },
  cancelText: { color: colors.textDim, fontSize: fontSize.body },
  confirmText: { color: '#fff', fontSize: fontSize.body, fontWeight: '600' },
})
