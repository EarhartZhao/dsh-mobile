import { extensionOf, imageMediaTypeOf, isMarkdown, relativeImageRefs } from './file-kinds'

describe('file kinds', () => {
  it('reads the extension of the last path segment', () => {
    expect(extensionOf('/repo/docs/README.MD')).toBe('md')
    expect(extensionOf('C:\\repo\\shot.PNG')).toBe('png')
    expect(extensionOf('Makefile')).toBe('')
    expect(extensionOf('.gitignore')).toBe('')
  })

  it('maps only previewable image kinds', () => {
    expect(imageMediaTypeOf('img/shot.jpeg')).toBe('image/jpeg')
    expect(imageMediaTypeOf('notes.txt')).toBeUndefined()
  })

  it('treats md and markdown as markdown', () => {
    expect(isMarkdown('docs/guide.md')).toBe(true)
    expect(isMarkdown('docs/guide.markdown')).toBe(true)
    expect(isMarkdown('docs/guide.txt')).toBe(false)
  })

  it('keeps relative image references and drops everything else', () => {
    const text = [
      '![shot](img/shot.png)',
      '![web](https://example.com/a.png)',
      '![abs](/tmp/a.png)',
      '![anchor](#section)',
      '![angle](<./nested/logo.svg>)',
      '![doc](guide.md)',
      '![dup](img/shot.png)',
    ].join('\n')
    expect(relativeImageRefs(text)).toEqual(['img/shot.png'])
  })

  it('caps how many references one preview resolves', () => {
    const text = Array.from({ length: 8 }, (_, index) => `![i${index}](img/${index}.png)`).join('\n')
    expect(relativeImageRefs(text)).toEqual([
      'img/0.png', 'img/1.png', 'img/2.png', 'img/3.png',
    ])
  })
})
