/**
 * Which `session.list` rows the App's list shows.
 *
 * The host ships *every* Session, subagent children included: one delegating
 * turn writes a child Session per agent (the 天津 delegation run left 17), each
 * seeded with the parent's own prompt, so the App rendered them as a run of
 * rows that read like duplicates of the same chat. The Web sidebar hides them
 * (`packages/client/ui-workspace/src/client/tree.ts`, `sessionVisible`:
 * `if (session.origin === 'subagent') return false`); their only entry point is
 * the parent's lineage, and the App reaches them the same way — through the
 * subagent panel — never as list rows.
 *
 * Kept out of the store on purpose: `summaries` stays the full registry so an
 * opened child can still resolve its own title, preset and lineage.
 */
import type { SessionSummary } from '@dsh-mobile/protocol'

export interface SessionListFilter {
  /**
   * Session the list keeps visible while it is still blank: the Web sidebar
   * shows exactly one provisional "New Session" row instead of hiding every
   * chat that has not been sent to yet.
   */
  currentSessionId?: string | null | undefined
  archivedSessionIds: readonly string[]
}

/** Subagent children belong to their parent's lineage, never to the list. */
export function isSubagentSession(summary: SessionSummary): boolean {
  return summary.origin === 'subagent'
}

/** Rows of the ordinary list: no subagents, no archived rows, only the current blank. */
export function listedSessions(
  summaries: readonly SessionSummary[],
  filter: SessionListFilter,
): SessionSummary[] {
  return summaries.filter(summary =>
    !isSubagentSession(summary)
    && (!summary.blank || summary.sessionId === (filter.currentSessionId ?? null))
    && !filter.archivedSessionIds.includes(summary.sessionId))
}

/** Rows of the archived view; subagent children stay hidden there too. */
export function archivedSessions(
  summaries: readonly SessionSummary[],
  archivedSessionIds: readonly string[],
): SessionSummary[] {
  return summaries.filter(summary =>
    !isSubagentSession(summary) && archivedSessionIds.includes(summary.sessionId))
}
