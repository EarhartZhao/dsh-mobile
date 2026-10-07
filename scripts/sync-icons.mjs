/**
 * Vendor the dsh product icons the mobile chat draws with.
 *
 * The App renders the very same artwork the browser does instead of an
 * approximation of it: this reads the harness icon module
 * (`packages/client/ui-primitives/src/icons`) and writes `apps/mobile/src/
 * icons.tsx` with each glyph's path data copied verbatim, so a `d` change
 * upstream is a re-run rather than a hand edit. Only the element shape is
 * translated, because the web's components emit `<svg>` and the phone draws
 * with `react-native-svg`.
 *
 * Usage:
 *   node scripts/sync-icons.mjs [--check]
 *
 * `DSH_HARNESS` overrides the harness checkout (default `../deepseek-harness`).
 * `--check` compares instead of writing, so a stale copy can fail a review
 * without touching the tree.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = resolve(process.env.DSH_HARNESS ?? join(repoRoot, '..', 'deepseek-harness'))
const iconDir = join(harnessRoot, 'packages', 'client', 'ui-primitives', 'src', 'icons')
const outputPath = join(repoRoot, 'apps', 'mobile', 'src', 'icons.tsx')
const inputBarPath = join(
  harnessRoot, 'packages', 'client', 'ui-conversation', 'src', 'client', 'skeleton', 'InputBar.tsx',
)

// The harness is a sibling checkout, not a dependency: a machine without it
// (CI, a fresh clone) skips the sync instead of failing every install. Set
// `DSH_HARNESS` to point at one elsewhere.
if (!existsSync(join(iconDir, 'index.tsx'))) {
  console.log(`[sync-icons] no harness checkout at ${harnessRoot}; skipping`)
  process.exit(0)
}

/**
 * The glyphs the chat surface draws, keyed by the name the App imports. The
 * export listed is the web component whose artwork is copied, and the comment
 * names where the web itself uses it so a reviewer can check the pairing.
 */
const GLYPHS = {
  SearchOutline: { export: 'IconSearchOutlineRegular', note: 'header search' },
  EllipsisOutline: { export: 'IconEllipsisOutlineRegular', note: 'header overflow' },
  PlusOutlineMedium: { export: 'IconPlusOutlineMedium', note: 'composer attach, new session' },
  CloseOutline: { export: 'IconCloseOutlineRegular', note: 'chip and draft removal' },
  CheckOutline: { export: 'IconCheckOutlineRegular', note: 'copied state, settings rows' },
  ChevronDownOutline: { export: 'IconChevronDownOutlineRegular', note: 'turn disclosure, to-bottom' },
  ChevronUpOutline: { export: 'IconChevronUpOutlineRegular', note: 'open disclosure' },
  ChevronLeftOutline: { export: 'IconChevronLeftOutlineRegular', note: 'header back' },
  ChevronRightOutline: { export: 'IconChevronRightOutlineRegular', note: 'settings rows' },
  CopyOutline: { export: 'IconCopyOutlineRegular', note: 'message copy' },
  BranchOutline: { export: 'IconBranchOutlineRegular', note: 'message branch' },
  LikeOutline: { export: 'IconLikeOutlineRegular', note: 'message rating' },
  LikeFill: { export: 'IconLikeFillRegular', note: 'recorded rating' },
  DislikeOutline: { export: 'IconDislikeOutlineRegular', note: 'message rating' },
  DislikeFill: { export: 'IconDislikeFillRegular', note: 'recorded rating' },
  DatabaseOutline: { export: 'IconDatabaseOutlineRegular', note: 'usage pill, token stats' },
  GaugeOutline: { export: 'IconGaugeOutlineRegular', note: 'step and speed stats' },
  ThinkOutline: { export: 'IconThinkOutlineRegular', note: 'reasoning row leading' },
  BrowseOutline: { export: 'IconBrowseOutlineRegular', note: 'read-family tool rows' },
  EditOutline: { export: 'IconEditOutlineRegular', note: 'write/edit tool rows, queue edit' },
  CodeOutline: { export: 'IconCodeOutlineRegular', note: 'code tool rows' },
  ApiOutline: { export: 'IconApiOutlineRegular', note: 'bash/API tool rows' },
  SparkleRegular: { export: 'IconSparkleRegular', note: 'other tool rows' },
  ChecklistOutline: { export: 'IconChecklistOutlineRegular', note: 'todo rows' },
  PlayOutline: { export: 'IconPlayOutlineRegular', note: 'in-progress todo item' },
  QuestionOutline: { export: 'IconQuestionOutlineRegular', note: 'question rows' },
  PlanOutline: { export: 'IconPlanOutlineRegular', note: 'plan mode chip' },
  GoalOutline: { export: 'IconGoalOutlineRegular', note: 'goal bar' },
  QueueOutline: { export: 'IconQueueOutlineRegular', note: 'queue dock' },
  TrashOutline: { export: 'IconTrashOutlineRegular', note: 'queue removal' },
  SendOutline: { export: 'IconSendOutlineRegular', note: 'queue steering' },
  WarningOutline: { export: 'IconWarningOutlineRegular', note: 'notices and failures' },
  RefreshOutline: { export: 'IconRefreshOutlineRegular', note: 'retry controls' },
  ContextInjectionOutline: { export: 'IconContextInjectionOutlineRegular', note: '@ reference chips' },
  ShareOutline: { export: 'IconShareOutlineRegular', note: 'code block share' },
  SettingsOutline: { export: 'IconSettingsOutlineRegular', note: 'session list settings' },
  PresetOutline: { export: 'IconAgentPresetOutlineRegular', note: 'subagent switcher and subagent rows' },
}

