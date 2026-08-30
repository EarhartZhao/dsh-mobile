/** Small text-prompt modal (RN has no cross-platform Alert.prompt). */
import React, { useEffect, useState } from 'react'
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ModalBackdrop } from './ModalBackdrop'
import { colors, fontSize, radius, spacing } from '../theme'

export function PromptModal({ visible, title, initial, confirmLabel, onCancel, onConfirm }: {
  visible: boolean
  title: string
  initial: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: (text: string) => void
}): React.JSX.Element {
  const [text, setText] = useState(initial)
  useEffect(() => { if (visible) setText(initial) }, [visible, initial])
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <ModalBackdrop onClose={onCancel}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput style={styles.input} value={text} onChangeText={setText} autoFocus selectTextOnFocus />
          <View style={styles.row}>
            <TouchableOpacity style={styles.button} onPress={onCancel}><Text style={styles.cancelText}>取消</Text></TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.confirm, text.trim() === '' && styles.disabled]}
              disabled={text.trim() === ''}
              onPress={() => onConfirm(text.trim())}
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
  card: { backgroundColor: colors.bgElevated, borderRadius: radius.card, padding: spacing(4), gap: spacing(3) },
  title: { color: colors.text, fontSize: fontSize.body, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    color: colors.text,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    fontSize: fontSize.body,
  },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(3) },
  button: { paddingHorizontal: spacing(4), paddingVertical: spacing(2) },
  confirm: { backgroundColor: colors.accent, borderRadius: radius.card },
  disabled: { opacity: 0.4 },
  cancelText: { color: colors.textDim, fontSize: fontSize.body },
  confirmText: { color: '#fff', fontSize: fontSize.body, fontWeight: '600' },
})
