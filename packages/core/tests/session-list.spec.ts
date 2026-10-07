import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@dsh-mobile/protocol'
import { archivedSessions, isSubagentSession, listedSessions } from '../src/session-list.ts'

function summary(sessionId: string, extra: Record<string, unknown> = {}): SessionSummary {
  return { sessionId, blank: false, updatedAt: 0, running: false, ...extra } as unknown as SessionSummary
}

describe('session list visibility', () => {
  it('hides subagent children, the way the Web sidebar does', () => {
    /**
     * A delegating turn writes one child per agent, each seeded with the
     * parent's prompt. They used to land in the App's 未分组 bucket as a run of
     * rows that read like duplicates of the same chat.
     */
    const rows = [
      summary('root'),
      summary('child', { origin: 'subagent', parentSessionId: 'root' }),
    ]

    expect(listedSessions(rows, { archivedSessionIds: [] }).map(s => s.sessionId)).toEqual(['root'])
    expect(archivedSessions(rows, ['root', 'child']).map(s => s.sessionId)).toEqual(['root'])
  })

  it('keeps a fork visible: lineage is not delegation', () => {
    // Forks carry `parentSessionId` and no `origin`; only spawns are subagents.
    const rows = [summary('forked', { parentSessionId: 'root' })]

    expect(listedSessions(rows, { archivedSessionIds: [] }).map(s => s.sessionId)).toEqual(['forked'])
    expect(isSubagentSession(rows[0]!)).toBe(false)
  })

  it('shows one blank row, the one the user is in', () => {
    const rows = [summary('blank', { blank: true }), summary('other-blank', { blank: true }), summary('named')]

    expect(listedSessions(rows, { currentSessionId: 'blank', archivedSessionIds: [] }).map(s => s.sessionId))
      .toEqual(['blank', 'named'])
    expect(listedSessions(rows, { archivedSessionIds: [] }).map(s => s.sessionId)).toEqual(['named'])
  })

  it('keeps archived rows out of the ordinary list', () => {
    const rows = [summary('kept'), summary('archived')]

    expect(listedSessions(rows, { archivedSessionIds: ['archived'] }).map(s => s.sessionId)).toEqual(['kept'])
    expect(archivedSessions(rows, ['archived']).map(s => s.sessionId)).toEqual(['archived'])
  })
})
