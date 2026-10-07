import { describe, expect, it } from 'vitest'
import type { ConversationItem } from '../src/conversation.ts'
import { buildTranscript } from '../src/transcript.ts'

function user(seq: number, text: string): ConversationItem {
  return { kind: 'user', key: `u${seq}`, seq, time: seq * 1_000, text, images: [] }
}

function assistant(seq: number, text: string, reasoning = ''): ConversationItem {
  return {
    kind: 'assistant', key: `a${seq}`, seq, time: seq * 1_000, text, reasoning,
    interrupted: false, producedFiles: [],
  }
}

const tool = (seq: number, name: string): ConversationItem => ({
  kind: 'tool', key: `t${seq}`, seq, time: seq * 1_000, callId: `c${seq}`, name, args: '',
  status: 'done', resultPreview: '', resultText: '', resultImages: [],
  callView: null, resultView: null, subCalls: [],
})

const delivery = (seq: number, path: string): ConversationItem =>
  ({ kind: 'delivery', key: `d${seq}`, seq, time: seq * 1_000, files: [{ path }] })

const turnStart = (seq: number, turn: number): ConversationItem => ({ kind: 'turn-start', key: `ts${turn}`, seq, time: seq * 1_000, turn })
const turnEnd = (seq: number, turn: number, reason: string): ConversationItem =>
  ({ kind: 'turn-end', key: `te${turn}`, seq, time: seq * 1_000, turn, reason })

describe('buildTranscript', () => {
  it('renders one row per answer, with tools and reasoning folded into the turn', () => {
    const transcript = buildTranscript([
      turnStart(1, 1),
      user(2, 'q'),
      assistant(3, '', '先想想'),
      tool(4, 'read'),
      assistant(5, 'answer'),
      turnEnd(6, 1, 'completed'),
    ])

    // The prompt and the answer are rows; the disclosure rides inside the answer
    // (the web's own shape), so there is no third row for the process block.
    expect(transcript.rows.map(row => row.kind === 'turn' ? 'process' : row.item.key)).toEqual(['u2', 'a5'])
    expect(transcript.rows[1]).toMatchObject({ process: expect.anything() })
  })

  it('points every folded item at the row that carries it', () => {
    const transcript = buildTranscript([
      user(1, 'q'),
      assistant(2, '', 'reasoned only'),
      tool(3, 'read'),
      assistant(4, 'answer'),
    ])

    const answer = transcript.rows.findIndex(row => row.kind === 'item' && row.item.key === 'a4')
    // A reasoning-only message and a tool call have no row: both resolve to the
    // turn that shows them, never past the end of the list.
    // The message has no row of its own (it is empty), so it resolves to the
    // turn's first row; the tool call is what its run's row holds.
    expect(transcript.rowIndexOfItemKey.get('a2')).toBe(0)
    expect(transcript.rowIndexOfItemKey.get('t3')).toBe(1)
    expect(transcript.rowIndexOfItemKey.get('a4')).toBe(answer)
    expect(transcript.rowIndexOfItemKey.get('u1')).toBe(0)
  })

  it('reads a live turn run by run, with each answer between the runs', () => {
    const transcript = buildTranscript([
      user(1, 'q'),
      assistant(2, 'progress', '先看目录'),
      tool(3, 'read'),
      assistant(4, 'answer'),
    ])

    // The web emits a Step's reasoning, then its reply, then the tools that
    // followed: the narrated answer keeps the place it was said in instead of
    // sinking under the whole turn's process.
    expect(transcript.rows.map(row => row.kind === 'turn' ? 'process' : row.item.key))
      .toEqual(['u1', 'process', 'a2', 'process', 'a4'])
  })

  it('folds a settled turn into one disclosure inside its answer', () => {
    const transcript = buildTranscript([
      user(1, 'q'),
      assistant(2, 'progress', '先看目录'),
      tool(3, 'read'),
      assistant(4, 'answer'),
      turnEnd(5, 1, 'completed'),
    ])

    expect(transcript.rows.map(row => row.kind === 'turn' ? 'process' : row.item.key))
      .toEqual(['u1', 'a2', 'a4'])
    // The disclosure rides the answer that opened the turn's visible content,
    // which is where the web seats the folded control.
    expect(transcript.rows[1]).toMatchObject({ process: expect.anything() })
    expect(transcript.rows[0]).not.toHaveProperty('process')
  })

  it('gives a turn with no answer its own disclosure row and points tools at it', () => {
    const transcript = buildTranscript([
      user(1, 'q'),
      tool(2, 'read'),
      turnEnd(3, 1, 'aborted'),
    ])

    expect(transcript.rows.map(row => row.kind)).toEqual(['item', 'turn'])
    expect(transcript.rowIndexOfItemKey.get('t2')).toBe(1)
  })

  it('keeps a delivery row after the answer and still resolves both', () => {
    const transcript = buildTranscript([
      user(1, 'q'),
      assistant(2, 'answer'),
      delivery(3, 'C:\\out\\report.md'),
    ])

    const keys = transcript.rows.map(row => row.kind === 'turn' ? 'process' : row.item.key)
    expect(keys).toEqual(['u1', 'a2', 'd3'])
    expect(transcript.rowIndexOfItemKey.get('d3')).toBe(2)
  })
})
