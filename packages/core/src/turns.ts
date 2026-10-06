/**
 * Turn grouping for the chat transcript.
 *
 * The web shows one disclosure per turn holding every reasoning block and tool
 * call, with the answer text below it. Rendering each step as its own card
 * instead buries the answer under a column of differently-sized "思考过程"
 * headers, so the transcript collapses to the same shape here.
 *
 * The row itself carries the web's live process presentation: while the turn
 * runs it names what is happening now (a category plus a one-line detail, or the
 * announced-but-undispatched call), and once it settles it summarizes the work
 * by category. A caller decides how a step looks; this decides membership,
 * order, and what the header can say.
 */
import {
  reasoningPreview,
  summarizeActivity,
  toolActivity,
  toolCallDetail,
  type ActivityCall,
  type ProcessActivitySummary,
  type ToolActivity,
} from './activity.ts'
import { summarizeFileChanges, type FileChangeSummary, type FileDiffLike } from './file-changes.ts'
import type { ConversationItem, ToolSubCall } from './conversation.ts'

type ToolItem = Extract<ConversationItem, { kind: 'tool' }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** One line inside a turn's process block. */
export type TurnProcessStep =
  | {
      kind: 'thinking'
      key: string
      text: string
      /** One-line collapsed preview of the newest reasoning. */
      preview: string
    }
  | { kind: 'preparing'; key: string; name: string; activity: ToolActivity; time: number }
  | {
      kind: 'tool'
      key: string
      item: ToolItem
      activity: ToolActivity
      /** The category's own one-line detail, already capped for display. */
      detail: string
      running: boolean
    }

export interface Turn {
  /** Stable key: the id of the item that opened the turn. */
  key: string
  /**
   * Every conversation item this turn consumed, in log order — including the
   * ones that render nowhere (a reasoning-only answer) or only inside the
   * disclosure (a tool call). Callers that address items by key need the whole
   * membership, not just what is visible.
   */
  items: ConversationItem[]
  /** Reasoning and tool calls, in the order they happened. */
  process: TurnProcessStep[]
  /** Rows that still render on their own: prompts, answers, compactions. */
  visible: ConversationItem[]
  /**
   * Render order for the turn: the prompt, then the process block, then what
   * followed. Emitting the process block first put a turn's tools above the
   * question they belong to, which read as the answer being cut in half.
   */
  rows: TurnRow[]
  /** Tool steps in this turn, for the summary label. */
  toolCallCount: number
  /** A tool is in flight, or the answer is still streaming. */
  running: boolean
  /**
   * The turn has not settled: in-flight work, or the newest turn with no
   * recorded end. Only a live turn's header names what is happening now.
   */
  live: boolean
  /** Categories ranked by call count, plus the current live activity. */
  summary: ProcessActivitySummary
  /** Files this turn changed, with their line movement (the web's per-turn diff card). */
  changes: FileChangeSummary[]
  /** Recorded `turn/start` time, else the first item's; 0 when unknown. */
  startedAt: number
  /** Recorded `turn/end` time, else the last item's. */
  endedAt: number
  /**
   * The closing `turn/end` seq, when the page carries it. The web branches at
   * exactly this boundary ("the branch action owns boundary resolution: it
   * sends the real turn/end seq it already has"), so a phone that forks must
   * send the same anchor rather than the message's own seq.
   */
  endSeq?: number
  /**
   * Why the turn ended — `completed`, `aborted`, `error`, `max-tokens`, … —
   * absent while it is still open or when the closing event is not loaded.
   */
  endReason?: string
  /** Elapsed time in ms, once both ends are known. */
  durationMs?: number
}

export type TurnRow =
  | { kind: 'process' }
  | { kind: 'item'; item: ConversationItem }

/**
 * Where a turn's branch control forks, mirroring the web's turn tail: the
 * closing `turn/end` seq the Host cuts at, or `unavailable` while the turn has
 * not closed (the web keeps the control visible but inert in that case).
 */
export interface TurnBranchAnchor {
  /** The closing boundary to fork at; absent precisely when `unavailable`. */
  seq?: number | undefined
  /** The turn is still running, so no boundary exists to cut at yet. */
  unavailable?: boolean | undefined
}

/** The answer a turn's branch control belongs to, plus the anchor to fork at. */
export interface TurnTail {
  /** The turn's closing answer — the message the web seats its icon row on. */
  item: ConversationItem
  /** Absent when the turn has no resolvable boundary, so no control is shown. */
  branch?: TurnBranchAnchor | undefined
}

/**
 * The message that closes a turn, with the boundary its branch control forks
 * at. The web hangs that control on the turn tail and sends the real
 * `turn/end` seq ("the branch action owns boundary resolution"), never the
 * message's own seq; a live turn has no boundary yet and keeps the control
 * visible but inert.
 * @param turn - one grouped turn.
 * @returns the tail answer and its anchor, or undefined when the turn has no
 * answer of its own (a turn that only called tools, or only reasoned).
 */
