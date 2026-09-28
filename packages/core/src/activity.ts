/**
 * Tool-activity vocabulary for a turn's process block.
 *
 * The web transcript classifies every tool call into one of a fixed set of
 * categories and describes a running turn with "what it is doing now" — a
 * category label plus one short detail line. Both are the surface the phone was
 * missing: a collapsed "N 次工具调用" row says nothing about the work in flight.
 *
 * This module is the platform-neutral half of that: the category table, the
 * live-detail field priority, and the detail cap are ported verbatim from the
 * web's `process-activity.ts` so the two clients name the same work the same
 * way. Localization stays in the UI layer (see `ui-labels.ts`), because the
 * category ids are the stable contract and the labels are copy.
 */

/** The work categories the web transcript groups tool calls by. */
export type ToolActivity =
  | 'read'
  | 'readImage'
  | 'search'
  | 'write'
  | 'edit'
  | 'commands'
  | 'code'
  | 'webSearch'
  | 'webFetch'
  | 'subagents'
  | 'plan'
  | 'questions'
  | 'tools'

/**
 * Classify one tool by its recorded name, exactly as the web does: no case
 * folding, no namespace stripping, no inference from arguments. The `_inspect`
 * suffix is checked before the `subagent_`/`terminal_` prefixes, so a configured
 * `terminal_inspect` counts as a search rather than a command.
 */
export function toolActivity(name: string): ToolActivity {
  if (name === 'read') return 'read'
  if (name === 'read_image') return 'readImage'
  if (name === 'grep' || name === 'glob' || name.endsWith('_inspect')) return 'search'
  if (name === 'write') return 'write'
  if (name === 'edit' || name === 'apply_patch') return 'edit'
  if (['bash', 'pwsh', 'exec_command', 'write_stdin'].includes(name) || name.startsWith('terminal_')) return 'commands'
  if (name === 'run_code') return 'code'
  if (name === 'web_search') return 'webSearch'
  if (name === 'web_fetch') return 'webFetch'
  if (name === 'subagent' || name.startsWith('subagent_')) return 'subagents'
  if (['todo_write', 'create_goal', 'update_goal', 'get_goal'].includes(name)) return 'plan'
  if (name === 'ask_user_question' || name === 'request_user_input') return 'questions'
  return 'tools'
}

/** The web's live-detail cap; a longer detail is truncated with an ellipsis. */
const DETAIL_MAX_CHARS = 160

