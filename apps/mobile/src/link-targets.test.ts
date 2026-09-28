import { linkTarget } from './link-targets'

describe('linkTarget', () => {
  it('sends real URLs to the OS', () => {
    expect(linkTarget('https://github.com/x/y')).toEqual({ kind: 'external', url: 'https://github.com/x/y' })
    expect(linkTarget('http://127.0.0.1:3080/')).toMatchObject({ kind: 'external' })
    expect(linkTarget('mailto:a@b.c')).toMatchObject({ kind: 'external' })
    // Surrounding whitespace in a Markdown target is not part of the URL.
    expect(linkTarget('  https://example.com/a  ')).toEqual({ kind: 'external', url: 'https://example.com/a' })
  })

  it('reads the file references these transcripts are full of as files', () => {
    // A relative path has no scheme, so the renderer's default Linking.openURL
    // rejected it and the tap did nothing at all.
    expect(linkTarget('docs/architecture.md')).toEqual({ kind: 'file', path: 'docs/architecture.md' })
    expect(linkTarget('./packages/core/src/index.ts')).toMatchObject({ kind: 'file' })
    expect(linkTarget('/etc/hosts')).toEqual({ kind: 'file', path: '/etc/hosts' })
    expect(linkTarget('C:\\code\\dsh\\README.md')).toEqual({ kind: 'file', path: 'C:\\code\\dsh\\README.md' })
    expect(linkTarget('C:/code/dsh/README.md')).toMatchObject({ kind: 'file' })
    expect(linkTarget('file:///C:/code/dsh/a.ts')).toEqual({ kind: 'file', path: '/C:/code/dsh/a.ts' })
  })

  it('drops the part of a file link a preview cannot honour', () => {
    expect(linkTarget('docs/a.md#L10')).toEqual({ kind: 'file', path: 'docs/a.md' })
    expect(linkTarget('docs/a.md?plain=1')).toEqual({ kind: 'file', path: 'docs/a.md' })
    expect(linkTarget('docs/my%20file.md')).toEqual({ kind: 'file', path: 'docs/my file.md' })
  })

  it('ignores anchors and vocabularies this build has no handler for', () => {
    expect(linkTarget('#section')).toEqual({ kind: 'ignore' })
    expect(linkTarget('   ')).toEqual({ kind: 'ignore' })
    // Session and resource references are host-side vocabulary; opening them
    // here would mean inventing behaviour the web does not have either.
    expect(linkTarget('dsh-session:c291cmNl')).toEqual({ kind: 'ignore' })
    expect(linkTarget('dsh-resource://plan-review/x')).toEqual({ kind: 'ignore' })
    expect(linkTarget('javascript:alert(1)')).toEqual({ kind: 'ignore' })
  })
})
