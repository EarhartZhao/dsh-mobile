/** Structured tool presentation backed by host ToolCallView / ToolResultView. */
import React, { useEffect, useState } from 'react'
import { Clipboard, Image, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ConnectionManager, ConversationImage, ConversationItem, ToolSubCall } from '@dsh-mobile/core'
import { colors, fontSize, radius, spacing } from '../theme'
import { ImageLightbox } from './ImageLightbox'
import { toolDisplayName } from '../ui-labels'
import { useI18n, type TranslationKey } from '../i18n'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function activeView(item: ConversationItem & { kind: 'tool' }): Record<string, unknown> | null {
  const view = item.status === 'running' ? item.callView : (item.resultView ?? item.callView)
  return isRecord(view) ? view : null
}

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

function titleOf(item: ConversationItem & { kind: 'tool' }, t: Translate, fallback: string): string {
  const view = activeView(item)
  const title = view !== null && typeof view['title'] === 'string' && view['title'] !== '' ? view['title'] : undefined
  if (view?.['card'] === 'terminal' && typeof view['title'] === 'string' && view['title'] !== '') return view.title
  return title ?? fallback
}

function metaOf(item: ConversationItem & { kind: 'tool' }, t: Translate): string[] {
  const view = activeView(item)
  if (view === null) return []
  const meta: string[] = []
  if (view['card'] === 'terminal' && typeof view['cwd'] === 'string' && view['cwd'] !== '') meta.push(view.cwd)
  if (view['card'] === 'diff' && Array.isArray(view['diffs'])) meta.push(t('tools.files', { count: view.diffs.length }))
  if (view['card'] === 'read' && typeof view['path'] === 'string') {
    meta.push(`${view.path}:${typeof view['offset'] === 'number' ? view.offset : 1}`)
  }
  if (view['card'] === 'web') {
    if (view['kind'] === 'fetch' && typeof view['url'] === 'string') meta.push(`${view.statusCode} · ${view.url}`)
    if (view['kind'] === 'search' && Array.isArray(view['sources'])) meta.push(t('tools.sources', { count: view.sources.length }))
  }
  if (view['card'] === 'search') {
    if (view['shape'] === 'paths' && Array.isArray(view['paths'])) meta.push(t('tools.paths', { count: view.paths.length }))
    if (view['shape'] === 'matches' && Array.isArray(view['files'])) {
      const total = view.files.reduce((sum, file) => sum + (isRecord(file) && Array.isArray(file['matches']) ? file.matches.length : 0), 0)
      meta.push(t('tools.matches', { count: total }))
    }
  }
  return meta
}

function locationLines(item: ConversationItem & { kind: 'tool' }): string[] {
  const view = activeView(item)
  if (view === null) return []
  const locations = Array.isArray(view['locations']) ? view['locations'] : []
  return locations.filter(isRecord)
    .map(location => typeof location['path'] === 'string'
      ? `${location.path}${typeof location['line'] === 'number' ? `:${location.line}` : ''}`
      : '')
    .filter(path => path !== '')
}

function shortText(value: string, limit = 140): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= limit) return compact
  return `${compact.slice(0, limit - 1)}…`
}

function summaryOf(item: ConversationItem & { kind: 'tool' }, t: Translate): string {
  const view = activeView(item)
  if (view !== null) {
    if (view['card'] === 'read' && Array.isArray(view['lines'])) return t('tools.lines', { count: view.lines.length })
    if (view['card'] === 'diff' && Array.isArray(view['diffs'])) return t('tools.files', { count: view.diffs.length })
    if (view['card'] === 'web' && Array.isArray(view['sources'])) return t('tools.sources', { count: view.sources.length })
    if (view['card'] === 'search') {
      if (view['shape'] === 'paths' && Array.isArray(view['paths'])) return t('tools.paths', { count: view.paths.length })
      if (Array.isArray(view['files'])) {
        const total = view.files.reduce((sum, file) => sum + (isRecord(file) && Array.isArray(file['matches']) ? file.matches.length : 0), 0)
        return t('tools.matches', { count: total })
      }
    }
  }
  if (item.resultText !== '') return shortText(item.resultText)
  if (item.args !== '') return shortText(item.args)
  if (item.subCalls.length > 0) return t('tools.subCallsCount', { count: item.subCalls.length })
  return t('tools.tapToExpand')
}

