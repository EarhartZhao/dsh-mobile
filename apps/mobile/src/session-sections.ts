/**
 * Session-list grouping. The list used to be one flat run of rows with a
 * workspace chip acting as a filter; the web sidebar instead groups rows under
 * their workspace with a trailing "ungrouped" bucket, which is what this
 * reproduces. Kept pure so the ordering and filtering rules stay testable.
 */
import type { SessionSummary, WorkspaceView } from '@dsh-mobile/protocol'

export interface SessionSection {
  /** Workspace id, or null for the ungrouped bucket. */
  workspaceId: string | null
  /** Workspace title; null for the ungrouped bucket (the caller labels it). */
  title: string | null
  sessionIds: string[]
}

export interface SessionSectionsInput {
  workspaces: WorkspaceView[]
  summaries: SessionSummary[]
  archivedSessionIds: string[]
}

/**
 * Visible rows grouped by workspace, in the host's manually owned order, with
 * sessions that belong to no workspace collected last. Sections with nothing
 * to show are dropped rather than rendered as an empty header.
 */
export function sessionSections(input: SessionSectionsInput): SessionSection[] {
  const visible = input.summaries.filter(
    summary => !summary.blank && !input.archivedSessionIds.includes(summary.sessionId),
  )
  const visibleIds = new Set<string>(visible.map(summary => summary.sessionId))
  const claimed = new Set<string>()
  const sections: SessionSection[] = []

  for (const workspace of input.workspaces) {
    const sessionIds = workspace.sessionIds.filter(id => visibleIds.has(id))
    if (sessionIds.length === 0) continue
    for (const id of sessionIds) claimed.add(id)
    sections.push({ workspaceId: workspace.workspaceId, title: workspace.title, sessionIds })
  }

  const ungrouped = visible
    .map(summary => summary.sessionId)
    .filter(id => !claimed.has(id))
  if (ungrouped.length > 0) sections.push({ workspaceId: null, title: null, sessionIds: ungrouped })

  return sections
}
