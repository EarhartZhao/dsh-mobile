/**
 * Workspace file preview for paths the conversation already produced.
 *
 * Reads one bounded page through the plugin's `file.read` / `file.bytes`
 * mapping (dsh `workspaceFiles`), so nothing larger than the page lands in
 * memory, and offers the host hand-off verbs: open in the host's default
 * application (`host.openPath`) or reveal in its file manager (`file.reveal`).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Clipboard, Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { TouchableOpacity } from './Touchable'
import Markdown from 'react-native-markdown-display'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { NatsApiClient } from '@dsh-mobile/protocol'
import { ModalBackdrop } from './ModalBackdrop'
import { markdownPreviewRules, markdownStyles } from '../markdown'
import { fileOpener, openWithPhoneApp } from '../file-opener'
import { imageMediaTypeOf, isMarkdown, previewKindOf, relativeImageRefs } from '../file-kinds'
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
  | {
      status: 'text'
      text: string
      offset: number
      lines: number
      bytes?: number
      eof: boolean
      images: string[]
      /** Host filesystem path of the file, when the host reported one. */
      absolutePath?: string
    }
  | { status: 'image'; uri: string; absolutePath?: string }
  /** The image is larger than one phone-sized byte window; a partial render
   *  would be a broken picture, so the sheet says so instead. */
  | { status: 'tooLarge'; absolutePath?: string }
  /**
   * A document this client cannot render (PDF, Office, archive, media…). The
   * sheet says so and keeps the host hand-off actions rather than showing bytes.
   */
  | { status: 'external' }
  | { status: 'error'; message: string }