function copy(value: string): void { Clipboard.setString(value) }
function share(value: string): void { void Share.share({ message: value }).catch(() => undefined) }

function MonoActionRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <TouchableOpacity onPress={() => copy(value)}><Text style={styles.detailAction}>{t('common.copy')}</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => share(value)}><Text style={styles.detailAction}>{t('common.share')}</Text></TouchableOpacity>
    </View>
  )
}

function Mono({ text, read = false }: { text: string; read?: boolean }): React.JSX.Element {
  return (
    <ScrollView style={[styles.monoScroll, read && styles.readScroll]} nestedScrollEnabled>
      <Text selectable style={[styles.mono, read && styles.read]}>{text}</Text>
    </ScrollView>
  )
}

function DiffList({ diffs }: { diffs: unknown }): React.JSX.Element | null {
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  return (
    <View style={styles.diffList}>
      {diffs.filter(isRecord).map((diff, index) => {
        const path = typeof diff['path'] === 'string' ? diff['path'] : `file-${index + 1}`
        const oldText = typeof diff['oldText'] === 'string' ? diff['oldText'] : null
        const newText = typeof diff['newText'] === 'string' ? diff['newText'] : ''
        const oldLines = oldText === null ? [] : oldText.split('\n').slice(0, 12).map(line => ({ type: 'old', line }))
        const newLines = newText.split('\n').slice(0, 12).map(line => ({ type: 'new', line }))
        return (
          <View key={`${path}:${index}`} style={styles.diff}>
            <MonoActionRow label={path} value={path} />
            {[...oldLines, ...newLines].map((part, lineIndex) => (
              <Text
                key={`${part.type}:${lineIndex}`}
                style={[styles.diffLine, part.type === 'old' ? styles.diffOld : styles.diffNew]}
                numberOfLines={1}
              >
                {part.type === 'old' ? `- ${part.line}` : `+ ${part.line}`}
              </Text>
            ))}
          </View>
        )
      })}
    </View>
  )
}

function ReadView({ view }: { view: Record<string, unknown> }): React.JSX.Element | null {
  if (!Array.isArray(view['lines']) || view.lines.length === 0) return null
  const text = view.lines.filter(isRecord)
    .map(line => `${typeof line['number'] === 'number' ? String(line.number).padStart(4) : '    '}  ${typeof line['text'] === 'string' ? line.text : ''}`)
    .join('\n')
  return <Mono read text={text} />
}

function SearchView({ view }: { view: Record<string, unknown> }): React.JSX.Element | null {
  if (view['shape'] === 'paths' && Array.isArray(view['paths'])) {
    return (
      <View style={styles.searchList}>
        {view.paths.filter(path => typeof path === 'string').map(path => (
          <MonoActionRow key={path} label={path} value={path} />
        ))}
      </View>
    )
  }
  if (!Array.isArray(view['files'])) return null
  return (
    <View style={styles.searchList}>
      {view.files.filter(isRecord).map((file, index) => {
        const path = typeof file['path'] === 'string' ? file['path'] : `file-${index + 1}`
        const lines = Array.isArray(file['matches']) ? file.matches.filter(isRecord) : []
        return (
          <View key={path} style={styles.searchGroup}>
            <MonoActionRow label={path} value={path} />
            {lines.map((line, lineIndex) => (
              <Text key={lineIndex} style={styles.searchLine} numberOfLines={2}>
                {typeof line['lineNumber'] === 'number' ? `${line.lineNumber}: ` : ''}
                {typeof line['line'] === 'string' ? line.line : ''}
              </Text>
            ))}
          </View>
        )
      })}
    </View>
  )
}

