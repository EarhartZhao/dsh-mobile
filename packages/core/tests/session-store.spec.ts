import { describe, expect, it } from 'vitest'
import type { MuxFrame } from '@dsh-mobile/protocol'
import { RpcId } from '@dsh-mobile/protocol'
import { SessionStore } from '../src/session-store.ts'

const sid = 's-1' as never

function mux(frame: MuxFrame): [RpcId, MuxFrame] {
  return [RpcId(crypto.randomUUID()), frame]
}

describe('SessionStore', () => {
  it('appends live events with seq dedupe (replay-safe)', () => {
    const store = new SessionStore()
    store.applyMuxFrame(...mux({ type: 'session/subscribed', sessionId: sid, lastSeq: 0 }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 1, type: 'user/message' } as never }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 2, type: 'assistant/chunk' } as never }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 2, type: 'assistant/chunk' } as never }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 3, type: 'assistant/message' } as never }))
    const session = store.sessions.get('s-1')!
    expect(session.events.map(e => (e.event as { seq: number }).seq)).toEqual([1, 2, 3])
    expect(session.lastSeq).toBe(3)
  })

  it('the subscribed watermark drops already-committed replays', () => {
    const store = new SessionStore()
    // lastSeq=2 means "the host log already holds seq 1-2; pull history for them".
    store.applyMuxFrame(...mux({ type: 'session/subscribed', sessionId: sid, lastSeq: 2 }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 2, type: 'assistant/message' } as never }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 3, type: 'assistant/chunk' } as never }))
    const session = store.sessions.get('s-1')!
    expect(session.events.map(e => (e.event as { seq: number }).seq)).toEqual([3])
  })

  it('projections follow higher-seq-wins', () => {
    const store = new SessionStore()
    store.applyMuxFrame(...mux({ type: 'session/projection', sessionId: sid, key: 'title', value: 'new', seq: 5 }))
    store.applyMuxFrame(...mux({ type: 'session/projection', sessionId: sid, key: 'title', value: 'stale', seq: 3 }))
    expect(store.title('s-1')).toBe('new')
  })

  it('queue and jobs are whole-snapshot replacements', () => {
    const store = new SessionStore()
    store.applyMuxFrame(...mux({ type: 'session/queue', sessionId: sid, items: [{ id: 'm1', placement: 'queued', message: null }] as never }))
    store.applyMuxFrame(...mux({ type: 'session/queue', sessionId: sid, items: [] }))
    expect(store.sessions.get('s-1')!.queue).toEqual([])
    store.applyMuxFrame(...mux({ type: 'session/jobs', sessionId: sid, jobs: [{ jobId: 'j1' }] as never }))
    store.applyMuxFrame(...mux({ type: 'session/jobs', sessionId: sid, jobs: [] }))
    expect(store.sessions.get('s-1')!.jobs).toEqual([])
  })

  it('clears generation-scoped snapshots before reconnect baselines', () => {
    const store = new SessionStore()
    store.applyMuxFrame(...mux({ type: 'session/queue', sessionId: sid, items: [{ id: 'm1' }] as never }))
    store.applyMuxFrame(...mux({ type: 'session/jobs', sessionId: sid, jobs: [{ id: 'j1', status: 'running' }] as never }))
    store.applyMuxFrame(...mux({ type: 'session/projection', sessionId: sid, key: 'title', value: 'stale', seq: 3 }))
    store.applyMuxFrame(...mux({ type: 'approval/requested', sessionId: sid, approvalId: 'a1' as never, toolName: 'bash' }))
    store.applyMuxFrame(RpcId(crypto.randomUUID()), { type: 'question/requested', sessionId: sid, questions: [{}] as never })

    store.resetLiveSnapshots()

    const session = store.sessions.get('s-1')!
    expect(session.queue).toEqual([])
    expect(session.jobs).toEqual([])
    expect(session.projections).toEqual({})
    expect(session.projectionSeqs).toEqual({})
    expect(session.pendingApprovals.size).toBe(0)
    expect(session.pendingQuestions.size).toBe(0)
    expect(session.running).toBe(false)
  })

  it('tracks pending approvals/questions until resolved', () => {
    const store = new SessionStore()
    store.applyMuxFrame(...mux({ type: 'approval/requested', sessionId: sid, approvalId: 'a1' as never, toolName: 'bash' }))
    expect(store.sessions.get('s-1')!.pendingApprovals.size).toBe(1)
    store.applyMuxFrame(...mux({ type: 'approval/resolved', sessionId: sid, approvalId: 'a1' as never, outcome: 'approved' as never }))
    expect(store.sessions.get('s-1')!.pendingApprovals.size).toBe(0)
    const qRpcId = RpcId(crypto.randomUUID())
    store.applyMuxFrame(qRpcId, { type: 'question/requested', sessionId: sid, questions: [{ text: '?' }] as never })
    expect(store.sessions.get('s-1')!.pendingQuestions.size).toBe(1)
    store.applyMuxFrame(...mux({ type: 'question/resolved', sessionId: sid, questionRpcId: qRpcId, outcome: 'answered' }))
    expect(store.sessions.get('s-1')!.pendingQuestions.size).toBe(0)
  })

  it('history baseline seeds projections and merges without duplicates', () => {
    const store = new SessionStore()
    store.applyHistory('s-1', [
      { event: { seq: 1, type: 'user/message' } as never },
      { event: { seq: 2, type: 'assistant/message' } as never },
    ], { asOfSeq: 2, values: { title: 'seeded' } })
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 2, type: 'assistant/message' } as never }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 3, type: 'assistant/chunk' } as never }))
    const session = store.sessions.get('s-1')!
    expect(session.events).toHaveLength(3)
    expect(store.title('s-1')).toBe('seeded')
    expect(session.lastSeq).toBe(3)
  })

  it('host frames drive running state and workspace set', () => {
    const store = new SessionStore()
    store.applyBaseline({
      summaries: [{ sessionId: sid, updatedAt: 1, running: false, blank: false } as never],
      workspaces: [],
    })
    store.applyHostFrame({ type: 'host/session-status', sessionId: sid, running: true })
    expect(store.sessions.get('s-1')!.running).toBe(true)
    expect(store.summaries[0]!.running).toBe(true)
    store.applyHostFrame({ type: 'host/workspace-changed', workspace: { workspaceId: 'w1', title: 'W', sessionIds: [] } as never })
    store.applyHostFrame({ type: 'host/workspace-removed', workspaceId: 'w1' as never })
    expect(store.workspaces).toEqual([])
  })

  it('updates summary metadata and exposes forwarded host events', () => {
    const store = new SessionStore()
    const remoteEvents: unknown[] = []
    store.on('remoteEvent', event => remoteEvents.push(event))
    store.applyBaseline({
      summaries: [{ sessionId: sid, updatedAt: 1, running: false, blank: false } as never],
      workspaces: [],
    })
    store.applyHostFrame({ type: 'host/remote-event', event: 'api-session/activity', args: [sid, 9] as never })
    store.applyHostFrame({ type: 'host/remote-event', event: 'agent-preset/selected', args: [sid, 'coder'] as never })
    store.applyHostFrame({ type: 'host/remote-event', event: 'commands/change', args: [] })
    expect(store.summaries[0]).toMatchObject({ updatedAt: 9, agentPreset: 'coder' })
    expect(remoteEvents).toEqual([
      { event: 'api-session/activity', args: [sid, 9] },
      { event: 'agent-preset/selected', args: [sid, 'coder'] },
      { event: 'commands/change', args: [] },
    ])
  })

  it('emits jobSettled when a live job settles or leaves the snapshot', () => {
    const store = new SessionStore()
    const settled: unknown[] = []
    store.on('jobSettled', e => settled.push(e))
    const running = { id: 'bash-1', kind: 'bash', label: 'sleep 30', status: 'running', startedAt: 1 } as never
    store.applyMuxFrame(...mux({ type: 'session/jobs', sessionId: sid, jobs: [running] }))
    expect(settled).toHaveLength(0)
    // Settled in next snapshot
    const completed = { id: 'bash-1', kind: 'bash', label: 'sleep 30', status: 'completed', startedAt: 1, finishedAt: 2 } as never
    store.applyMuxFrame(...mux({ type: 'session/jobs', sessionId: sid, jobs: [completed] }))
    expect(settled).toHaveLength(1)
    // Live again (new job), then disappears from snapshot = settled
    const running2 = { id: 'bash-2', kind: 'bash', label: 'sleep 31', status: 'running', startedAt: 1 } as never
    store.applyMuxFrame(...mux({ type: 'session/jobs', sessionId: sid, jobs: [running2] }))
    store.applyMuxFrame(...mux({ type: 'session/jobs', sessionId: sid, jobs: [] }))
    expect(settled).toHaveLength(2)
    // No duplicate settle for an already-settled job
    store.applyMuxFrame(...mux({ type: 'session/jobs', sessionId: sid, jobs: [completed] }))
    const failed = { id: 'bash-1', kind: 'bash', label: 'sleep 30', status: 'failed', startedAt: 1, finishedAt: 3 } as never
    store.applyMuxFrame(...mux({ type: 'session/jobs', sessionId: sid, jobs: [failed] }))
    expect(settled).toHaveLength(2)
  })

  it('emits attention on approval/question requested', () => {
    const store = new SessionStore()
    const hits: unknown[] = []
    store.on('attention', e => hits.push(e))
    store.applyMuxFrame(...mux({ type: 'approval/requested', sessionId: sid, approvalId: 'a1' as never, toolName: 'bash' }))
    store.applyMuxFrame(RpcId(crypto.randomUUID()), { type: 'question/requested', sessionId: sid, questions: [{}] as never })
    expect(hits).toHaveLength(2)
  })
})
