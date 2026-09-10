/**
 * Workspace file preview for paths the conversation already produced.
 *
 * Reads one bounded page through the plugin's `file.read` / `file.bytes`
 * mapping (dsh `workspaceFiles`), so nothing larger than the page lands in
 * memory, and offers the host hand-off verbs: open in the host's default
 * application (`host.openPath`) or reveal in its file manager (`file.reveal`).
 */
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Clipboard, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { NatsApiClient } from '@dsh-mobile/protocol'
import { ModalBackdrop } from './ModalBackdrop'
import { imageMediaTypeOf, isMarkdown, relativeImageRefs } from '../file-kinds'
import { colors, fontSize, radius, spacing } from '../theme'
import { useI18n } from '../i18n'

/** Largest image window the sheet will pull over the NATS carrier. */
const MAX_IMAGE_BYTES = 512 * 1024
/** Text page size; the host caps this again on its side. */
const TEXT_LINES = 400

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unsupported' }
  | { status: 'text'; text: string; lines: number; bytes?: number; truncated: boolean; images: string[] }
  | { status: 'image'; uri: string }
  | { status: 'error'; message: string }

export function FilePreviewSheet({ visible, path, sessionId, client, features, onClose, onNotice }: {
  visible: boolean
  path: string | null
  sessionId: string
  client: NatsApiClient | null
  features: readonly string[]
  onClose: () => void
  onNotice: (message: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  const canRead = features.includes('workspace-files')

  useEffect(() => {
    if (!visible || path === null || client === null) return
    if (!canRead) {
      setState({ status: 'unsupported' })
      return
    }
    let alive = true
    setState({ status: 'loading' })
    const load = async (): Promise<void> => {
      try {
        const mediaType = imageMediaTypeOf(path)
        if (mediaType !== undefined) {
          const window = await client.files.bytes({ sessionId, path, length: MAX_IMAGE_BYTES })
          if (!alive) return
          setState({ status: 'image', uri: `data:${mediaType};base64,${window.data}` })
          return
        }
        const page = await client.files.read({ sessionId, path, limit: TEXT_LINES })
        if (!alive) return
        const images = isMarkdown(path)
          ? (await Promise.all(relativeImageRefs(page.text).map(async (relativePath) => {
            try {
              const window = await client.files.related({ sessionId, path, relativePath })
              return `data:${imageMediaTypeOf(relativePath) ?? 'application/octet-stream'};base64,${window.data}`
            } catch {
              // A missing or unreadable reference only drops that image.
              return null
            }
          }))).filter((uri): uri is string => uri !== null)
          : []
        if (!alive) return
        setState({
          status: 'text',
          text: page.text,
          lines: page.lines,
          ...(page.bytes === undefined ? {} : { bytes: page.bytes }),
          truncated: !page.eof,
          images,
        })
      } catch (error: unknown) {
        if (!alive) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    }
    void load()
    return () => { alive = false }
  }, [canRead, client, path, sessionId, visible])

  const name = path === null ? '' : path.split(/[\\/]/).at(-1) ?? path

  const runHostAction = (run: () => Promise<unknown>): void => {
    void run().catch((error: unknown) => {
      onNotice(t('file.actionFailed', { message: error instanceof Error ? error.message : String(error) }))
    })
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <ModalBackdrop onClose={onClose}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{name === '' ? t('file.preview') : name}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.path} numberOfLines={1}>{path ?? ''}</Text>
          <View style={styles.body}>
            {state.status === 'loading' && <ActivityIndicator color={colors.accent} />}
            {state.status === 'idle' && <Text style={styles.hint}>{t('common.loading')}</Text>}
            {state.status === 'unsupported' && <Text style={styles.hint}>{t('file.failed', { message: 'workspace-files' })}</Text>}
            {state.status === 'error' && <Text style={styles.hint}>{t('file.failed', { message: state.message })}</Text>}
            {state.status === 'image' && (
              <Image source={{ uri: state.uri }} style={styles.image} resizeMode="contain" />
            )}
            {state.status === 'text' && (
              state.text === ''
                ? <Text style={styles.hint}>{t('file.empty')}</Text>
                : (
                  <ScrollView style={styles.textScroll} contentContainerStyle={styles.textContent}>
                    <Text style={styles.text} selectable>{state.text}</Text>
                  </ScrollView>
                )
            )}
          </View>
          {state.status === 'text' && state.truncated && (
            <Text style={styles.footerNote}>
              {t('file.truncated', { lines: state.lines, bytes: state.bytes ?? 0 })}
            </Text>
          )}
          {state.status === 'text' && state.images.length > 0 && (
            <View style={styles.imageStrip}>
              <Text style={styles.footerNote}>{t('file.relativeImages')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imageRow}>
                {state.images.map(uri => (
                  <Image key={uri} source={{ uri }} style={styles.relatedImage} resizeMode="contain" />
                ))}
              </ScrollView>
            </View>
          )}
          <View style={styles.actions}>
            <SheetAction label={t('file.copyPath')} onPress={() => {
              if (path !== null) void Clipboard.setString(path)
            }} />
            {features.includes('open-path') && (
              <SheetAction label={t('file.openOnHost')} onPress={() => {
                if (path === null || client === null) return
                runHostAction(async () => {
                  const result = await client.host.openPath({ path } as never)
                  if (!result.result.ok) throw new Error(result.result.error.message)
                })
              }} />
            )}
            {features.includes('open-path') && (
              <SheetAction label={t('file.revealOnHost')} onPress={() => {
                if (path === null || client === null) return
                runHostAction(() => client.files.reveal({ sessionId, path }))
              }} />
            )}
          </View>
        </View>
      </ModalBackdrop>
    </Modal>
  )
}

function SheetAction({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress}>
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.card,
    marginHorizontal: spacing(3),
    padding: spacing(4),
    gap: spacing(2),
    maxHeight: '80%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing(2) },
  title: { flex: 1, color: colors.text, fontSize: fontSize.body, fontWeight: '600' },
  close: { color: colors.accent, fontSize: fontSize.small },
  path: { color: colors.textDim, fontSize: fontSize.tiny },
  body: { minHeight: spacing(12), justifyContent: 'center' },
  hint: { color: colors.textDim, fontSize: fontSize.small },
  image: { width: '100%', height: 320 },
  textScroll: { maxHeight: 360 },
  textContent: { paddingVertical: spacing(1) },
  text: { color: colors.text, fontSize: fontSize.tiny, fontFamily: 'monospace' },
  footerNote: { color: colors.textDim, fontSize: fontSize.tiny },
  imageStrip: { gap: spacing(1) },
  imageRow: { gap: spacing(2), alignItems: 'center' },
  relatedImage: { width: 160, height: 120, backgroundColor: colors.bg, borderRadius: radius.card },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing(2) },
  action: { paddingHorizontal: spacing(3), paddingVertical: spacing(2) },
  actionText: { color: colors.accent, fontSize: fontSize.small },
})
