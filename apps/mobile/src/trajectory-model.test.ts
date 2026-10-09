/**
 * The trajectory projection, on its own.
 *
 * The screen tests cover what the list prints; this pins the three things the
 * screen derives from the same projection — the `#N` numbering, the overview's
 * two scales, and the search — so a change to the Web's own semantics is
 * caught here rather than through a rendered tree.
 */
import { SessionStore, deriveConversation, groupTurns, type Turn } from '@dsh-mobile/core'
import { RpcId } from '@dsh-mobile/protocol'
import {
  deriveTrajectoryTimeline,
  flattenTrajectory,
  projectTrajectory,
  searchTrajectory,
  trajectoryRecordByIndex,
  type Translate,
} from './trajectory-model'

/** The dictionary key is the answer: these assertions read the projection. */
const t: Translate = key => key
const SESSION = 's1'

function setup(): SessionStore {
  const store = new SessionStore()
  store.applyBaseline({ summaries: [], workspaces: [] })
  return store
}

function feed(store: SessionStore, seq: number, type: string, data: unknown): void {
  store.applyMuxFrame(RpcId(`f${seq}`), {
    type: 'session/event', sessionId: SESSION,
    event: { seq, time: seq * 1_000, type, data },
  } as never)
}

function turnsOf(store: SessionStore): Turn[] {
  const session = store.sessions.get(SESSION)
  return session === undefined ? [] : groupTurns(deriveConversation(session, {}))
}

/** One prompt, one call the log timed, and the sub-tool that call ran. */
function timedTurn(store: SessionStore): void {
  feed(store, 1, 'user/message', { content: [{ type: 'text', text: '查一下天津' }], source: { kind: 'user' } })
  feed(store, 2, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'code', arguments: '{"source":"ls"}' })
  feed(store, 3, 'tool/code-dispatch-start', {
    parentCallId: 'c1', subCallId: 'c1.1', name: 'bash', arguments: '{"command":"ls"}',
  })
  feed(store, 4, 'tool/code-dispatch', {
    parentCallId: 'c1', subCallId: 'c1.1', name: 'bash', content: [{ type: 'text', text: 'a.txt' }],
  })
  feed(store, 5, 'tool/result', {
    turn: 1, step: 1,
    message: { toolCallId: 'c1', content: [{ type: 'text', text: '8 个来源' }] },
  })
}

describe('projectTrajectory', () => {
  it('numbers every record, sub-tools included, and files them under their turn', () => {
    const store = setup()
    timedTurn(store)
    const model = projectTrajectory(turnsOf(store), t)
    const flat = flattenTrajectory(model)

    // 用户 #1 · 工具 #2 · 子工具 #3: a sub-call is a record of its own, and it
    // is numbered in the order the ledger prints it.
    expect(flat.map(record => record.index)).toEqual([1, 2, 3])
    expect(flat.map(record => record.kind)).toEqual(['user', 'tool', 'subtool'])
    expect(flat.every(record => record.turn === 1)).toBe(true)
    expect(flat[1]?.children.map(child => child.index)).toEqual([3])
    // The sub-tool's title is the dictionary's own name for it, the way the
    // tool rows of the transcript are titled.
    expect(trajectoryRecordByIndex(model, 3)?.title).toBe(t('tool.title.bash'))
    expect(trajectoryRecordByIndex(model, 4)).toBeUndefined()
  })
})

describe('deriveTrajectoryTimeline', () => {
  it('gives every record one equal slot in the sequence projection', () => {
    const store = setup()
    timedTurn(store)
    const model = projectTrajectory(turnsOf(store), t)
    const timeline = deriveTrajectoryTimeline(model, 'sequence')

    expect(timeline).not.toBeNull()
    expect(timeline?.timed).toBe(false)
    // Three records, three slots, and the lanes the Web draws them on.
    expect(timeline?.spans.map(span => span.start)).toEqual([0, 1, 2])
    expect(timeline?.spans.map(span => span.lane)).toEqual([0, 2, 2])
    expect(timeline?.turnBoundaries).toEqual([{ turn: 1, time: 0 }])
  })

  it('scales by the recorded wall time and compresses the idle gap', () => {
    const store = setup()
    timedTurn(store)
    const model = projectTrajectory(turnsOf(store), t)
    const timeline = deriveTrajectoryTimeline(model, 'duration')

    // The prompt arrived at 1_000ms and took none of it; the call started at
    // 2_000ms (a second of idle) and ran to 5_000ms. The Web's 时长 projection
    // opens the call's span where the previous one ended and keeps its
    // 3_000ms width, so the idle second stops taking up room.
    expect(timeline?.timed).toBe(true)
    const spans = timeline?.spans ?? []
    const prompt = spans.find(span => span.kind === 'user')
    const call = spans.find(span => span.kind === 'tool')
    expect(prompt?.start).toBe(1_000)
    expect(call?.start).toBe(prompt?.start)
    expect((call?.end ?? 0) - (call?.start ?? 0)).toBe(3_000)
    expect(timeline?.start).toBe(1_000)
    expect(timeline?.end).toBe(4_000)
  })
})

describe('searchTrajectory', () => {
  it('answers with nothing at all while the box is empty', () => {
    const store = setup()
    timedTurn(store)
    expect(searchTrajectory(projectTrajectory(turnsOf(store), t), '   ')).toBeNull()
  })

  it('finds the record that holds every term, wherever the term is printed', () => {
    const store = setup()
    timedTurn(store)
    const model = projectTrajectory(turnsOf(store), t)

    // A tool's result text, a sub-tool's own output and the section they sit
    // in are all searchable, exactly as the Web indexes them.
    expect([...searchTrajectory(model, '来源') ?? []]).toEqual([2])
    expect([...searchTrajectory(model, 'a.txt') ?? []]).toEqual([3])
    expect([...searchTrajectory(model, 'trajectory.group.step') ?? []]).toEqual([2, 3])
    // Both terms have to land on the same record: `来源` is the call, `a.txt`
    // is the sub-tool it ran.
    expect([...searchTrajectory(model, '来源 a.txt') ?? []]).toEqual([])
    expect([...searchTrajectory(model, '来源 source') ?? []]).toEqual([2])
  })
})