function WebView({ view }: { view: Record<string, unknown> }): React.JSX.Element | null {
  if (view['kind'] !== 'search' || !Array.isArray(view['sources'])) return null
  return (
    <View style={styles.searchList}>
      {view.sources.filter(isRecord).map((source, index) => {
        const url = typeof source['url'] === 'string' ? source.url : ''
        const title = typeof source['title'] === 'string' && source.title !== '' ? source.title : url
        return (
          <View key={url || index} style={styles.webSource}>
            <TouchableOpacity onPress={() => url !== '' && share(url)}>
              <Text style={styles.webTitle} numberOfLines={1}>{title}</Text>
              {url !== '' && <Text style={styles.webUrl} numberOfLines={1}>{url}</Text>}
            </TouchableOpacity>
            {typeof source['snippet'] === 'string' && source.snippet !== '' && (
              <Text style={styles.searchLine} numberOfLines={3}>{source.snippet}</Text>
            )}
          </View>
        )
      })}
    </View>
  )
}

function ToolImage({ image, manager, sessionId }: {
  image: ConversationImage
  manager: ConnectionManager
  sessionId: string
}): React.JSX.Element {
  const { t } = useI18n()
  const [source, setSource] = useState<string | null>(image.kind === 'data' ? image.uri : null)
  const [aspect, setAspect] = useState(4 / 3)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    if (image.kind !== 'attachment') return
    let alive = true
    void manager.client?.sessions.attachment({ sessionId, attachmentId: image.attachmentId } as never)
      .then(result => {
        if (!alive || !result.result.ok) return
        const value = result.result.value as {
          attachment: { mediaType: string; width: number; height: number }
          data: string
        }
        setSource(`data:${value.attachment.mediaType};base64,${value.data}`)
        if (value.attachment.width > 0 && value.attachment.height > 0) {
          setAspect(value.attachment.width / value.attachment.height)
        }
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [image, manager, sessionId])

  if (source === null) return <Text style={styles.imageFallback}>{t('chat.imageLoading')}</Text>
  return (
    <>
      <TouchableOpacity onPress={() => setLightboxOpen(true)}>
        <Image source={{ uri: source }} style={[styles.toolImage, { aspectRatio: aspect }]} />
      </TouchableOpacity>
      <ImageLightbox visible={lightboxOpen} source={source} name={image.name} onClose={() => setLightboxOpen(false)} />
    </>
  )
}

function SubCall({ call, manager, sessionId, depth = 0 }: {
  call: ToolSubCall
  manager: ConnectionManager
  sessionId: string
  depth?: number
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const statusColor = call.status === 'running' ? colors.running : call.status === 'error' ? colors.danger : colors.success
  return (
    <View style={[styles.subCall, depth > 0 && styles.subCallNested]}>
      <TouchableOpacity onPress={() => setOpen(o => !o)} style={styles.subCallHeader}>
          <Text style={styles.subCallName} numberOfLines={1}>{toolDisplayName(call.name, t)}</Text>
        <Text style={[styles.subCallStatus, { color: statusColor }]}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.subCallBody}>
          {call.args !== '' && <Text style={styles.mono} numberOfLines={4}>{call.args}</Text>}
          {call.resultText !== '' && <Text style={styles.subCallResult} numberOfLines={6}>{call.resultText}</Text>}
          {call.resultImages.map(image => (
            <ToolImage key={image.kind === 'data' ? image.uri : image.attachmentId} image={image} manager={manager} sessionId={sessionId} />
          ))}
          {call.subCalls.map(child => <SubCall key={child.callId} call={child} manager={manager} sessionId={sessionId} depth={depth + 1} />)}
        </View>
      )}
    </View>
  )
}

