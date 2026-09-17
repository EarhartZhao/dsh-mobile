import { describe, expect, it } from 'vitest'
import { groupTurns } from '../src/turns.ts'
import type { ConversationItem } from '../src/conversation.ts'

function user(seq: number, text: string) {
  return { kind: 'user', key: `u${seq}`, seq, text, images: [] }
}

function assistant(seq: number, text: string, reasoning = '') {
  return {
    kind: 'assistant', key: `a${seq}`, seq, text, reasoning, interrupted: false, producedFiles: [],
  }
}

function stream(seq: number, text: string, reasoning = '') {
  return { kind: 'stream', key: `s${seq}`, seq, text, reasoning }
}

function tool(seq: number, name: string, status: 'running' | 'done' = 'done') {
  return {
    kind: 'tool', key: `t${seq}`, seq, callId: `c${seq}`, name, args: '', status,
    resultPreview: '', resultText: '', resultImages: [], callView: null, resultView: null, subCalls: [],
  }
}

const items = (...list: unknown[]) => list as ConversationItem[]
const kinds = (turn: { visible: ConversationItem[] }) => turn.visible.map(item => item.kind)
const texts = (turn: { visible: ConversationItem[] }) =>
  turn.visible.map(item => ('text' in item ? item.text : ''))
/** A turn's rows in render order, with the process block marked. */
const rowShape = (turn: { rows: unknown[] }) => turn.rows.map(row => {
  const entry = row as { kind: string, item?: ConversationItem }
  if (entry.kind === 'process') return 'process'
  const item = entry.item!
  return 'text' in item ? item.text : item.kind
})

describe('groupTurns', () => {
  it('opens a turn at every user message', () => {
    const turns = groupTurns(items(user(1, 'hi'), assistant(2, 'one'), user(3, 'again'), assistant(4, 'two')))

    expect(turns).toHaveLength(2)
    expect(texts(turns[0]!)).toEqual(['hi', 'one'])
    expect(texts(turns[1]!)).toEqual(['again', 'two'])
  })

  it('hoists reasoning and tools into one ordered process list', () => {
    const turns = groupTurns(items(
      user(1, 'weather?'),
      assistant(2, '', 'first thought'),
      tool(3, 'Bash'),
      assistant(4, '', 'second thought'),
      tool(5, 'web_fetch'),
      assistant(6, 'final answer', 'last thought'),
    ))

    const turn = turns[0]!
    expect(turn.process.map(step => step.kind)).toEqual(['thinking', 'tool', 'thinking', 'tool', 'thinking'])
    expect(turn.process[0]).toMatchObject({ kind: 'thinking', text: 'first thought' })
    expect(turn.process[1]).toMatchObject({ kind: 'tool' })
  })

  it('keeps only text-bearing messages visible, so no empty bubble is left behind', () => {
    const turns = groupTurns(items(
      user(1, 'weather?'),
      assistant(2, '', 'thinking only'),
      assistant(3, 'the answer'),
    ))

    expect(kinds(turns[0]!)).toEqual(['user', 'assistant'])
    expect(turns[0]!.visible.at(-1)).toMatchObject({ text: 'the answer' })
  })

  it('counts tool calls for the summary label', () => {
    const turns = groupTurns(items(user(1, 'x'), tool(2, 'a'), tool(3, 'b'), assistant(4, 'done')))

    expect(turns[0]!.toolCallCount).toBe(2)
  })

  it('reports a turn as running while a tool or the answer is still in flight', () => {
    expect(groupTurns(items(user(1, 'x'), tool(2, 'a', 'running')))[0]!.running).toBe(true)
    expect(groupTurns(items(user(1, 'x'), stream(2, 'partial')))[0]!.running).toBe(true)
    expect(groupTurns(items(user(1, 'x'), tool(2, 'a'), assistant(3, 'done')))[0]!.running).toBe(false)
  })

  it('keeps content that arrived before any user message in a leading turn', () => {
    const turns = groupTurns(items(stream(1, 'greeting')))

    expect(turns).toHaveLength(1)
    expect(turns[0]!.process).toEqual([])
    expect(kinds(turns[0]!)).toEqual(['stream'])
  })

  it('carries compaction rows through as visible content', () => {
    const compaction = { kind: 'compaction', key: 'c1', seq: 9, summary: 'sum', compactionId: 'id' }
    const turns = groupTurns(items(user(1, 'x'), assistant(2, 'a'), compaction as unknown as ConversationItem))

    expect(kinds(turns[0]!)).toEqual(['user', 'assistant', 'compaction'])
  })

  it('orders a turn as prompt, process, answer', () => {
    const turns = groupTurns(items(user(1, 'q'), tool(2, 't'), assistant(3, 'a')))

    // Putting the process block first split the transcript: the turn's tools
    // and thinking landed above the question they belong to.
    expect(rowShape(turns[0]!)).toEqual(['q', 'process', 'a'])
  })

  it('keeps the process block after the prompt when the turn has no answer yet', () => {
    const turns = groupTurns(items(user(1, 'q'), tool(2, 't', 'running')))

    expect(rowShape(turns[0]!)).toEqual(['q', 'process'])
  })
})
