/** Modal scrim with a press target behind the content, so blank areas close. */
import React from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

export function ModalBackdrop({ onClose, style, children }: {
  onClose: () => void
  style?: object
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <View style={[styles.backdrop, style]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel="关闭弹窗"
        onPress={onClose}
      />
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center' },
})
