import { describe, expect, it } from 'vitest'
import type { MuxFrame } from '@dsh-mobile/protocol'
import { RpcId } from '@dsh-mobile/protocol'
import { isLogBehindHost, SessionStore } from '../src/session-store.ts'

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

  it('keeps transient assistant chunks out of the durable cursor and dedupes reconnects', () => {
    const store = new SessionStore()
    const transient = {
      type: 'assistant/chunk', seq: 0,
      data: { transient: true, attemptId: 'attempt-1', index: 0, turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hi' } },
    } as never
    store.applyMuxFrame(...mux({ type: 'session/subscribed', sessionId: sid, lastSeq: 4 }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: transient }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: transient }))
    const session = store.sessions.get('s-1')!
    expect(session.events).toHaveLength(1)
    expect(session.lastSeq).toBe(4)
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 5, type: 'assistant/message', data: {} } as never }))
    expect(session.lastSeq).toBe(5)
  })

  it('dedupes transient chunks by attempt and index, keeping their successors', () => {
    const store = new SessionStore()
    const chunk = (index: number): never => ({
      type: 'assistant/chunk', seq: 0,
      data: { transient: true, attemptId: 'attempt-1', index, turn: 1, step: 1, chunk: { type: 'text-delta', index, text: `t${index}` } },
    }) as never
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: chunk(0) }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: chunk(0) }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: chunk(1) }))
    // A fresh attempt restarts the numbering: the index alone would collide.
    store.applyMuxFrame(...mux({
      type: 'session/event', sessionId: sid,
      event: {
        type: 'assistant/chunk', seq: 0,
        data: { transient: true, attemptId: 'attempt-2', index: 0, turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'again' } },
      } as never,
    }))
    const session = store.sessions.get('s-1')!
    expect(session.events.map(entry => (entry.event as { data: { index: number } }).data.index)).toEqual([0, 1, 0])
  })

  it('follows live records past the watermark without rescanning the log', () => {
    const store = new SessionStore()
    store.applyMuxFrame(...mux({ type: 'session/subscribed', sessionId: sid, lastSeq: 4 }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 5, type: 'step/start' } as never }))
    const session = store.sessions.get('s-1')!
    expect(isLogBehindHost(session)).toBe(false)
    // The re-opened follow reports a watermark past the last record we hold.
    store.applyMuxFrame(...mux({ type: 'session/subscribed', sessionId: sid, lastSeq: 9 }))
    expect(isLogBehindHost(session)).toBe(true)
    // Records at or below the watermark are replays: they are dropped, and the
    // Session stays behind until a tail read lands them.
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 9, type: 'turn/end' } as never }))
    expect(isLogBehindHost(session)).toBe(true)
    // A record past the watermark is news, and it clears the mark.
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 10, type: 'turn/end' } as never }))
    expect(isLogBehindHost(session)).toBe(false)
  })

  it('merges the same history page twice without duplicating records', () => {
    const store = new SessionStore()
    const page = [
      { event: { seq: 1, type: 'user/message' } },
      { event: { seq: 2, type: 'assistant/message' } },
    ] as never
    store.applyHistory('s-1', page)
    store.applyHistory('s-1', page)
    const session = store.sessions.get('s-1')!
    expect(session.events).toHaveLength(2)
    expect(session.lastSeq).toBe(2)
    expect(isLogBehindHost(session)).toBe(false)
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

  it('keeps the newest plan when older pages of history land after it', () => {
    const store = new SessionStore()
    const todo = (seq: number, status: string): never => ({
      type: 'todo/write', seq, time: seq,
      data: {
        todos: [
          { content: '抓取重庆统计公报与官方解读', status: 'completed' },
          { content: '汇总行业明细数据', status: 'completed' },
          { content: '撰写完整行业分析报告并交付', status },
        ],
      },
    }) as never

    // The tail page lands first — the end of a turn that finished everything…
    store.applyHistory('s-1', [{ event: todo(603, 'completed') } as never])
    expect(store.sessions.get('s-1')?.todos.map(item => item.status))
      .toEqual(['completed', 'completed', 'completed'])

    // …and then the walk reads the rest of the log, newest page first. An older
    // write must not turn a finished plan back into a half-done one: that is
    // exactly how a Host showing 3/3 left the phone showing 2/3.
    store.applyHistory('s-1', [{ event: todo(397, 'in_progress') } as never])
    store.applyHistory('s-1', [{ event: todo(318, 'pending') } as never])
    expect(store.sessions.get('s-1')?.todos.map(item => item.status))
      .toEqual(['completed', 'completed', 'completed'])
  })

  it('keeps the newest usage when older pages of history land after it', () => {
    const store = new SessionStore()
    const message = (seq: number, outputTokens: number): never => ({
      type: 'assistant/message', seq, time: seq,
      data: { usage: { inputTokens: seq, outputTokens, cacheReadTokens: 0 } },
    }) as never
    store.applyHistory('s-1', [{ event: message(611, 42_000) } as never])
    store.applyHistory('s-1', [{ event: message(120, 900) } as never])
    expect(store.sessions.get('s-1')?.usage?.outputTokens).toBe(42_000)
  })

  it('reports a tail the Host logged while our live stream was down', () => {
    const store = new SessionStore()
    store.applyMuxFrame(...mux({ type: 'session/subscribed', sessionId: sid, lastSeq: 393 }))
    store.applyMuxFrame(...mux({ type: 'session/event', sessionId: sid, event: { seq: 394, type: 'assistant/chunk' } as never }))
    expect(isLogBehindHost(store.sessions.get('s-1')!)).toBe(false)

    // The stream died at 394; the Host's log ran on to 614 without us, and the
    // bridge's re-opened follow is what reports the newer watermark.
    store.applyMuxFrame(...mux({ type: 'session/subscribed', sessionId: sid, lastSeq: 614 }))
    expect(isLogBehindHost(store.sessions.get('s-1')!)).toBe(true)

    // A tail read lands the newest records, and the two agree again.
    store.applyHistory('s-1', [{ event: { seq: 614, type: 'turn/end' } } as never])
    expect(isLogBehindHost(store.sessions.get('s-1')!)).toBe(false)
  })

  it('a Session holding nothing but live chunks is not behind anything', () => {
    const store = new SessionStore()
    store.applyMuxFrame(...mux({ type: 'session/subscribed', sessionId: sid, lastSeq: 12 }))
    store.applyMuxFrame(...mux({
      type: 'session/event', sessionId: sid,
      event: {
        type: 'assistant/chunk', seq: 0,
        data: { transient: true, attemptId: 'a1', index: 0, turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hi' } },
      } as never,
    }))
    // Opening a Session races the watermark against its first page: a chunk with
    // no record behind it must not read as a log that is behind.
    expect(isLogBehindHost(store.sessions.get('s-1')!)).toBe(false)
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

  it('resolveApproval clears one held approval, including one the Host no longer knows', () => {
    const store = new SessionStore()
    const a1 = crypto.randomUUID()
    const a2 = crypto.randomUUID()
    store.applyMuxFrame(RpcId(a1), { type: 'approval/requested', sessionId: sid, approvalId: a1 as never, toolName: 'pwsh' })
    store.applyMuxFrame(RpcId(a2), { type: 'approval/requested', sessionId: sid, approvalId: a2 as never, toolName: 'pwsh' })
    expect(store.sessions.get('s-1')!.pendingApprovals.size).toBe(2)

    store.resolveApproval('s-1', a1)
    expect(store.sessions.get('s-1')!.pendingApprovals.size).toBe(1)
    expect(store.sessions.get('s-1')!.pendingApprovals.has(a2)).toBe(true)

    // Idempotent for an unknown approvalId or session.
    store.resolveApproval('s-1', a1)
    store.resolveApproval('s-404', a2)
    expect(store.sessions.get('s-1')!.pendingApprovals.size).toBe(1)
  })

  it('resolveQuestion optimistically clears one pending question', () => {
    const store = new SessionStore()
    const q1 = RpcId(crypto.randomUUID())
    const q2 = RpcId(crypto.randomUUID())
    store.applyMuxFrame(q1, { type: 'question/requested', sessionId: sid, questions: [{ text: 'a' }] as never })
    store.applyMuxFrame(q2, { type: 'question/requested', sessionId: sid, questions: [{ text: 'b' }] as never })
    expect(store.sessions.get('s-1')!.pendingQuestions.size).toBe(2)

    store.resolveQuestion('s-1', q1)
    expect(store.sessions.get('s-1')!.pendingQuestions.size).toBe(1)
    expect(store.sessions.get('s-1')!.pendingQuestions.has(q2)).toBe(true)

    // Idempotent for an unknown rpcId or session.
    store.resolveQuestion('s-1', q1)
    store.resolveQuestion('s-404', q2)
    expect(store.sessions.get('s-1')!.pendingQuestions.size).toBe(1)
  })

  it('keeps live transient frames at the tail when a history page merges in', () => {
    const store = new SessionStore()
    // The live turn streams before the chat opens, so its transient chunks land
    // first: they carry no seq, and sorting them as -1 hoisted them in front of
    // the whole loaded log — which rendered the running turn's process block
    // above the prompt it belongs to.
    store.applyMuxFrame(...mux({
      type: 'session/event', sessionId: sid,
      event: {
        type: 'assistant/chunk', time: 9,
        data: { turn: 2, step: 1, transient: true, attemptId: 'attempt-1', index: 0, chunk: { type: 'text-delta', text: 'live' } },
      } as never,
    }))
    store.applyHistory(sid, [
      { event: { seq: 1, type: 'user/message', time: 1, data: { message: { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } } } as never },
      { event: { seq: 2, type: 'assistant/message', time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'ok' }] } } } as never },
    ])

    const events = store.sessions.get(sid)!.events
    expect(events.map(entry => (entry.event as { type?: string }).type)).toEqual([
      'user/message', 'assistant/message', 'assistant/chunk',
    ])
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
    // The status frame is what makes the run state the Host's own statement
    // rather than the not-running default a fresh Session starts with.
    expect(store.sessions.get('s-1')!.runningKnown).toBe(true)
    expect(store.summaries[0]!.running).toBe(true)
    store.applyHostFrame({ type: 'host/workspace-changed', workspace: { workspaceId: 'w1', title: 'W', sessionIds: [] } as never })
    store.applyHostFrame({ type: 'host/workspace-removed', workspaceId: 'w1' as never })
    expect(store.workspaces).toEqual([])
  })

  it('seeds list-row titles from the session.list projection block', () => {
    const store = new SessionStore()
    store.applyBaseline({
      summaries: [{
        sessionId: sid,
        updatedAt: 1,
        running: false,
        blank: false,
        projections: { asOfSeq: 7, values: { title: '问候开场2' } },
      } as never],
      workspaces: [],
    })

    // The list renders cold Sessions straight from this baseline, so a title
    // the host already sent must not be dropped: without it the row fell back
    // to the cwd and disagreed with the web sidebar.
    expect(store.title('s-1')).toBe('问候开场2')
  })

  it('keeps a newer live title over an older baseline projection', () => {
    const store = new SessionStore()
    const summary = {
      sessionId: sid,
      updatedAt: 1,
      running: false,
      blank: false,
      projections: { asOfSeq: 7, values: { title: 'stale' } },
    }
    store.applyBaseline({ summaries: [summary as never], workspaces: [] })
    store.applyMuxFrame(...mux({ type: 'session/projection', sessionId: sid, key: 'title', value: 'live', seq: 9 }))

    store.applyBaseline({ summaries: [summary as never], workspaces: [] })

    expect(store.title('s-1')).toBe('live')
  })

  it('takes a baseline title that is newer than the live projection', () => {
    const store = new SessionStore()
    store.applyMuxFrame(...mux({ type: 'session/projection', sessionId: sid, key: 'title', value: 'live', seq: 3 }))
    store.applyBaseline({
      summaries: [{
        sessionId: sid,
        updatedAt: 1,
        running: false,
        blank: false,
        projections: { asOfSeq: 8, values: { title: 'renamed-on-web' } },
      } as never],
      workspaces: [],
    })

    expect(store.title('s-1')).toBe('renamed-on-web')
  })

  it('leaves host frames alone when the baseline carries no projections', () => {
    const store = new SessionStore()
    store.applyBaseline({
      summaries: [{ sessionId: sid, updatedAt: 1, running: false, blank: false } as never],
      workspaces: [],
    })

    expect(store.title('s-1')).toBeUndefined()
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
