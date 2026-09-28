import { describe, expect, it } from 'vitest'
import { groupTurns, processOwnerItem, turnTail } from '../src/turns.ts'
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

/** A tool call with real args and a dispatch time, for the process presentation. */
function timedTool(seq: number, name: string, args: string, status: 'running' | 'done', time: number) {
  return { ...tool(seq, name, status), args, time }
}

function preparing(seq: number, callId: string, name: string, time: number) {
  return { kind: 'preparing', key: `p${callId}`, seq, time, callId, name }
}

const turnStart = (seq: number, turn: number, time: number) => ({ kind: 'turn-start', key: `ts${turn}`, seq, time, turn })
const turnEnd = (seq: number, turn: number, time: number, reason: string) =>
  ({ kind: 'turn-end', key: `te${turn}`, seq, time, turn, reason })

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
  it('discloses only turns that reasoned or called a tool', () => {
    const plain = groupTurns(items(user(1, 'hi'), assistant(2, 'hello')))[0]!
    expect(plain.process).toEqual([])
    // A plain answer must not render a disclosure: an empty one opens into
    // nothing, so tapping it looks like a broken control.
    expect(processOwnerItem(plain)).toBeUndefined()

    const reasoned = groupTurns(items(
      user(1, 'hi'),
      assistant(2, '', 'thinking'),
      tool(3, 'Bash'),
      assistant(4, 'hello'),
    ))[0]!
    // The disclosure rides the turn's answer row, which is what the transcript
    // renders as one card: reasoning above the text it produced.
    expect(processOwnerItem(reasoned)).toMatchObject({ kind: 'assistant', text: 'hello' })
  })

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

  it('gives a live buffer with no text yet no bubble of its own', () => {
    // The host opens a step's buffer on its first chunk, which can be reasoning
    // or a tool-call delta. An empty bubble with just a cursor then sat below the
    // previous answer until the text arrived; the reasoning still shows in the
    // process block, so the shell is pure noise.
    const reasoningOnly = groupTurns(items(user(1, 'q'), stream(2, '', 'thinking about it')))[0]!
    expect(kinds(reasoningOnly)).toEqual(['user'])
    expect(reasoningOnly.process.map(step => step.kind)).toEqual(['thinking'])
    expect(reasoningOnly.running).toBe(true)

    // Once the answer starts streaming, the bubble comes back with the cursor.
    const streaming = groupTurns(items(user(1, 'q'), stream(2, 'partial answer', 'thinking')))[0]!
    expect(kinds(streaming)).toEqual(['user', 'stream'])
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

  it('gives content with no renderer its own row instead of hiding it', () => {
    // The fallback row exists so a plugin's (or a newer dsh's) visible content
    // can never be silently missing from the transcript.
    const unknown = {
      kind: 'unknown', key: 'x9', seq: 9, time: 9, eventType: 'notice/message', data: { text: 'hi' },
    }
    const turns = groupTurns(items(user(1, 'q'), tool(2, 't'), unknown as unknown as ConversationItem, assistant(3, 'a')))

    expect(rowShape(turns[0]!)).toEqual(['q', 'process', 'unknown', 'a'])
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

  it('renders an announced-but-undispatched call as a preparing step', () => {
    const turns = groupTurns(items(
      user(1, 'q'),
      preparing(2, 'call-1', 'bash', 1000),
      assistant(3, 'a'),
    ))

    expect(turns[0]!.process.map(step => step.kind)).toEqual(['preparing'])
    expect(turns[0]!.process[0]).toMatchObject({ kind: 'preparing', name: 'bash' })
    // Announced work counts as in flight, so the turn's row opens itself.
    expect(turns[0]!.running).toBe(true)
    expect(turns[0]!.summary).toMatchObject({ preparing: true, running: 'commands' })
  })

  it('summarizes a settled turn by category and reports how long it took', () => {
    const turns = groupTurns(items(
      turnStart(1, 1, 10_000),
      user(2, 'q'),
      timedTool(3, 'read', '{"file_path":"src/app.ts"}', 'done', 11_000),
      timedTool(4, 'bash', '{"command":"pnpm test"}', 'done', 12_000),
      assistant(5, 'a'),
      turnEnd(6, 1, 15_000, 'completed'),
    ))

    const turn = turns[0]!
    expect(turn.summary.counts).toEqual([{ kind: 'read', count: 1 }, { kind: 'commands', count: 1 }])
    expect(turn.live).toBe(false)
    expect(turn.endReason).toBe('completed')
    expect(turn.durationMs).toBe(5_000)
    // The web branches at the closing boundary, so the turn carries its seq.
    expect(turn.endSeq).toBe(6)
    // Turn boundaries are timing, not content: they never become rows.
    expect(rowShape(turn)).toEqual(['q', 'process', 'a'])
  })

  it('keeps a cancelled turn visible as stopped and a live turn as live', () => {
    const cancelled = groupTurns(items(
      turnStart(1, 1, 1_000),
      user(2, 'q'),
      timedTool(3, 'bash', '{"command":"sleep 1"}', 'running', 2_000),
      turnEnd(4, 1, 5_000, 'aborted'),
    ))[0]!
    expect(cancelled.endReason).toBe('aborted')
    expect(cancelled.durationMs).toBe(4_000)
    expect(cancelled.endSeq).toBe(4)
    expect(cancelled.summary.running).toBe('commands')

    // The newest turn with no recorded end is still live even between steps.
    const open = groupTurns(items(user(1, 'q'), assistant(2, 'a')))[0]!
    expect(open.live).toBe(true)

    // An older turn whose closing event is outside the loaded page is history.
    const older = groupTurns(items(user(1, 'q'), assistant(2, 'a'), user(3, 'q2'), assistant(4, 'a2')))
    expect(older[0]!.live).toBe(false)
    expect(older[1]!.live).toBe(true)
  })

  it('seats the branch control on the turn tail, anchored at the turn/end seq', () => {
    // The web forks at the closing boundary it already holds, not at the
    // message seq, and a later delivery row never displaces the answer.
    const settled = groupTurns(items(
      turnStart(1, 1, 1_000),
      user(2, 'q'),
      assistant(3, 'answer'),
      { kind: 'delivery', key: 'd4', seq: 4.5, time: 2_000, files: [{ path: 'out.md' }] },
      turnEnd(5, 1, 3_000, 'completed'),
    ))[0]!

    expect(turnTail(settled)).toMatchObject({ branch: { seq: 5 } })
    expect((turnTail(settled)!.item as { text: string }).text).toBe('answer')
  })

  it('keeps the branch control inert while the turn has not closed', () => {
    // A live turn has no boundary to cut at yet; the web shows the control
    // disabled rather than hiding it, and so does this.
    const live = groupTurns(items(user(1, 'q'), assistant(2, 'partial')))[0]!
    expect(turnTail(live)).toMatchObject({ branch: { unavailable: true } })
  })

  it('offers no branch control when the turn has no answer to hang it on', () => {
    // A turn that only called tools has no tail message, so there is nothing to
    // seat the icon row on.
    const toolsOnly = groupTurns(items(user(1, 'q'), timedTool(2, 'read', '{}', 'done', 1_100), turnEnd(3, 1, 2_000, 'completed')))[0]!
    expect(turnTail(toolsOnly)).toBeUndefined()
  })

  it('carries the newest reasoning as the preview the row shows while collapsed', () => {
    const turns = groupTurns(items(user(1, 'q'), assistant(2, '', 'first line\nbody of the thought')))

    expect(turns[0]!.process[0]).toMatchObject({
      kind: 'thinking',
      preview: 'first line',
      text: 'first line\nbody of the thought',
    })
  })
})
