import { sessionSections } from './session-sections'
import type { SessionSummary, WorkspaceView } from '@dsh-mobile/protocol'

function summary(sessionId: string, blank = false) {
  return { sessionId, blank, updatedAt: 0, running: false } as unknown as SessionSummary
}

function workspace(workspaceId: string, title: string, sessionIds: string[]) {
  return { workspaceId, title, sessionIds } as unknown as WorkspaceView
}

describe('sessionSections', () => {
  it('groups rows under their workspace, in workspace order', () => {
    const sections = sessionSections({
      workspaces: [workspace('w1', 'A', ['s1', 's2']), workspace('w2', 'B', ['s3'])],
      summaries: [summary('s1'), summary('s2'), summary('s3')],
      archivedSessionIds: [],
    })

    expect(sections.map(section => [section.title, section.sessionIds])).toEqual([
      ['A', ['s1', 's2']],
      ['B', ['s3']],
    ])
  })

  it('collects rows that belong to no workspace into a trailing ungrouped section', () => {
    const sections = sessionSections({
      workspaces: [workspace('w1', 'A', ['s1'])],
      summaries: [summary('s1'), summary('loose')],
      archivedSessionIds: [],
    })

    const last = sections.at(-1)!
    expect(last.workspaceId).toBeNull()
    expect(last.sessionIds).toEqual(['loose'])
  })

  it('drops blank and archived rows everywhere', () => {
    const sections = sessionSections({
      workspaces: [workspace('w1', 'A', ['s1', 'blank', 'archived'])],
      summaries: [summary('s1'), summary('blank', true), summary('archived'), summary('loose')],
      archivedSessionIds: ['archived'],
    })

    expect(sections.map(section => section.sessionIds)).toEqual([['s1'], ['loose']])
  })

  it('omits a workspace whose rows are all hidden, and an empty ungrouped section', () => {
    const sections = sessionSections({
      workspaces: [workspace('w1', 'A', ['blank']), workspace('w2', 'B', ['s1'])],
      summaries: [summary('blank', true), summary('s1')],
      archivedSessionIds: [],
    })

    // A header with nothing under it is noise; the workspace chip still lists A.
    expect(sections.map(section => section.title)).toEqual(['B'])
  })

  it('keeps a section when its workspace is not listed but its rows exist', () => {
    const sections = sessionSections({
      workspaces: [],
      summaries: [summary('s1')],
      archivedSessionIds: [],
    })

    expect(sections).toHaveLength(1)
    expect(sections[0]!.sessionIds).toEqual(['s1'])
    expect(sections[0]!.workspaceId).toBeNull()
  })
})
