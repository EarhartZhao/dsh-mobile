import { sessionReferenceText } from './session-references'

describe('sessionReferenceText', () => {
  it('keeps the session title and shows a foreign working directory', () => {
    expect(sessionReferenceText(
      { label: 'Release checklist', cwd: '/home/u/other', sameWorkspace: false },
      'Session',
    )).toEqual({ title: 'Release checklist', subtitle: '/home/u/other' })
  })

  it('names a same-workspace session instead of repeating the path', () => {
    expect(sessionReferenceText(
      { label: 'Release checklist', cwd: '/home/u/proj', sameWorkspace: true },
      'Session',
    )).toEqual({ title: 'Release checklist', subtitle: 'Session' })
  })

  it('prefers the subagent display title and keeps the session title beside it', () => {
    expect(sessionReferenceText(
      { label: 'Release checklist', displayTitle: 'Check the release notes', cwd: '/home/u/proj', sameWorkspace: true },
      'Session',
    )).toEqual({ title: 'Check the release notes', subtitle: 'Release checklist · Session' })
  })

  it('falls back to the session title when a host reports no display title', () => {
    // dsh before 0.1.6-alpha.2 never sends the field; an empty one adds nothing.
    expect(sessionReferenceText(
      { label: 'Release checklist', displayTitle: 'Release checklist', sameWorkspace: true },
      'Session',
    )).toEqual({ title: 'Release checklist', subtitle: 'Session' })
  })
})