export function ToolCard({ item, manager, sessionId, onLongPress }: {
  item: ConversationItem & { kind: 'tool' }
  manager: ConnectionManager
  sessionId: string
  onLongPress?: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const statusColor = item.status === 'running' ? colors.running : item.status === 'error' ? colors.danger : colors.success
  const statusText = item.status === 'running' ? t('tools.statusRunning') : item.status === 'error' ? t('tools.statusError') : t('tools.statusDone')
  const view = activeView(item)
  const locations = locationLines(item)
  const summary = summaryOf(item, t)
  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={() => setOpen(o => !o)} onLongPress={onLongPress} activeOpacity={0.8} style={styles.header}>
        <View style={styles.titleArea}>
          <Text style={styles.title} numberOfLines={1}>{titleOf(item, t, toolDisplayName(item.name, t))}</Text>
          {metaOf(item, t).length > 0 && (
            <Text style={styles.meta} numberOfLines={1}>{metaOf(item, t).join(' · ')}</Text>
          )}
          <Text style={styles.summary} numberOfLines={2}>{summary}</Text>
        </View>
        <Text style={[styles.status, { color: statusColor }]}>{statusText} {open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.body}>
          {view?.['card'] === 'diff' && <DiffList diffs={view['diffs']} />}
          {view?.['card'] === 'read' && <ReadView view={view} />}
          {view?.['card'] === 'search' && <SearchView view={view} />}
          {view?.['card'] === 'web' && <WebView view={view} />}
          {(view === null || ['generic', 'terminal'].includes(String(view?.['card']))) && item.resultText !== '' && (
            <Mono text={item.resultText} />
          )}
          {item.resultText === '' && item.args !== '' && <Mono text={item.args} />}
          {item.resultImages.map(image => (
            <ToolImage key={image.kind === 'data' ? image.uri : image.attachmentId} image={image} manager={manager} sessionId={sessionId} />
          ))}
          {locations.length > 0 && (
            <View style={styles.locations}>
              {locations.map(path => <MonoActionRow key={path} label={path} value={path} />)}
            </View>
          )}
          {item.subCalls.length > 0 && (
            <View style={styles.subCalls}>
              <Text style={styles.sectionTitle}>{t('tools.subCalls')}</Text>
              {item.subCalls.map(call => <SubCall key={call.callId} call={call} manager={manager} sessionId={sessionId} />)}
            </View>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    backgroundColor: colors.bgElevated,
    marginHorizontal: spacing(1),
    marginVertical: spacing(0.5),
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), paddingHorizontal: spacing(2), paddingVertical: spacing(1.5) },
  titleArea: { flex: 1 },
  title: { color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
  meta: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: 2 },
  summary: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: 3, lineHeight: 15 },
  status: { color: colors.success, fontSize: fontSize.tiny },
  body: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, padding: spacing(2), gap: spacing(1.5) },
  monoScroll: { maxHeight: 180, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card },
  readScroll: { maxHeight: 280 },
  mono: { color: colors.text, fontSize: 12, fontFamily: 'monospace', padding: spacing(2) },
  read: { color: colors.textDim },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), paddingHorizontal: spacing(1) },
  detailLabel: { flex: 1, color: colors.text, fontSize: fontSize.tiny } as const,
  detailAction: { color: colors.accent, fontSize: fontSize.tiny },
  diffList: { gap: spacing(2) },
  diff: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, overflow: 'hidden' },
  diffLine: { fontSize: 11, fontFamily: 'monospace', paddingHorizontal: spacing(2), paddingVertical: 1 },
  diffOld: { color: colors.danger, backgroundColor: 'rgba(217,87,87,0.10)' },
  diffNew: { color: colors.success, backgroundColor: 'rgba(63,185,108,0.10)' },
  searchList: { gap: spacing(2) },
  searchGroup: { gap: spacing(1) },
  searchLine: { color: colors.textDim, fontSize: fontSize.tiny },
  webSource: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: spacing(1) },
  webTitle: { color: colors.text, fontSize: fontSize.small },
  webUrl: { color: colors.accent, fontSize: fontSize.tiny },
  locations: { gap: spacing(1) },
  subCalls: { gap: spacing(1) },
  sectionTitle: { color: colors.textDim, fontSize: fontSize.tiny, fontWeight: '600' },
  subCall: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: spacing(2) },
  subCallNested: { marginTop: spacing(1), marginLeft: spacing(2) },
  subCallHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  subCallName: { color: colors.text, fontSize: fontSize.tiny, flex: 1 },
  subCallStatus: { color: colors.textDim, fontSize: fontSize.tiny },
  subCallBody: { marginTop: spacing(1), gap: spacing(1) },
  subCallResult: { color: colors.textDim, fontSize: fontSize.tiny },
  toolImage: { width: '100%', maxHeight: 260, borderRadius: radius.card, backgroundColor: colors.bg },
  imageFallback: { color: colors.textDim, fontSize: fontSize.tiny, paddingVertical: spacing(1) },
})
