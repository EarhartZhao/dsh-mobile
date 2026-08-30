/** Full-screen image preview; the scroll container provides pinch zoom. */
import React from 'react'
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { colors, fontSize, spacing } from '../theme'
import { useI18n } from '../i18n'

export function ImageLightbox({ visible, source, name, onClose }: {
  visible: boolean
  source: string
  name?: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.root} onPress={onClose}>
        <View style={styles.header}>
          <Text style={styles.name} numberOfLines={1}>{name ?? t('image.preview')}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('image.closePreview')} onPress={onClose}>
          <Text style={styles.close}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.viewer}
          maximumZoomScale={5}
          minimumZoomScale={1}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          centerContent
        >
          <Image source={{ uri: source }} style={styles.image} resizeMode="contain" />
        </ScrollView>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
  },
  name: { flex: 1, color: '#fff', fontSize: fontSize.small },
  close: { color: colors.accent, fontSize: fontSize.small },
  viewer: { flex: 1 },
  image: { flex: 1, width: '100%' },
})