/** One cached preview plus the version that produced it. */
interface CachedPreview {
  version: string
  state: PreviewState
}

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
  /**
   * A Modal is its own window: it renders outside the app's `SafeAreaView`, so
   * nothing here is inset by default. On Android the dialog covers the status
   * bar, which used to put the title and the close control *under* the system
   * clock and battery; the reader now pays the insets itself.
   */
  const insets = useSafeAreaInsets()
  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  const canRead = features.includes('workspace-files')
  const canStat = features.includes('workspace-stat')
  /** Reuse target for unchanged files: one version probe instead of a re-read. */
  const cache = useRef(new Map<string, CachedPreview>())

  useEffect(() => {
    if (!visible || path === null || client === null) return
    if (!canRead) {
      setState({ status: 'unsupported' })
      return
    }
    let alive = true
    setState({ status: 'loading' })
    const cacheKey = `${sessionId}\u0000${path}`
    const load = async (): Promise<void> => {
      // A document this client cannot render never leaves the sheet: asking the
      // host for its bytes would only fill the screen with binary noise.
      if (previewKindOf(path) === 'binary') {
        if (alive) setState({ status: 'external' })
        return
      }
      try {
        // A cheap stat decides whether the cached page is still current; hosts
        // without the mapping answer mobile-forbidden and we just re-read.
        if (canStat) {
          const stat = await client.files.stat({ sessionId, path }).catch(() => null)
          const cached = cache.current.get(cacheKey)
          if (stat !== null && cached !== undefined && cached.version === stat.version) {
            if (alive) setState(cached.state)
            return
          }
        }
        const mediaType = imageMediaTypeOf(path)
        if (mediaType !== undefined) {
          const window = await client.files.bytes({ sessionId, path, length: MAX_IMAGE_BYTES })
          if (!alive) return
          if (!window.eof) {
            const tooLarge: PreviewState = {
              status: 'tooLarge',
              ...(typeof window.absolutePath === 'string' ? { absolutePath: window.absolutePath } : {}),
            }
            setState(tooLarge)
            return
          }
          const image: PreviewState = {
            status: 'image',
            uri: `data:${mediaType};base64,${window.data}`,
            ...(typeof window.absolutePath === 'string' ? { absolutePath: window.absolutePath } : {}),
          }
          cache.current.set(cacheKey, { version: window.version, state: image })
          setState(image)
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
        const text: PreviewState = {
          status: 'text',
          text: page.text,
          offset: page.offset,
          lines: page.lines,
          ...(page.bytes === undefined ? {} : { bytes: page.bytes }),
          eof: page.eof,
          images,
          ...(typeof page.absolutePath === 'string' ? { absolutePath: page.absolutePath } : {}),
        }
        cache.current.set(cacheKey, { version: page.version, state: text })
        setState(text)
      } catch (error: unknown) {
        if (!alive) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    }
    void load()
    return () => { alive = false }
  }, [canRead, canStat, client, path, sessionId, visible])

  /** Appends the next line page of the open text preview. */
  const loadMore = useCallback((): void => {
    if (client === null || path === null) return
    const current = state
    if (current.status !== 'text' || current.eof) return
    const cacheKey = `${sessionId}\u0000${path}`
    void client.files.read({
      sessionId, path, offset: current.offset + current.lines, limit: TEXT_LINES,
    }).then((page) => {
      setState((previous) => {
        if (previous.status !== 'text') return previous
        const next: PreviewState = {
          ...previous,
          text: page.text === '' ? previous.text : `${previous.text}\n${page.text}`,
          offset: page.offset,
          lines: previous.lines + page.lines,
          eof: page.eof,
        }
        cache.current.set(cacheKey, { version: page.version, state: next })
        return next
      })
    }).catch((error: unknown) => {
      onNotice(t('file.failed', { message: error instanceof Error ? error.message : String(error) }))
    })
  }, [client, onNotice, path, sessionId, state, t])

  const name = path === null ? '' : path.split(/[\\/]/).at(-1) ?? path

  const runHostAction = (run: () => Promise<unknown>): void => {
    void run().catch((error: unknown) => {
      onNotice(t('file.actionFailed', { message: error instanceof Error ? error.message : String(error) }))
    })
  }

  /**
   * Hand this document to a phone application: fetch its bytes over the bridge,
   * then let the native module write a cache file and fire ACTION_VIEW. The
   * button only exists where that module does (an APK built with it).
   */
  const openOnPhone = (): void => {
    if (client === null || path === null) return
    setState({ status: 'loading' })
    void openWithPhoneApp(client, sessionId, path).then(result => {
      setState({ status: 'external' })
      if (result.ok) return
      const failure = result.failure
      if (failure.kind === 'noApp') onNotice(t('file.noApp'))
      else if (failure.kind === 'tooLarge') onNotice(t('file.tooLargeForApp', { limit: `${Math.round(failure.limit / (1024 * 1024))}MB` }))
      else if (failure.kind === 'unavailable') onNotice(t('file.appUnavailable'))
      else onNotice(t('file.actionFailed', { message: failure.message }))
    })
  }

  /**
   * Deliberately without `statusBarTranslucent` / `navigationBarTranslucent`:
   * those window flags made every Text inside the dialog unselectable, so a long
   * press on the document did nothing (verified on device: with the flags on, no
   * selection toolbar ever appeared; without them it does). Android 15+ is
   * edge-to-edge anyway, and the insets below cover the system bars either way.
   */
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <ModalBackdrop onClose={onClose}>
        <View style={[styles.card, { paddingTop: insets.top + spacing(2), paddingBottom: insets.bottom + spacing(2) }]}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{name === '' ? t('file.preview') : name}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.path} numberOfLines={1}>
            {(state.status === 'text' || state.status === 'image' || state.status === 'tooLarge') && state.absolutePath !== undefined
              ? state.absolutePath
              : path ?? ''}
          </Text>
          <View style={styles.body}>
            {state.status === 'loading' && <ActivityIndicator color={colors.accent} />}
            {state.status === 'idle' && <Text style={styles.hint}>{t('common.loading')}</Text>}
            {state.status === 'unsupported' && <Text style={styles.hint}>{t('file.failed', { message: 'workspace-files' })}</Text>}
            {state.status === 'error' && <Text style={styles.hint}>{t('file.failed', { message: state.message })}</Text>}
            {state.status === 'tooLarge' && (
              <Text style={styles.hint}>{t('file.imageTooLarge', { limit: `${Math.round(MAX_IMAGE_BYTES / 1024)}KB` })}</Text>
            )}
            {state.status === 'external' && (
              <Text style={styles.hint}>{t('file.needsApp')}</Text>
            )}
            {state.status === 'image' && (
              <Image source={{ uri: state.uri }} style={styles.image} resizeMode="contain" />
            )}
            {state.status === 'text' && (
              state.text === ''
                ? <Text style={styles.hint}>{t('file.empty')}</Text>
                : isMarkdown(path ?? '') ? (
                  // A Markdown document renders with the same rules as chat, so a
                  // lecture note opened here reads like the message that cited it.
                  <ScrollView style={styles.textScroll} contentContainerStyle={styles.textContent}>
                    <Markdown style={markdownStyles} rules={markdownPreviewRules}>{state.text}</Markdown>
                  </ScrollView>
                ) : (
                  <ScrollView style={styles.textScroll} contentContainerStyle={styles.textContent}>
                    <Text style={styles.text} selectable>{state.text}</Text>
                  </ScrollView>
                )
            )}
          </View>
          {state.status === 'text' && !state.eof && (
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
            {state.status === 'external' && fileOpener() !== null && (
              <SheetAction label={t('file.openOnPhone')} onPress={openOnPhone} />
            )}
            {state.status === 'text' && !state.eof && (
              <SheetAction label={t('file.loadMore')} onPress={loadMore} />
            )}
            <SheetAction label={t('file.copyPath')} onPress={() => {
              if (path !== null) void Clipboard.setString(path)
            }} />
            {(state.status === 'text' || state.status === 'image' || state.status === 'tooLarge') && state.absolutePath !== undefined && (
              <SheetAction label={t('file.copyAbsolutePath')} onPress={() => {
                if (state.absolutePath !== undefined) void Clipboard.setString(state.absolutePath)
              }} />
            )}
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
    /**
     * Fullscreen surface: a preview is a reading view, not a dialog. The
     * vertical padding comes from the window's safe-area insets at render time.
     */
    flex: 1,
    paddingHorizontal: spacing(4),
    gap: spacing(2),
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing(2) },
  title: { flex: 1, color: colors.text, fontSize: fontSize.body, fontWeight: '600' },
  close: { color: colors.accent, fontSize: fontSize.small },
  path: { color: colors.textDim, fontSize: fontSize.tiny },
  /** The reading surface: it takes every row the header and actions leave. */
  body: { flex: 1, minHeight: spacing(12), justifyContent: 'center' },
  hint: { color: colors.textDim, fontSize: fontSize.small },
  image: { flex: 1, width: '100%' },
  textScroll: { flex: 1 },
  textContent: { paddingVertical: spacing(1) },
  text: { color: colors.text, fontSize: fontSize.tiny, fontFamily: 'monospace' },
  footerNote: { color: colors.textDim, fontSize: fontSize.tiny },
  imageStrip: { gap: spacing(1) },
  imageRow: { gap: spacing(2), alignItems: 'center' },
  relatedImage: { width: 160, height: 120, backgroundColor: colors.bg, borderRadius: radius.card },
  /**
   * The four hand-off verbs sit on one line on a phone: four CJK labels (~22
   * characters at 13pt ≈ 286dp) plus tight padding and gaps come to ~352dp,
   * inside the ~379dp a card leaves on a 411dp-wide screen. The wrap stays as a
   * safety net rather than a layout — English labels are long enough to need a
   * second line, and overflowing the card would be worse than wrapping.
   */
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing(1.5) },
  action: { paddingHorizontal: spacing(1.5), paddingVertical: spacing(2) },
  actionText: { color: colors.accent, fontSize: fontSize.small },
})
