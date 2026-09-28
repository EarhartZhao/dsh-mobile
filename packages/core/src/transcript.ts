/**
 * The transcript's render rows.
 *
 * The web renders one disclosure per turn holding its reasoning and tool calls,
 * with the answer below it; the phone collapses to the same shape, so the rows
 * are *not* the conversation items. Tool calls, turn boundaries and
 * reasoning-only answers have no row of their own, while the disclosure and the
 * per-turn file-changes card belong to rows that do.
 *
 * That difference is invisible until something addresses a row by index: the
 * search sheet lists conversation items and used to scroll the list to that
 * same index, which landed several rows off (or nowhere, once the index ran past
 * the end). `buildTranscript` therefore returns the rows together with the
 * mapping from an item's key to the row that carries it, so a caller never has
 * to guess the relationship.
 */
import type { ConversationItem } from './conversation.ts'
import { groupTurns, processOwnerItem, turnTail, type Turn, type TurnBranchAnchor } from './turns.ts'

/** One turn's process disclosure, rendered on its own only when nothing else can hold it. */
export interface TranscriptProcessRow {
  kind: 'turn'
  key: string
  turn: Turn
}

/** One plain transcript item. */
export interface TranscriptItemRow {
  kind: 'item'
  key: string
  item: ConversationItem
  /** The turn whose disclosure and change card ride inside this item's card. */
  process?: Turn
  /** Present only on the row the turn's branch control belongs to. */
  branch?: TurnBranchAnchor
}

export type TranscriptRow = TranscriptProcessRow | TranscriptItemRow

export interface Transcript {
  turns: Turn[]
  rows: TranscriptRow[]
  /**
   * The row that carries one conversation item. Every item of a turn resolves —
   * folded content points at its turn — so an item-addressed scroll always has
   * a destination.
   */
  rowIndexOfItemKey: Map<string, number>
}

/**
 * Group a conversation into the rows the transcript renders.
 * @param items - conversation items, in log order.
 * @returns the turns, their rows, and the item-key → row-index map.
 */
export function buildTranscript(items: ConversationItem[]): Transcript {
  const turns = groupTurns(items)
  const rows: TranscriptRow[] = []
  const rowIndexOfItemKey = new Map<string, number>()
  /** Each turn's first row, for the content the transcript folds away. */
  const rowStartOfTurn = new Map<string, number>()

  for (const turn of turns) {
    const answer = processOwnerItem(turn)
    const tail = turnTail(turn)
    rowStartOfTurn.set(turn.key, rows.length)
    for (const row of turn.rows) {
      if (row.kind === 'process') {
        // A turn with an answer shows its disclosure inside that answer's card.
        if (answer !== undefined) continue
        const index = rows.length
        rows.push({ kind: 'turn', key: `process:${turn.key}`, turn })
        for (const step of turn.process) {
          rowIndexOfItemKey.set(step.key, index)
          if (step.kind === 'tool') rowIndexOfItemKey.set(step.item.key, index)
        }
        continue
      }
      const index = rows.length
      rows.push({
        kind: 'item',
        key: row.item.key,
        item: row.item,
        ...(row.item === answer ? { process: turn } : {}),
        ...(tail !== undefined && row.item === tail.item && tail.branch !== undefined
          ? { branch: tail.branch }
          : {}),
      })
      rowIndexOfItemKey.set(row.item.key, index)
    }
  }

  if (rows.length > 0) {
    // Reasoning-only answers and tool calls ride inside a disclosure rather than
    // a row of their own: their jump lands on the turn they belong to.
    const clamp = (index: number): number => Math.min(index, rows.length - 1)
    for (const turn of turns) {
      const start = clamp(rowStartOfTurn.get(turn.key) ?? 0)
      for (const item of turn.items) {
        if (!rowIndexOfItemKey.has(item.key)) rowIndexOfItemKey.set(item.key, start)
      }
      for (const step of turn.process) {
        if (!rowIndexOfItemKey.has(step.key)) rowIndexOfItemKey.set(step.key, start)
        if (step.kind === 'tool' && !rowIndexOfItemKey.has(step.item.key)) {
          rowIndexOfItemKey.set(step.item.key, start)
        }
      }
    }
  }

  return { turns, rows, rowIndexOfItemKey }
}