const source = [
  readFileSync(join(iconDir, 'index.tsx'), 'utf8'),
  readFileSync(join(iconDir, 'shared-artwork.tsx'), 'utf8'),
].join('\n')

/**
 * The composer's send/stop marks are inline `<svg>` in the web's InputBar
 * rather than exports of the icon module, so they are lifted from there. Both
 * draw a filled 16×16 shape: the up arrow submits, the rounded square stops.
 */
const composerSource = readFileSync(inputBarPath, 'utf8')
const composerSend = /<path d="(M8\.3125 0\.980183[^"]*)" fill="currentColor" \/>/.exec(composerSource)?.[1]
const composerStop = /<rect ([^/>]*?) fill="currentColor" \/>/.exec(composerSource)?.[1]
if (composerSend === undefined || composerStop === undefined) {
  throw new Error('could not find the composer send/stop artwork in InputBar.tsx')
}

/** The artwork component one exported icon wrapper renders, and its stroke width. */
function resolveExport(name) {
  const wrapper = new RegExp(`export const ${name}\\b[\\s\\S]*?strokeWidth=\\{ICON_(\\w+)_STROKE\\}`).exec(source)
  if (wrapper === null) throw new Error(`no export ${name}`)
  const artwork = /=>\s*\(?\s*<(\w+)/.exec(wrapper[0])?.[1]
  if (artwork === undefined) throw new Error(`no artwork for ${name}`)
  return { artwork, strokeWidth: wrapper[1] === 'MEDIUM' ? 1.3 : 1 }
}

/** Index of one artwork component's `const X = (` declaration. */
function declarationIndex(artwork) {
  const index = source.indexOf(`const ${artwork} = (`)
  if (index === -1) throw new Error(`no artwork definition ${artwork}`)
  return index
}

/** The parameter list text of one artwork component, without its parentheses. */
function artworkParams(artwork) {
  const open = source.indexOf('(', declarationIndex(artwork))
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error(`unterminated params for ${artwork}`)
}

/** Offset of one artwork component's JSX body, past the arrow and any `(`. */
function artworkBodyStart(artwork) {
  let i = source.indexOf('=>', declarationIndex(artwork)) + 2
  while (/\s/.test(source[i])) i += 1
  if (source[i] === '(') i += 1
  while (/\s/.test(source[i])) i += 1
  return i
}

/**
 * One artwork's `<svg>` body and effective default size.
 *
 * Some artworks are not inline `<svg>` but forward to another artwork
 * (`QueueOutline` → the shared `ChatLinesOutlineArtwork`, `PlanOutline` →
 * `IconListPenOutlineArtwork`), sometimes pinning the size (`size={size}`,
 * `size={props.size ?? 14}`). Follow the chain so the phone draws the same
 * paths the browser does, with the size the outermost artwork declares.
 */
function resolveArtwork(artwork, chain = []) {
  if (chain.includes(artwork)) throw new Error(`artwork cycle: ${[...chain, artwork].join(' -> ')}`)
  const declared = /size\s*=\s*(\d+)/.exec(artworkParams(artwork))
  const declaredSize = declared === null ? undefined : Number(declared[1])
  const bodyStart = artworkBodyStart(artwork)
  if (source.startsWith('<svg', bodyStart)) {
    const svgEnd = source.indexOf('</svg>', bodyStart)
    if (svgEnd === -1) throw new Error(`unterminated svg for ${artwork}`)
    const body = source.slice(source.indexOf('>', bodyStart) + 1, svgEnd)
    return { size: declaredSize ?? 16, body }
  }
  const forwarded = /^<(\w+)/.exec(source.slice(bodyStart, bodyStart + 80))
  if (forwarded === null) throw new Error(`no svg body for ${artwork}`)
  const call = source.slice(bodyStart, source.indexOf('/>', bodyStart))
  const pinned = /size=\{(?:props\.size \?\? )?(\d+)\}/.exec(call)
  const inner = resolveArtwork(forwarded[1], [...chain, artwork])
  return { size: pinned === null ? declaredSize ?? inner.size : Number(pinned[1]), body: inner.body }
}

/**
 * One element's attributes as JSX prop text, with color left to the caller.
 * Only the children inside a `<svg>` body are ever handed here, so every
 * attribute is kept: a child's own `width`/`height` (the copy glyph's second
 * sheet, the composer's stop square) is real geometry, not a repeat of the
 * root's.
 */
function attributeText(raw, strokeWidth) {
  const props = []
  for (const match of raw.matchAll(/([A-Za-z][A-Za-z-]*)="([^"]*)"/g)) {
    const key = match[1]
    const value = match[2]
    if (value === 'currentColor') props.push(`${key}={color}`)
    else if (/^-?\d+(\.\d+)?$/.test(value)) props.push(`${key}={${value}}`)
    else props.push(`${key}="${value}"`)
  }
  // The web sets the stroke width once on the root and every stroked child
  // inherits it; the phone's renderer is given it per element instead, so a
  // consumer never depends on the two implementations agreeing on inheritance.
  if (props.some(prop => prop.startsWith('stroke={'))) props.push(`strokeWidth={${strokeWidth}}`)
  return props.join(' ')
}

