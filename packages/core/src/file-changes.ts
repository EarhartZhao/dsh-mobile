/**
 * Per-turn file-change summary, computed from the diffs the host already sends.
 *
 * The web shows a turn's work as one card — "已编辑 2 个文件" with a total
 * `+219 -1` and one row per file — which the phone had no equivalent of: it knew
 * the produced paths (from the diff cards' `locations`) but nothing about how
 * much each file moved.
 *
 * The diff views carry whole-file or hunk old/new text, so the counting is a
 * real line diff rather than a guess. A hunk's context lines count as unchanged,
 * which is what makes the numbers match the shape the web reports.
 */

/** One file a turn changed, with its line movement across the whole turn. */
export interface FileChangeSummary {
  path: string
  added: number
  removed: number
}

/** One file the host presented as an inline diff. */
export interface FileDiffLike {
  path: string
  oldText: string | null
  newText: string
}

/** Longest-common-subsequence table is O(n·m); refuse to pay it for huge files. */
const MAX_DIFF_LINES = 4_000

/**
 * Count added and removed lines between two versions of one file.
 *
 * A create (no prior text) counts every line as added. Files beyond the size cap
 * fall back to a length delta: the number is then approximate, which is better
 * than stalling the transcript on a pathological diff.
 *
 * @param oldText - the prior content, or null when the file is new.
 * @param newText - the content after the change.
 * @returns added/removed line counts.
 */
export function diffLineCounts(oldText: string | null, newText: string): { added: number; removed: number } {
  const next = splitLines(newText)
  if (oldText === null) return { added: next.length, removed: 0 }
  const previous = splitLines(oldText)
  if (previous.length > MAX_DIFF_LINES || next.length > MAX_DIFF_LINES) {
    const delta = next.length - previous.length
    return delta >= 0 ? { added: delta, removed: 0 } : { added: 0, removed: -delta }
  }
  const common = longestCommonSubsequenceLength(previous, next)
  return { added: next.length - common, removed: previous.length - common }
}

/**
 * Fold one turn's diffs into per-file totals, in first-seen order.
 *
 * The same file edited twice in a turn reports one row with both edits summed,
 * matching the web's per-turn card rather than repeating the file.
 *
 * @param diffs - every diff the turn's tool results presented.
 * @returns one entry per distinct path, ordered by first appearance.
 */
export function summarizeFileChanges(diffs: readonly FileDiffLike[]): FileChangeSummary[] {
  const order: string[] = []
  const totals = new Map<string, FileChangeSummary>()
  for (const diff of diffs) {
    const counts = diffLineCounts(diff.oldText, diff.newText)
    const existing = totals.get(diff.path)
    if (existing === undefined) {
      order.push(diff.path)
      totals.set(diff.path, { path: diff.path, added: counts.added, removed: counts.removed })
      continue
    }
    existing.added += counts.added
    existing.removed += counts.removed
  }
  return order.map(path => totals.get(path)!)
}

/** Total added/removed lines across a summary, for the card's headline. */
export function totalLineChanges(changes: readonly FileChangeSummary[]): { added: number; removed: number } {
  return changes.reduce(
    (sum, change) => ({ added: sum.added + change.added, removed: sum.removed + change.removed }),
    { added: 0, removed: 0 },
  )
}

/**
 * Split into lines the way the counts read: a trailing newline ends the last
 * line rather than starting an empty one, so a rewritten file does not report a
 * phantom change on its final blank line.
 */
function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** Standard dynamic-programming LCS length over two line arrays. */
function longestCommonSubsequenceLength(left: readonly string[], right: readonly string[]): number {
  const rows = left.length + 1
  const columns = right.length + 1
  let previous = new Uint32Array(columns)
  let current = new Uint32Array(columns)
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      current[column] = left[row - 1] === right[column - 1]
        ? previous[column - 1]! + 1
        : Math.max(previous[column]!, current[column - 1]!)
    }
    const swap = previous
    previous = current
    current = swap
    current.fill(0)
  }
  return previous[columns - 1]!
}
