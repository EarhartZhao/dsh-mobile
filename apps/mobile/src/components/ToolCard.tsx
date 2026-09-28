/**
 * Structured tool presentation, backed by the host's declarative render intents.
 *
 * The row owns the chrome — header, status, expansion, images, produced-file
 * locations and nested sub-calls — while everything a specific `card`
 * contributes comes from the registry in `../tool-cards.tsx`. That split is what
 * makes a new host card one entry plus one test, and an unknown one a readable
 * fallback instead of an empty panel.
 */
import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ConnectionManager, ConversationItem, ToolSubCall } from '@dsh-mobile/core'
import { colors, fontSize, radius, spacing } from '../theme'
import { AttachmentImage } from './AttachmentImage'
import { toolDisplayName } from '../ui-labels'
import { cardRenderer, isRecord, Mono, MonoActionRow, type Translate } from './tool-cards'
import { useI18n } from '../i18n'

function activeView(item: ConversationItem & { kind: 'tool' }): Record<string, unknown> | null {
  const view = item.status === 'running' ? item.callView : (item.resultView ?? item.callView)
  return isRecord(view) ? view : null
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

/**
 * The summary the row uses when the card has no summary facet: what the call
 * produced, else what it was asked to do, else how much it delegated.
 */
function fallbackSummary(item: ConversationItem & { kind: 'tool' }, t: Translate): string {
  if (item.resultText !== '') return shortText(item.resultText)
  if (item.args !== '') return shortText(item.args)
  if (item.subCalls.length > 0) return t('tools.subCallsCount', { count: item.subCalls.length })
  return t('tools.tapToExpand')
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
            <AttachmentImage key={image.kind === 'data' ? image.uri : image.attachmentId} image={image} manager={manager} sessionId={sessionId} style={styles.toolImage} fallbackStyle={styles.imageFallback} />
          ))}
          {call.subCalls.map(child => <SubCall key={child.callId} call={child} manager={manager} sessionId={sessionId} depth={depth + 1} />)}
        </View>
      )}
    </View>
  )
}

export function ToolCard({ item, manager, sessionId, onLongPress, bare = false }: {
  item: ConversationItem & { kind: 'tool' }
  manager: ConnectionManager
  sessionId: string
  onLongPress?: () => void
  /** Inside a turn's process block the rows are plain lines, not nested cards. */
  bare?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const statusColor = item.status === 'running' ? colors.running : item.status === 'error' ? colors.danger : colors.success
  const statusText = item.status === 'running' ? t('tools.statusRunning') : item.status === 'error' ? t('tools.statusError') : t('tools.statusDone')
  const view = activeView(item)
  // The registry is the single place a `card` decides how it looks; a miss falls
  // back to the generic entry, so an unknown tag still shows title and result.
  const card = cardRenderer(view)
  const title = (view === null ? undefined : card.title?.(view)) ?? toolDisplayName(item.name, t)
  const meta = view === null ? [] : card.meta?.(view, t) ?? []
  const summary = (view === null ? undefined : card.summary?.(view, t)) ?? fallbackSummary(item, t)
  const locations = locationLines(item)
  // `body` returning nothing means "no structure to show": fall back to the raw
  // result text, which is what a reader can act on.
  const structured = view === null ? null : card.body?.(view, { resultText: item.resultText, args: item.args, t }) ?? null
  const rawBody = item.resultText !== ''
    ? <Mono text={item.resultText} />
    : item.args !== ''
      ? <Mono text={item.args} />
      : null
  return (
    <View style={bare ? styles.cardBare : styles.card}>
      <TouchableOpacity onPress={() => setOpen(o => !o)} onLongPress={onLongPress} activeOpacity={0.8} style={styles.header}>
        <View style={styles.titleArea}>
          {/* One line while collapsed ("Bash · what it is doing"), matching the
              web's process rows; the detail below still opens in place. */}
          <Text style={styles.title} numberOfLines={open ? 2 : 1}>
            {title}
            {summary === '' ? '' : ` · ${summary}`}
          </Text>
          {open && meta.length > 0 && (
            <Text style={styles.meta} numberOfLines={1}>{meta.join(' · ')}</Text>
          )}
        </View>
        <Text style={[styles.status, { color: statusColor }]}>{statusText} {open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.body}>
          {structured ?? rawBody}
          {item.resultImages.map(image => (
            <AttachmentImage key={image.kind === 'data' ? image.uri : image.attachmentId} image={image} manager={manager} sessionId={sessionId} style={styles.toolImage} fallbackStyle={styles.imageFallback} />
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
  /** Plain row form: no card around a row that already sits in one. */
  cardBare: { marginHorizontal: spacing(1), marginVertical: 0, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), paddingHorizontal: spacing(2), paddingVertical: spacing(1.5) },
  titleArea: { flex: 1 },
  title: { color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
  meta: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: 2 },
  summary: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: 3, lineHeight: 15 },
  status: { color: colors.success, fontSize: fontSize.tiny },
  body: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, padding: spacing(2), gap: spacing(1.5) },
  mono: { color: colors.text, fontSize: 12, fontFamily: 'monospace', padding: spacing(2) },
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
