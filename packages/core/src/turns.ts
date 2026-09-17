/**
 * Turn grouping for the chat transcript.
 *
 * The web shows one disclosure per turn ("6 次工具调用" / "已思考") holding
 * every reasoning block and tool call, with the answer text below it. Rendering
 * each step as its own card instead buries the answer under a column of
 * differently-sized "思考过程" headers, so the transcript collapses to the same
 * shape here.
 *
 * Kept platform-neutral: the caller decides how a step looks, this only decides
 * what belongs to which turn and in what order.
 */
import type { ConversationItem } from './conversation.ts'

/** One line inside a turn's process block. */
export type TurnProcessStep =
  | { kind: 'thinking'; key: string; text: string }
  | { kind: 'tool'; key: string; item: ToolItem }

export interface Turn {
  /** Stable key: the id of the item that opened the turn. */
  key: string
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
}

export type TurnRow =
  | { kind: 'process' }
  | { kind: 'item'; item: ConversationItem }

type ToolItem = Extract<ConversationItem, { kind: 'tool' }>

function isRunning(item: ConversationItem): boolean {
  if (item.kind === 'stream') return true
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
  if (item.kind === 'stream') return true
  if (item.kind === 'assistant') return item.text !== ''
  return false
}

function stepsOf(item: ConversationItem): TurnProcessStep[] {
  if (item.kind === 'tool') return [{ kind: 'tool', key: item.key, item }]
  if ((item.kind === 'assistant' || item.kind === 'stream') && item.reasoning.trim() !== '') {
    return [{ kind: 'thinking', key: `${item.key}:reasoning`, text: item.reasoning }]
  }
  return []
}

/** Split a conversation into turns, each with one process block plus its rows. */
export function groupTurns(items: ConversationItem[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null

  const open = (item: ConversationItem): Turn => {
    const turn: Turn = {
      key: item.key,
      process: [],
      visible: [],
      rows: [],
      toolCallCount: 0,
      running: false,
    }
    turns.push(turn)
    return turn
  }

  for (const item of items) {
    // A prompt opens a new turn; anything before the first prompt (a restored
    // greeting, say) still needs a home, so the first item opens one too.
    if (item.kind === 'user' || current === null) current = open(item)

    current.process.push(...stepsOf(item))
    if (item.kind === 'tool') current.toolCallCount += 1
    if (isVisible(item)) {
      current.visible.push(item)
      // The prompt opens the turn's rows; the process block and the answer are
      // appended once every item has been seen.
      if (item.kind === 'user') current.rows.push({ kind: 'item', item })
    }
    if (isRunning(item)) current.running = true
  }

  for (const turn of turns) {
    if (turn.process.length > 0) turn.rows.push({ kind: 'process' })
    for (const item of turn.visible) {
      if (item.kind !== 'user') turn.rows.push({ kind: 'item', item })
    }
  }

  return turns
}
