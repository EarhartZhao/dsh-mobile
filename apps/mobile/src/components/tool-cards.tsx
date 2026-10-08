/**
 * The tool-card registry: one entry per `view.card` the host can send.
 *
 * The host owns a small, open vocabulary of render intents (`ToolCallView` /
 * `ToolResultView` in `@deepseek-ai/dsh-tools`): a call or result arrives with a
 * `card` tag plus card-specific fields, and the client maps that tag to a
 * presentation. Keeping the mapping in a table — rather than a chain of
 * `view['card'] === …` tests spread through the row — is what makes the two
 * questions a plugin-facing client has to answer explicit:
 *
 * 1. **What does an entry own?** Four facets: the header `title`, the `meta`
 *    line, the collapsed `summary`, and the expanded `body`. A card that needs
 *    only one of them declares only that one.
 * 2. **What happens on a miss?** {@link cardRenderer} falls back to the
 *    `generic` entry — *degrade, never disappear*. `card` is an open vocabulary:
 *    a newer host or a plugin can add a tag this build has never seen, and the
 *    fields the generic entry reads (`title` plus the raw result text, locations
 *    and sub-calls the row renders itself) are the ones every card family
 *    already carries. So an unknown card shows what it can, and adding a card
 *    here is one entry plus one test.
 */
import React from 'react'
import { Clipboard, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { TouchableOpacity } from './Touchable'
import { colors, fontSize, radius, spacing } from '../theme'
import { useI18n, type TranslationKey } from '../i18n'

export type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

/** One host render intent, narrowed only to the extent a renderer needs. */
export type CardView = Record<string, unknown>

/**
 * What a body renderer is given besides its view: the row's own raw text, so a
 * card that cannot render (an empty diff, a read with no lines) can yield to the
 * plain result instead of drawing an empty box.
 */
export interface CardContext {
  resultText: string
  args: string
  t: Translate
}

export interface CardPresentation {
  /** Header title; undefined keeps the caller's fallback (the tool's own label). */
  title?: (view: CardView) => string | undefined
  /** Secondary line under the title, shown while the row is open. */
  meta?: (view: CardView, t: Translate) => string[]
  /** One-line summary appended to the collapsed title. */
  summary?: (view: CardView, t: Translate) => string | undefined
  /**
   * Expanded content. `null` yields to the caller's raw-text fallback — that is
   * how a structured card with nothing in it avoids an empty panel.
   */
  body?: (view: CardView, context: CardContext) => React.ReactNode
}

export function isRecord(value: unknown): value is CardView {
  return typeof value === 'object' && value !== null
}

function text(view: CardView, key: string): string | undefined {
  const value = view[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function countMatches(view: CardView): number {
  const files = Array.isArray(view['files']) ? view['files'] : []
  return files.reduce((sum, file) =>
    sum + (isRecord(file) && Array.isArray(file['matches']) ? file.matches.length : 0), 0)
}

/** Copy and share affordances shared by every file-shaped row. */
export function MonoActionRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <TouchableOpacity onPress={() => Clipboard.setString(value)}><Text style={styles.detailAction}>{t('common.copy')}</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => { Share.share({ message: value }).catch(() => undefined) }}>
        <Text style={styles.detailAction}>{t('common.share')}</Text>
      </TouchableOpacity>
    </View>
  )
}

