/**
 * The code panel's contract: it shows the block as written, labels the language
 * (or the localised fallback), copies verbatim, and scrolls that code in both
 * directions instead of folding long lines (see the comment on `CodeBlock`).
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Clipboard } from 'react-native'

jest.mock('./i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({ t: (key: string) => key }),
}))

import { CodeBlock } from './markdown'

const CONTENT = ['const longToken = \'xxxx\';', 'const spaced = "aaaa bbbb cccc";'].join('\n')

function mount(node: { content: string; attributes?: unknown } = {
  content: CONTENT,
  attributes: { info: 'ts' },
}): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  act(() => {
    tree = renderer.create(<CodeBlock node={node} />)
  })
  return tree
}

describe('CodeBlock', () => {
  it('shows the code exactly as written, under its language chip', () => {
    const tree = mount()

    expect(tree.root.findAllByProps({ children: CONTENT }).length).toBeGreaterThan(0)
    expect(tree.root.findAllByProps({ children: 'ts' }).length).toBeGreaterThan(0)
  })

  it('falls back to the localised label when the fence names no language', () => {
    const tree = mount({ content: 'plain' })

    expect(tree.root.findAllByProps({ children: 'chat.code' }).length).toBeGreaterThan(0)
  })

  it('copies the block verbatim from the panel button', () => {
    const setString = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {})
    const tree = mount()
    const copy = tree.root.findAll(node =>
      node.props.accessibilityLabel === 'common.copy' && typeof node.props.onPress === 'function',
    ).at(-1)

    act(() => { copy!.props.onPress() })

    expect(setString).toHaveBeenCalledWith(CONTENT)
    setString.mockRestore()
  })

  it('scrolls the code instead of folding its lines', () => {
    const tree = mount()

    expect(tree.root.findAll(node => node.props.horizontal === true).length).toBeGreaterThan(0)
  })
})