/** One artwork body as the JSX children of a `react-native-svg` root. */
function elementText(body, strokeWidth) {
  const lines = []
  for (const match of body.matchAll(/<(path|circle|rect|ellipse|line)\b([^>]*?)\/>/g)) {
    const tag = match[1]
    const component = tag[0].toUpperCase() + tag.slice(1)
    const attributes = attributeText(match[2], strokeWidth)
    lines.push(`      <${component} ${attributes} />`)
  }
  return lines.join('\n')
}

const components = []
const entries = []
/** Which `react-native-svg` elements the vendored artwork actually uses. */
const usedElements = new Set()
for (const [local, { export: exported, note }] of Object.entries(GLYPHS)) {
  const { artwork, strokeWidth } = resolveExport(exported)
  const { size, body } = resolveArtwork(artwork)
  for (const match of body.matchAll(/<(path|circle|rect|ellipse|line)\b/g)) {
    usedElements.add(match[1][0].toUpperCase() + match[1].slice(1))
  }
  components.push(
    `/** ${exported} — ${note}. */\n`
    + `function ${local}Icon({ size = ${size}, color, style }: IconRenderProps): React.JSX.Element {\n`
    + `  return (\n    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={style}>\n`
    + `${elementText(body, strokeWidth)}\n    </Svg>\n  )\n}`,
  )
  entries.push(`  ${local}: ${local}Icon,`)
}