export function turnTail(turn: Turn): TurnTail | undefined {
  const item = turn.visible
    .filter(entry => entry.kind === 'assistant' || entry.kind === 'stream')
    .at(-1)
  if (item === undefined) return undefined
  if (turn.endSeq !== undefined) return { item, branch: { seq: turn.endSeq } }
  return turn.live ? { item, branch: { unavailable: true } } : { item }
}

/**
 * The row that carries a turn's process disclosure, or undefined when the turn
 * has nothing to disclose. A turn with no reasoning and no tool calls — a plain
 * question and answer — must not render a disclosure at all: an empty one opens
 * into nothing, so tapping it looks like a control that does not work.
 */
export function processOwnerItem(turn: Turn): ConversationItem | undefined {
  if (turn.process.length === 0) return undefined
  return turn.visible.find(item => item.kind === 'assistant' || item.kind === 'stream')
}

function isRunning(item: ConversationItem): boolean {
  if (item.kind === 'stream') return true
  if (item.kind === 'preparing') return true
  if (item.kind === 'tool') return item.status === 'running'
  return false
}

/**
 * Whether a message still deserves its own row once its reasoning has moved
 * into the process block. An assistant step that only thought (empty text) is
 * fully represented by the process block, so rendering it too would leave an
 * empty bubble behind. A stream always renders: it carries the live cursor.
 */
function isVisible(item: ConversationItem): boolean {
  if (item.kind === 'user' || item.kind === 'compaction') return true
  /**
   * A live buffer that has not produced text yet must not render a bubble: the
   * host opens the buffer on the first chunk of a step, and a step that starts
   * with reasoning (or with a tool-call delta) leaves the text empty. That bubble
   * was an empty card with nothing but a cursor, sitting below the previous
   * answer until the new text arrived. Its reasoning still reaches the reader —
   * `stepsOf` puts it in the process block — and liveness is already carried by
   * the transcript's running indicator, so nothing is lost by hiding the shell.
   */
  if (item.kind === 'stream') return item.text !== ''
  // Content with no renderer still gets its own row: hiding it is the failure
  // mode this row exists to prevent.
  if (item.kind === 'unknown') return true
  // Delivered files are the turn's result, not process: they keep their own row.
  if (item.kind === 'delivery') return true
  if (item.kind === 'assistant') return item.text !== ''
  return false
}

function activityCall(node: ToolItem | ToolSubCall): ActivityCall {
  return {
    callId: node.callId,
    name: node.name,
    args: node.args,
    running: node.status === 'running',
    preparing: false,
    time: node.time,
    subCalls: node.subCalls.map(activityCall),
  }
}

/**
 * An announced call, flattened into the same shape as a dispatched one. It
 * counts once and owns the live activity until the durable call replaces it.
 */
function preparingCall(step: Extract<TurnProcessStep, { kind: 'preparing' }>): ActivityCall {
  return {
    callId: step.key,
    name: step.name,
    args: '',
    running: true,
    preparing: true,
    time: step.time,
    subCalls: [],
  }
}

/** Event times are optional on the wire; a missing one is "unknown", not 0 AD. */
function itemTime(item: ConversationItem): number {
  return typeof item.time === 'number' && Number.isFinite(item.time) ? item.time : 0
}

/**
 * The inline diffs one tool result presented, if any. A settled call prefers the
 * result's card (the applied change); a still-running one has only the call's.
 */
function diffsOf(item: ToolItem): FileDiffLike[] {
  const view = item.status === 'running' ? item.callView : (item.resultView ?? item.callView)
  if (!isRecord(view) || view['card'] !== 'diff' || !Array.isArray(view['diffs'])) return []
  const diffs: FileDiffLike[] = []
  for (const candidate of view['diffs']) {
    if (!isRecord(candidate) || typeof candidate['path'] !== 'string') continue
    diffs.push({
      path: candidate['path'],
      oldText: typeof candidate['oldText'] === 'string' ? candidate['oldText'] : null,
      newText: typeof candidate['newText'] === 'string' ? candidate['newText'] : '',
    })
  }
  return diffs
}

function stepsOf(item: ConversationItem): TurnProcessStep[] {
  if (item.kind === 'tool') {
    return [{
      kind: 'tool',
      key: item.key,
      item,
      activity: toolActivity(item.name),
      detail: toolCallDetail(item.name, item.args),
      running: item.status === 'running',
    }]
  }
  if (item.kind === 'preparing') {
    return [{ kind: 'preparing', key: item.key, name: item.name, activity: toolActivity(item.name), time: item.time }]
  }
  if ((item.kind === 'assistant' || item.kind === 'stream') && item.reasoning.trim() !== '') {
    return [{
      kind: 'thinking',
      key: `${item.key}:reasoning`,
      text: item.reasoning,
      preview: reasoningPreview(item.reasoning),
    }]
  }
  return []
}

