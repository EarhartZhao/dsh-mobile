import {
  changeTouchesDirectory, joinWorkspacePath, parentWorkspacePath, sortWorkspaceEntries, workspaceCrumbs,
} from './workspace-path'

describe('workspace relative paths', () => {
  it('joins child basenames onto the current directory', () => {
    expect(joinWorkspacePath('', 'src')).toBe('src')
    expect(joinWorkspacePath('src', 'index.ts')).toBe('src/index.ts')
    expect(joinWorkspacePath('/src/app/', 'main.ts')).toBe('src/app/main.ts')
  })

  it('walks back to the parent without leaving the workspace root', () => {
    expect(parentWorkspacePath('src/app/main.ts')).toBe('src/app')
    expect(parentWorkspacePath('src')).toBe('')
    expect(parentWorkspacePath('')).toBe('')
  })

  it('builds one crumb per segment from the root', () => {
    expect(workspaceCrumbs('')).toEqual([{ name: '', path: '' }])
    expect(workspaceCrumbs('packages/core/src')).toEqual([
      { name: '', path: '' },
      { name: 'packages', path: 'packages' },
      { name: 'core', path: 'packages/core' },
      { name: 'src', path: 'packages/core/src' },
    ])
  })

  it('orders directories before files and keeps other kinds last', () => {
    const sorted = sortWorkspaceEntries([
      { name: 'z.txt', type: 'file' as const },
      { name: 'link', type: 'other' as const },
      { name: 'b-dir', type: 'directory' as const },
      { name: 'a.txt', type: 'file' as const },
      { name: 'a-dir', type: 'directory' as const },
    ])
    expect(sorted.map(entry => entry.name)).toEqual(['a-dir', 'b-dir', 'a.txt', 'z.txt', 'link'])
  })

  it('refreshes only for changes inside the shown directory', () => {
    expect(changeTouchesDirectory('src', 'src/a.ts')).toBe(true)
    expect(changeTouchesDirectory('src', 'a.ts')).toBe(false)
    expect(changeTouchesDirectory('src', 'src/nested/a.ts')).toBe(false)
    expect(changeTouchesDirectory('', 'a.ts')).toBe(true)
    expect(changeTouchesDirectory('src/app/', 'src/app/a.ts')).toBe(true)
    // No resolvable workspace path: refresh rather than show a stale listing.
    expect(changeTouchesDirectory('src', undefined)).toBe(true)
  })
})