/** The web's shared field priority for a tool's one-line detail. */
const DETAIL_KEYS = [
  'title', 'description', 'objective', 'task', 'task_name', 'name', 'question', 'questions', 'prompt', 'message',
  'command', 'cmd', 'queries', 'query', 'pattern', 'url', 'uri', 'file_path', 'path', 'target', 'action', 'status',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Collapse whitespace, trim, and cap one detail string. Grapheme clusters are
 * used when the runtime has `Intl.Segmenter` (Node, JSC); Hermes without full
 * ICU falls back to code points, which only differs for combining sequences.
 */
export function normalizeDetail(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const chars = segmentGraphemes(normalized)
  if (chars.length <= DETAIL_MAX_CHARS) return normalized
  return `${chars.slice(0, DETAIL_MAX_CHARS - 1).join('').trimEnd()}…`
}

function segmentGraphemes(text: string): string[] {
  // `Intl.Segmenter` is not in every supported TypeScript lib and not in Hermes
  // builds without full ICU, so it is reached through a narrow structural type
  // and skipped when absent (code points then, which only differs for
  // combining sequences).
  const constructor = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter
  if (typeof constructor !== 'function') return Array.from(text)
  return Array.from(new constructor(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment)
}

interface SegmenterConstructor {
  new (locale?: string, options?: { granularity: 'grapheme' }): {
    segment: (input: string) => Iterable<{ segment: string }>
  }
}

/** Only strings, or arrays made entirely of strings, carry a usable detail. */
function detailValue(value: unknown): string {
  if (typeof value === 'string') return normalizeDetail(value)
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return normalizeDetail(value.join(', '))
  return ''
}

/** `questions` holds objects; the web takes the first nonempty `question`. */
function questionDetail(value: unknown): string {
  if (!Array.isArray(value)) return ''
  for (const item of value) {
    if (!isRecord(item)) continue
    const detail = detailValue(item['question'])
    if (detail !== '') return detail
  }
  return ''
}

/**
 * One-line "what this call is doing", from the raw call arguments.
 *
 * Falls back to the tool name for partial or free-form arguments — the web
 * deliberately never guesses at a half-parsed JSON payload, because a wrong
 * one-liner is worse than the bare name.
 */
export function toolCallDetail(name: string, argsRaw: string): string {
  let args: unknown
  try {
    args = JSON.parse(argsRaw)
  } catch {
    return normalizeDetail(name)
  }
  if (!isRecord(args)) return normalizeDetail(name)
  for (const key of DETAIL_KEYS) {
    if (!(key in args)) continue
    const value: unknown = args[key]
    const detail = key === 'questions' ? questionDetail(value) : detailValue(value)
    if (detail !== '') return detail
  }
  return normalizeDetail(name)
}

/**
 * The live detail for a call the model has announced but not yet dispatched:
 * the web shows the wire tool name only for the generic category, and nothing
 * for the specific ones (the category label already says the rest).
 */
export function preparingDetail(name: string, activity: ToolActivity): string {
  return activity === 'tools' ? normalizeDetail(name) : ''
}

/**
 * One-line preview of a reasoning block: the first line of its last nonempty
 * paragraph.
 *
 * The web withholds the preview until that line is newline-terminated, and hides
 * it entirely in Compact. On a phone the collapsed reasoning row is the only
 * place a live thought appears, so the newest line is kept as soon as it exists;
 * the paragraph rule is what keeps the preview stable as the rest streams in.
 */
export function reasoningPreview(text: string): string {
  const paragraph = lastParagraph(text)
  if (paragraph === '') return ''
  const line = paragraph.split(/\r?\n/)[0] ?? ''
  return line.replace(/\*\*/g, '').trim()
}

/**
 * The detail a group falls back to with no running tool: the last nonempty
 * paragraph of the latest running reasoning. `**` emphasis is stripped because
 * the header renders plain text.
 */
export function reasoningDetail(text: string): string {
  return normalizeDetail(lastParagraph(text).replace(/\*\*/g, ''))
}

function lastParagraph(text: string): string {
  const paragraphs = text.split(/\r?\n[\t ]*\r?\n/)
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const paragraph = paragraphs[index] ?? ''
    if (paragraph.trim() !== '') return paragraph.trim()
  }
  return ''
}

/** One call the process summary counts, flattened from a tool's subcall tree. */
export interface ActivityCall {
  callId: string
  name: string
  args: string
  /** Still dispatched with no result: a candidate for the live detail. */
  running: boolean
  /** Announced but not dispatched: the "preparing" phase. */
  preparing: boolean
  /** Call start time; the newest running call owns the live category. */
  time: number
  subCalls: readonly ActivityCall[]
}

export interface ProcessActivitySummary {
  /** Categories ranked by distinct call count; ties keep first-appearance order. */
  counts: { kind: ToolActivity; count: number }[]
  /** The newest running call's category, absent when nothing is in flight. */
  running?: ToolActivity | undefined
  runningDetail: string
  /** The newest running call is still preparing, not dispatched. */
  preparing: boolean
}

/**
 * Rank one turn's calls and pick its live activity.
 *
 * Counts follow the web's rules: one call per distinct `callId` anywhere in the
 * tree (a parent and its children count separately, a repeated id counts once),
 * visited parent-before-children in recorded order. Live selection uses the
 * greatest call-start time, so a settled newer call hands the header back to the
 * older one that is still running.
 */
export function summarizeActivity(
  calls: readonly ActivityCall[],
  runningReasoning: readonly string[],
): ProcessActivitySummary {
  const counts = new Map<ToolActivity, number>()
  const seen = new Set<string>()
  let running: ToolActivity | undefined
  let runningDetail = ''
  let preparing = false
  let runningTime = Number.NEGATIVE_INFINITY

  const visit = (call: ActivityCall): void => {
    if (seen.has(call.callId)) return
    seen.add(call.callId)
    const kind = toolActivity(call.name)
    if (call.running && call.time >= runningTime) {
      running = kind
      preparing = call.preparing
      runningDetail = call.preparing ? preparingDetail(call.name, kind) : toolCallDetail(call.name, call.args)
      runningTime = call.time
    }
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
    for (const child of call.subCalls) visit(child)
  }
  for (const call of calls) visit(call)

  if (running === undefined) {
    // No call in flight: the header falls back to the newest live thought.
    for (let index = runningReasoning.length - 1; index >= 0; index -= 1) {
      const detail = reasoningDetail(runningReasoning[index] ?? '')
      if (detail !== '') {
        runningDetail = detail
        break
      }
    }
  }

  return {
    counts: [...counts]
      .map(([kind, count]) => ({ kind, count }))
      .sort((left, right) => right.count - left.count),
    ...running === undefined ? {} : { running },
    runningDetail,
    preparing,
  }
}