/** Split a conversation into turns, each with one process block plus its rows. */
export function groupTurns(items: ConversationItem[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null
  /** A `turn/start` seen before its turn's first content row. */
  let pendingStart: number | undefined

  const open = (item: ConversationItem): Turn => {
    const turn: Turn = {
      key: item.key,
      items: [],
      process: [],
      visible: [],
      rows: [],
      toolCallCount: 0,
      running: false,
      live: false,
      summary: { counts: [], runningDetail: '', preparing: false },
      changes: [],
      startedAt: pendingStart ?? itemTime(item),
      endedAt: itemTime(item),
    }
    pendingStart = undefined
    turns.push(turn)
    return turn
  }

  for (const item of items) {
    // Turn boundaries carry no content: they time the turn and name its end.
    if (item.kind === 'turn-start') {
      pendingStart = itemTime(item)
      continue
    }
    if (item.kind === 'turn-end') {
      if (current !== null) {
        current.endedAt = Math.max(current.endedAt, itemTime(item))
        current.endReason = item.reason
        current.endSeq = item.seq
      }
      continue
    }
    // A prompt opens a new turn; anything before the first prompt (a restored
    // greeting, say) still needs a home, so the first item opens one too.
    if (item.kind === 'user' || current === null) current = open(item)

    current.items.push(item)
    current.process.push(...stepsOf(item))
    if (item.kind === 'tool') current.toolCallCount += 1
    if (isVisible(item)) {
      current.visible.push(item)
      // The prompt opens the turn's rows; the process block and the answer are
      // appended once every item has been seen.
      if (item.kind === 'user') current.rows.push({ kind: 'item', item })
    }
    if (isRunning(item)) current.running = true
    const time = itemTime(item)
    if (time > current.endedAt) current.endedAt = time
    if (time > 0 && (current.startedAt === 0 || time < current.startedAt)) current.startedAt = time
  }

  turns.forEach((turn, index) => {
    // Measured after the fact: only a closed turn reports elapsed time.
    if (turn.endReason !== undefined && turn.startedAt > 0 && turn.endedAt > turn.startedAt) {
      turn.durationMs = turn.endedAt - turn.startedAt
    }
    // Only the newest turn may still be running with no recorded end. An older
    // turn whose closing event sits outside the loaded page is history, not work.
    turn.live = turn.running || (turn.endReason === undefined && index === turns.length - 1)
    turn.summary = summarizeActivity(
      turn.process.flatMap(step => step.kind === 'tool'
        ? [activityCall(step.item)]
        : step.kind === 'preparing' ? [preparingCall(step)] : []),
      turn.process
        .filter((step): step is Extract<TurnProcessStep, { kind: 'thinking' }> => step.kind === 'thinking')
        .map(step => step.text),
    )
    turn.changes = summarizeFileChanges(
      turn.process.flatMap(step => step.kind === 'tool' ? diffsOf(step.item) : []),
    )
    if (turn.process.length > 0) turn.rows.push({ kind: 'process' })
    for (const item of turn.visible) {
      if (item.kind !== 'user') turn.rows.push({ kind: 'item', item })
    }
  })

  return turns
}

/**
 * One turn's billed tokens, summed over the usage its assistant messages
 * recorded.
 *
 * `totalTokens` is the web's own aggregate — every prompt-side bucket plus the
 * answer — which is what its turn-usage pill prints (`用量 12.3K`) and what the
 * cache-hit share divides against. Null means the turn recorded no accounting,
 * which is a different fact from a turn that recorded zero and is why the pill
 * is not shown at all in that case.
 */
export interface TurnTokenUsage {
  totalTokens: number
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens?: number
}

/**
 * Sum a turn's step usages.
 * @param turn - the turn whose assistant messages carry the accounting.
 * @returns the summed buckets, or null when no step recorded any.
 */
export function turnTokenUsage(turn: Turn): TurnTokenUsage | null {
  let uncachedInputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let recordedReasoning = false
  let sawUsage = false
  for (const item of turn.items) {
    if (item.kind !== 'assistant' || item.usage === undefined) continue
    sawUsage = true
    uncachedInputTokens += item.usage.uncachedInputTokens
    cacheReadTokens += item.usage.cacheReadTokens
    cacheWriteTokens += item.usage.cacheWriteTokens
    outputTokens += item.usage.outputTokens
    if (item.usage.reasoningTokens !== undefined) {
      reasoningTokens += item.usage.reasoningTokens
      recordedReasoning = true
    }
  }
  if (!sawUsage) return null
  return {
    totalTokens: uncachedInputTokens + cacheReadTokens + cacheWriteTokens + outputTokens,
    uncachedInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    ...(recordedReasoning ? { reasoningTokens } : {}),
  }
}