/** Monospace panel; `read` uses the taller cap the read card needs. */
export function Mono({ text, read = false }: { text: string; read?: boolean }): React.JSX.Element {
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

function ReadLines({ view }: { view: CardView }): React.JSX.Element | null {
  if (!Array.isArray(view['lines']) || view.lines.length === 0) return null
  const text = view.lines.filter(isRecord)
    .map(line => `${typeof line['number'] === 'number' ? String(line.number).padStart(4) : '    '}  ${typeof line['text'] === 'string' ? line.text : ''}`)
    .join('\n')
  return <Mono read text={text} />
}

function SearchHits({ view }: { view: CardView }): React.JSX.Element | null {
  if (view['shape'] === 'paths' && Array.isArray(view['paths'])) {
    const paths = view.paths.filter(path => typeof path === 'string')
    if (paths.length === 0) return null
    return (
      <View style={styles.searchList}>
        {paths.map(path => <MonoActionRow key={path} label={path} value={path} />)}
      </View>
    )
  }
  if (!Array.isArray(view['files']) || view.files.length === 0) return null
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

function WebSources({ view }: { view: CardView }): React.JSX.Element | null {
  if (view['kind'] !== 'search' || !Array.isArray(view['sources']) || view.sources.length === 0) return null
  return (
    <View style={styles.searchList}>
      {view.sources.filter(isRecord).map((source, index) => {
        const url = typeof source['url'] === 'string' ? source.url : ''
        const title = typeof source['title'] === 'string' && source.title !== '' ? source.title : url
        return (
          <View key={url || index} style={styles.webSource}>
            <TouchableOpacity onPress={() => url !== '' && Share.share({ message: url }).catch(() => undefined)}>
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

/** The exit-status pill a completed terminal card shows, when the host reported one. */
function ExitStatus({ view, t }: { view: CardView; t: Translate }): React.JSX.Element | null {
  const exitCode = typeof view['exitCode'] === 'number' ? view['exitCode'] : undefined
  const signal = text(view, 'signal')
  if (exitCode === undefined && signal === undefined) return null
  const failed = exitCode !== undefined && exitCode !== 0
  return (
    <View style={[styles.exitPill, failed && styles.exitPillFailed]}>
      <Text style={[styles.exitText, failed && styles.exitTextFailed]}>
        {signal !== undefined ? t('tools.signal', { signal }) : t('tools.exitCode', { code: exitCode ?? 0 })}
      </Text>
    </View>
  )
}

function TerminalBody({ view, context }: { view: CardView; context: CardContext }): React.ReactNode {
  const output = context.resultText !== '' ? context.resultText : context.args
  const status = <ExitStatus view={view} t={context.t} />
  if (output === '') return status
  return (
    <View style={styles.stack}>
      <Mono text={output} />
      {status}
    </View>
  )
}

/**
 * Every `card` this build renders. A `title` facet is the host's own card header
 * (`Write foo.txt`); the row falls back to the localized tool name when a card
 * does not name itself.
 */
export const CARD_REGISTRY: Record<string, CardPresentation> = {
  /**
   * The default card, and the fallback for every unknown `card` tag: a titled row
   * whose body is the raw result. `rawInput` is what the host considers the
   * salient input, but the model-facing result text is what a reader needs when a
   * card has no structure to show.
   */
  generic: {
    title: view => text(view, 'title'),
  },
  /** A shell command: cwd, captured output, and the exit status. */
  terminal: {
    title: view => text(view, 'title'),
    meta: view => {
      const cwd = text(view, 'cwd')
      return cwd === undefined ? [] : [cwd]
    },
    body: (view, context) => <TerminalBody view={view} context={context} />,
  },
  /** A file mutation: one inline diff per changed file. */
  diff: {
    title: view => text(view, 'title'),
    meta: (view, t) => Array.isArray(view['diffs']) ? [t('tools.files', { count: view.diffs.length })] : [],
    summary: (view, t) => Array.isArray(view['diffs']) && view.diffs.length > 0
      ? t('tools.files', { count: view.diffs.length })
      : undefined,
    body: view => <DiffList diffs={view['diffs']} />,
  },
  /** A file read: numbered lines with the window's start and the file's length. */
  read: {
    title: view => text(view, 'title'),
    meta: view => {
      const path = text(view, 'path')
      if (path === undefined) return []
      return [`${path}:${typeof view['offset'] === 'number' ? view['offset'] : 1}`]
    },
    summary: (view, t) => Array.isArray(view['lines']) && view.lines.length > 0
      ? t('tools.lines', { count: view.lines.length })
      : undefined,
    body: view => <ReadLines view={view} />,
  },
  /** A discovery call: grouped content matches, or a flat path list. */
  search: {
    title: view => text(view, 'title'),
    meta: (view, t) => {
      if (view['shape'] === 'paths' && Array.isArray(view['paths'])) return [t('tools.paths', { count: view.paths.length })]
      if (Array.isArray(view['files'])) return [t('tools.matches', { count: countMatches(view) })]
      return []
    },
    summary: (view, t) => {
      if (view['shape'] === 'paths' && Array.isArray(view['paths'])) return t('tools.paths', { count: view.paths.length })
      if (Array.isArray(view['files'])) return t('tools.matches', { count: countMatches(view) })
      return undefined
    },
    body: view => <SearchHits view={view} />,
  },
  /** Web retrieval: cited sources for a search, the fetched URL for a fetch. */
  web: {
    title: view => text(view, 'title'),
    meta: (view, t) => {
      if (view['kind'] === 'fetch') {
        const url = text(view, 'url')
        if (url === undefined) return []
        const status = typeof view['statusCode'] === 'number' ? view['statusCode'] : undefined
        return [status === undefined ? url : `${status} · ${url}`]
      }
      return Array.isArray(view['sources']) ? [t('tools.sources', { count: view.sources.length })] : []
    },
    summary: (view, t) => Array.isArray(view['sources']) && view.sources.length > 0
      ? t('tools.sources', { count: view.sources.length })
      : undefined,
    body: view => <WebSources view={view} />,
  },
}

/**
 * The presentation for one view, with the registry's miss rule: an unknown
 * `card` tag — a newer host's, or a plugin's — renders as `generic` so the row
 * still shows its title and raw result instead of an empty panel.
 *
 * @param view - the host's render intent, or null when the event carried none.
 * @returns the matching entry, or the generic one.
 */
export function cardRenderer(view: CardView | null): CardPresentation {
  const card = view === null ? '' : view['card']
  return (typeof card === 'string' ? CARD_REGISTRY[card] : undefined) ?? CARD_REGISTRY['generic']!
}

const styles = StyleSheet.create({
  stack: { gap: spacing(1.5) },
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
  exitPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing(1.5),
    paddingVertical: 2,
  },
  exitPillFailed: { borderColor: colors.danger },
  exitText: { color: colors.textDim, fontSize: fontSize.tiny },
  exitTextFailed: { color: colors.danger },
})
