import { describe, expect, it } from 'vitest'
import { increasedForkTitle, sessionDisplayTitle, sessionRowTitle, shortSessionId, workspaceBasename } from '../src/titles.ts'

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

  it('steps a fork child title up the way the web does', () => {
    // The child must not read as its source in the list; the web's fork
    // service applies exactly these three shapes.
    expect(increasedForkTitle('课程规划')).toBe('课程规划 (1)')
    expect(increasedForkTitle('课程规划 (1)')).toBe('课程规划 (2)')
    expect(increasedForkTitle('课程规划（2）')).toBe('课程规划（3）')
    // An untitled session keeps its empty title rather than gaining a suffix.
    expect(increasedForkTitle('')).toBe('')
    expect(increasedForkTitle('   ')).toBe('   ')
  })

  it('shortens a session id past the prefix that identifies nothing', () => {
    // Every id carries `session-`, so taking the first eight characters used
    // to spell the prefix and nothing else.
    expect(shortSessionId('session-72d46602-ccc5-4665-a3d0-109d8e557f21')).toBe('72d46602')
    expect(shortSessionId('session-72d46602-ccc5')).toBe('72d46602')
    // An id without the prefix, a shorter one, and the empty string all pass
    // through without inventing characters.
    expect(shortSessionId('abc12345')).toBe('abc12345')
    expect(shortSessionId('session-ab')).toBe('ab')
    expect(shortSessionId('')).toBe('')
  })
})
