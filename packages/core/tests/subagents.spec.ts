import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@dsh-mobile/protocol'
import { RpcId } from '@dsh-mobile/protocol'
import { SessionStore } from '../src/session-store.ts'
import { subagentAddress, subagentCount, subagentRows } from '../src/subagents.ts'

const parentId = 'parent'

/**
 * One `session/list` row with just the facts these rows read.
 *
 * Overrides stay a plain record rather than `Partial<SessionSummary>`: the
 * contract brands ids, and a fixture that has to cast every literal id it
 * writes would be noise. The final cast is the one that asserts the shape.
 */
function summary(sessionId: string, overrides: Record<string, unknown> = {}): SessionSummary {
  return { sessionId, updatedAt: 0, running: false, blank: false, ...overrides } as SessionSummary
}

/** Push one `session/projection` value into the store, as the mux does. */
function project(store: SessionStore, sessionId: string, key: string, value: unknown, seq = 1): void {
  store.applyMuxFrame(RpcId(crypto.randomUUID()), {
    type: 'session/projection', sessionId, key, value, seq,
  } as never)
}

describe('subagentRows', () => {
  it('names the parent\u2019s direct children from its own catalog projection', () => {
    const store = new SessionStore()
    store.applyBaseline({
      summaries: [summary(parentId), summary('child-1'), summary('child-2')],
      workspaces: [],
    })
    project(store, parentId, 'subagentCatalog', [
      { id: 'child-1', createdAt: 1, mode: 'continuable', label: '重庆区县经济数据' },
      { id: 'child-2', createdAt: 2, mode: 'one-shot' },
    ])
    const rows = subagentRows(store, parentId, 1_000)
    expect(rows.map(row => [row.id, row.label, row.mode])).toEqual([
      ['child-1', '重庆区县经济数据', 'continuable'],
      ['child-2', 'child-2', 'one-shot'],
    ])
    // An unlabeled one-shot falls back to its id, the Web's own rule.
    expect(subagentCount(rows)).toEqual({ count: 2, running: 0 })
  })

  it('reads liveness from the list, and completion only from a closed turn', () => {
    const store = new SessionStore()
    store.applyBaseline({
      summaries: [summary(parentId), summary('child-1', { running: true }), summary('child-2')],
      workspaces: [],
    })
    project(store, parentId, 'subagentCatalog', [
      { id: 'child-1', createdAt: 1, mode: 'continuable', label: 'running one' },
      { id: 'child-2', createdAt: 2, mode: 'one-shot', label: 'finished one' },
    ])
    project(store, 'child-1', 'subagentTiming', { settledMs: 10_000, active: { since: 60_000, through: 61_000 } })
    project(store, 'child-2', 'subagentTiming', { settledMs: 151_000, lastTurnCompleted: true })
    const now = 65_000
    const rows = subagentRows(store, parentId, now)
    // A running child's open interval is measured to `now`; a stopped one keeps
    // the projection's own cut, so its clock does not keep running.
    expect(rows[0]).toMatchObject({ activity: 'running', completed: false, activeMs: 15_000 })
    expect(rows[1]).toMatchObject({ activity: 'inactive', completed: true, activeMs: 151_000 })
    expect(subagentCount(rows)).toEqual({ count: 2, running: 1 })
  })

  it('does not call an inactive child complete without the projection\u2019s word', () => {
    const store = new SessionStore()
    store.applyBaseline({ summaries: [summary(parentId), summary('child-1')], workspaces: [] })
    project(store, parentId, 'subagentCatalog', [{ id: 'child-1', createdAt: 1, mode: 'one-shot' }])
    project(store, 'child-1', 'subagentTiming', { settledMs: 5_000 })
    expect(subagentRows(store, parentId, 0)[0]).toMatchObject({ activity: 'inactive', completed: false })
  })

  it('sums the four usage buckets and carries the child\u2019s own title', () => {
    const store = new SessionStore()
    store.applyBaseline({ summaries: [summary(parentId), summary('child-1')], workspaces: [] })
    project(store, parentId, 'subagentCatalog', [{ id: 'child-1', createdAt: 1, mode: 'continuable', label: 'data' }])
    project(store, 'child-1', 'tokenUsage', {
      uncachedInputTokens: 1_000, outputTokens: 500, cacheReadTokens: 880_000, cacheWriteTokens: 500,
    })
    project(store, 'child-1', 'title', '重庆区县经济数据')
    expect(subagentRows(store, parentId, 0)[0]).toMatchObject({ tokens: 882_000, title: '重庆区县经济数据' })
  })

  it('leaves a child metric absent when this client never saw the projection', () => {
    // A list must not invent a number it cannot read: the Web's catalog renders
    // identity alone while a child's projections are still loading.
    const store = new SessionStore()
    store.applyBaseline({ summaries: [summary(parentId), summary('child-1')], workspaces: [] })
    project(store, parentId, 'subagentCatalog', [{ id: 'child-1', createdAt: 1, mode: 'one-shot' }])
    const row = subagentRows(store, parentId, 0)[0]!
    expect(row.tokens).toBeUndefined()
    expect(row.activeMs).toBeUndefined()
    expect(row.title).toBeUndefined()
  })

  it('marks a child that is some other session\u2019s parent', () => {
    const store = new SessionStore()
    store.applyBaseline({
      summaries: [summary(parentId), summary('child-1'), summary('grandchild', { parentSessionId: 'child-1' })],
      workspaces: [],
    })
    project(store, parentId, 'subagentCatalog', [{ id: 'child-1', createdAt: 1, mode: 'continuable', label: 'branch' }])
    project(store, 'child-1', 'subagentCatalog', [{ id: 'grandchild', createdAt: 2, mode: 'one-shot', label: 'leaf' }])
    expect(subagentRows(store, parentId, 0)[0]).toMatchObject({ hasChildren: true })
    // The disclosure's own level reads the same derivation one session down.
    expect(subagentRows(store, 'child-1', 0).map(row => row.label)).toEqual(['leaf'])
  })

  it('renders nothing for a conversation with no catalog, and drops malformed rows', () => {
    const store = new SessionStore()
    store.applyBaseline({ summaries: [summary(parentId)], workspaces: [] })
    expect(subagentRows(store, parentId, 0)).toEqual([])
    project(store, parentId, 'subagentCatalog', [
      { mode: 'one-shot' },
      { id: '', createdAt: 1, mode: 'one-shot' },
      { id: 'child-1', createdAt: 1, mode: 'unknown', label: 'kept' },
      'not a row',
    ])
    expect(subagentRows(store, parentId, 0).map(row => [row.id, row.mode])).toEqual([
      ['child-1', 'unknown'],
    ])
  })
})

