import { describe, expect, it } from 'vitest'
import { diffLineCounts, summarizeFileChanges, totalLineChanges } from '../src/file-changes.ts'

describe('diffLineCounts', () => {
  it('counts a new file as all additions', () => {
    expect(diffLineCounts(null, 'a\nb\nc\n')).toEqual({ added: 3, removed: 0 })
    expect(diffLineCounts(null, '')).toEqual({ added: 0, removed: 0 })
  })

  it('counts a one-line replacement the way a diff reads', () => {
    // The web reported `+11 -1` for exactly this shape: one line rewritten as
    // eleven.
    const replacement = Array.from({ length: 11 }, (_, index) => `line ${index}`).join('\n')
    expect(diffLineCounts('old line\n', `${replacement}\n`)).toEqual({ added: 11, removed: 1 })
  })

  it('ignores the trailing newline and counts only real movement', () => {
    expect(diffLineCounts('a\nb\n', 'a\nb\n')).toEqual({ added: 0, removed: 0 })
    // Appending keeps every existing line common, so only the addition counts.
    expect(diffLineCounts('a\nb\n', 'a\nb\nc\n')).toEqual({ added: 1, removed: 0 })
    // Deleting counts only the removal.
    expect(diffLineCounts('a\nb\nc\n', 'a\nc\n')).toEqual({ added: 0, removed: 1 })
    // A hunk's context lines are unchanged, not additions.
    expect(diffLineCounts('a\nb\nc\nd\n', 'a\nb\nX\nd\n')).toEqual({ added: 1, removed: 1 })
  })
})

describe('summarizeFileChanges', () => {
  it('sums one file edited twice into a single row, keeping first-seen order', () => {
    const changes = summarizeFileChanges([
      { path: 'a.md', oldText: null, newText: 'one\n' },
      { path: 'b.md', oldText: 'x\n', newText: 'x\ny\n' },
      { path: 'a.md', oldText: 'one\n', newText: 'one\ntwo\n' },
    ])

    expect(changes).toEqual([
      { path: 'a.md', added: 2, removed: 0 },
      { path: 'b.md', added: 1, removed: 0 },
    ])
    expect(totalLineChanges(changes)).toEqual({ added: 3, removed: 0 })
  })
})
