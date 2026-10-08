import { foldPath } from './path-label'

describe('foldPath', () => {
  it('keeps the identifying tail of a deep POSIX path', () => {
    expect(foldPath('/Users/mac/Documents/code/mine/dsh/deepseek-harness'))
      .toBe('…/dsh/deepseek-harness')
  })

  it('folds a Windows path the same way, whatever separators it was written with', () => {
    expect(foldPath('E:\\Users\\admin\\.dsh\\profiles\\web'))
      .toBe('…/profiles/web')
  })

  it('leaves a path that already fits alone', () => {
    expect(foldPath('/Users/mac')).toBe('/Users/mac')
    expect(foldPath('/srv/app')).toBe('/srv/app')
  })

  it('keeps the root readable rather than folding it into an ellipsis', () => {
    expect(foldPath('/')).toBe('/')
    expect(foldPath('/srv/')).toBe('/srv')
  })

  it('honours a different depth', () => {
    expect(foldPath('/a/b/c/d/e', 1)).toBe('…/e')
    expect(foldPath('/a/b/c/d/e', 3)).toBe('…/c/d/e')
  })
})