describe('subagentAddress', () => {
  it('names the parent and the child\u2019s cataloged mode', () => {
    const store = new SessionStore()
    store.applyBaseline({
      summaries: [summary(parentId), summary('child-1', { parentSessionId: parentId, origin: 'subagent' })],
      workspaces: [],
    })
    project(store, parentId, 'subagentCatalog', [
      { id: 'child-1', createdAt: 1, mode: 'continuable', label: 'data' },
    ])
    expect(subagentAddress(store, 'child-1')).toEqual({
      parentSessionId: parentId, childSessionId: 'child-1', mode: 'continuable',
    })
  })

  it('refuses to guess a mode the parent\u2019s catalog never carried', () => {
    // The mode is part of the address: the Host refuses an address whose mode
    // is wrong, so an unread catalog has to hold the read back rather than
    // spend a request the Host will reject.
    const store = new SessionStore()
    store.applyBaseline({
      summaries: [summary(parentId), summary('child-1', { parentSessionId: parentId, origin: 'subagent' })],
      workspaces: [],
    })
    expect(subagentAddress(store, 'child-1')).toBeNull()
    project(store, parentId, 'subagentCatalog', [{ id: 'child-1', createdAt: 1, mode: 'unknown' }])
    expect(subagentAddress(store, 'child-1')).toBeNull()
  })

  it('has no address for a top-level session, or one the list never named', () => {
    const store = new SessionStore()
    store.applyBaseline({ summaries: [summary(parentId)], workspaces: [] })
    expect(subagentAddress(store, parentId)).toBeNull()
    expect(subagentAddress(store, 'never-listed')).toBeNull()
    expect(subagentAddress(store, '')).toBeNull()
  })
})