// The composer's two filled marks, inlined in the web's InputBar.
components.push(
  '/** Composer submit — the web InputBar\'s filled up arrow, 16px. */\n'
  + 'function SendSolidIcon({ size = 16, color, style }: IconRenderProps): React.JSX.Element {\n'
  + '  return (\n    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={style}>\n'
  + `      <Path d="${composerSend}" fill={color} />\n    </Svg>\n  )\n}`,
)
components.push(
  '/** Composer stop — the web InputBar\'s filled rounded square, 16px. */\n'
  + 'function StopSolidIcon({ size = 16, color, style }: IconRenderProps): React.JSX.Element {\n'
  + '  return (\n    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={style}>\n'
  + `      <Rect ${attributeText(composerStop, 1)} fill={color} />\n    </Svg>\n  )\n}`,
)
entries.push('  SendSolid: SendSolidIcon,')
entries.push('  StopSolid: StopSolidIcon,')

const output = `/**
 * Product icons, vendored verbatim from the dsh web UI.
 *
 * Generated by \`scripts/sync-icons.mjs\` — do not edit by hand; re-run the
 * script after the harness's icons change. Each glyph keeps the web's own
 * 16×16 viewBox, its 1px (regular) / 1.3px (medium) stroke, and its
 * \`currentColor\` semantics, so the phone draws the browser's artwork rather
 * than a hand-drawn lookalike.
 */
import React from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { ${['Circle', 'Ellipse', 'Line', 'Path', 'Rect', 'Svg'].filter(name => name === 'Svg' || usedElements.has(name)).join(', ')} } from 'react-native-svg'

/** One glyph's rendering props: the web's \`size\` default, over the caller's color. */
interface IconRenderProps {
  size?: number
  color: string
  style?: StyleProp<ViewStyle>
}

${components.join('\n\n')}

/** Every vendored glyph, keyed by the name call sites use. */
export const ICONS = {
${entries.join('\n')}
} as const

export type IconName = keyof typeof ICONS

/**
 * Draw one vendored product icon.
 * @param props.name - which glyph.
 * @param props.size - square edge in px; defaults to the web's own drawn size.
 * @param props.color - the color \`currentColor\` resolves to.
 * @param props.style - optional layout style (margins, alignment) for the svg.
 * @returns the glyph element.
 */
export function Icon({ name, size, color, style }: {
  name: IconName
  size?: number
  color: string
  style?: StyleProp<ViewStyle>
}): React.JSX.Element {
  const Glyph = ICONS[name]
  return (
    <Glyph
      color={color}
      {...(size === undefined ? {} : { size })}
      {...(style === undefined ? {} : { style })}
    />
  )
}
`

const previous = (() => {
  try {
    return readFileSync(outputPath, 'utf8')
  } catch {
    return null
  }
})()

if (process.argv.includes('--check')) {
  if (previous === output) {
    console.log('[sync-icons] icons.tsx matches the harness artwork')
  } else {
    console.error('[sync-icons] icons.tsx is stale; run node scripts/sync-icons.mjs')
    process.exit(1)
  }
} else {
  writeFileSync(outputPath, output)
  console.log(`[sync-icons] wrote ${output.length} bytes to apps/mobile/src/icons.tsx`)
}
