/** Full-screen image preview; the scroll container provides pinch zoom. */
import React from 'react'
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { TouchableOpacity } from './Touchable'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, fontSize, spacing } from '../theme'
import { useI18n } from '../i18n'

export function ImageLightbox({ visible, source, name, onClose }: {
  visible: boolean
  source: string
  name?: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  /** The lightbox is a Modal window of its own, so it pays the system bars itself. */
  const insets = useSafeAreaInsets()
  /**
   * A flexed image inside a ScrollView has no height to resolve against, so it
   * lays out at zero and the viewer stays black. Give the zoom content the
   * window's own box instead: the header and both bars are subtracted here.
   */
  const window = useWindowDimensions()
  const viewerHeight = Math.max(1, window.height - insets.top - insets.bottom - 64)
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
        onPress={onClose}
      >
        <View style={styles.header}>
          <Text style={styles.name} numberOfLines={1}>{name ?? t('image.preview')}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('image.closePreview')} onPress={onClose}>
          <Text style={styles.close}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.viewer}
          contentContainerStyle={styles.viewerContent}
          maximumZoomScale={5}
          minimumZoomScale={1}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          centerContent
        >
          <Image
            source={{ uri: source }}
            style={{ width: window.width, height: viewerHeight }}
            resizeMode="contain"
          />
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
  viewerContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
})
