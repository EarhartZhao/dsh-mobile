import { describe, expect, it } from 'vitest'
import { sessionDisplayTitle, sessionRowTitle, workspaceBasename } from '../src/titles.ts'

describe('session labels', () => {
  it('takes the workspace basename for both separator styles', () => {
    expect(workspaceBasename('/work/project/')).toBe('project')
    expect(workspaceBasename('C:\\code\\learner')).toBe('learner')
    expect(workspaceBasename('')).toBe('')
    expect(workspaceBasename(undefined)).toBe('')
  })

  it('names the header by title, then workspace name, then id', () => {
    expect(sessionDisplayTitle({ title: '问候', cwd: 'C:\\code\\learner', sessionId: 's-1' })).toBe('问候')
    expect(sessionDisplayTitle({ title: '  ', cwd: 'C:\\code\\learner', sessionId: 's-1' })).toBe('learner')
    expect(sessionDisplayTitle({ cwd: 'C:\\code\\learner', sessionId: 's-1' })).toBe('learner')
    expect(sessionDisplayTitle({ sessionId: 's-1' })).toBe('s-1')
  })

  it('labels a row by the provisional name, then the title, then untitled', () => {
    const labels = { blank: '新会话', untitled: '未命名' }
    expect(sessionRowTitle({ blank: true }, labels)).toBe('新会话')
    expect(sessionRowTitle({ blank: false, title: '问候' }, labels)).toBe('问候')
    expect(sessionRowTitle({ blank: false }, labels)).toBe('未命名')
    expect(sessionRowTitle({ blank: false, title: '   ' }, labels)).toBe('未命名')
    // A path is never a row title, matching the Web sidebar.
    expect(sessionRowTitle({ blank: false, title: null }, labels)).toBe('未命名')
  })
})
