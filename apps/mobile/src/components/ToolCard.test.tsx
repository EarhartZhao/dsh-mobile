import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) => values === undefined
      ? key
      : Object.entries(values).map(([name, value]) => `${key}:${name}=${String(value)}`).join(','),
  }),
}))

import { ToolCard } from './ToolCard'
import type { ConversationItem } from '@dsh-mobile/core'

type ToolItem = Extract<ConversationItem, { kind: 'tool' }>

function item(overrides: Partial<ToolItem> = {}): ToolItem {
  return {
    kind: 'tool', key: 't1', seq: 1, time: 1, callId: 'c1', name: 'bash', args: '',
    status: 'done', resultPreview: '', resultText: '', resultImages: [],
    callView: null, resultView: null, subCalls: [],
    ...overrides,
  }
}

/**
 * Every distinct line of text rendered anywhere in the tree. A `<Text>` with
 * interpolated children reports them as an array, so each node's string
 * children are joined — which is exactly how it reads on screen.
 */
function texts(tree: renderer.ReactTestRenderer): string[] {
  const lines = tree.root
    .findAll(node => {
      const children: unknown = node.props?.children
      return typeof children === 'string' || (Array.isArray(children) && children.some(child => typeof child === 'string'))
    })
    .map(node => (Array.isArray(node.props.children) ? node.props.children : [node.props.children])
      .map((child: unknown) => typeof child === 'string' ? child : '')
      .join(''))
    .filter((line: string) => line !== '')
  return [...new Set(lines)]
}

/** Press the row header (the only pressable before anything is expanded). */
function expand(tree: renderer.ReactTestRenderer): void {
  const header = tree.root.findAll(node => typeof node.props.onPress === 'function').at(0)
  act(() => { header!.props.onPress() })
}

function render(value: ToolItem): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  act(() => {
    tree = renderer.create(<ToolCard item={value} manager={{} as never} sessionId="s1" />)
  })
  return tree
}

describe('ToolCard', () => {
  it('shows the raw result for a card this build does not know', () => {
    // The registry's miss rule lands here: an unknown tag keeps the host's title
    // and the model-facing result, rather than an empty panel.
    const tree = render(item({
      name: 'hologram_projector',
      resultText: 'projected three shapes',
      resultView: { card: 'hologram', title: 'Project shapes' } as never,
    }))

    expect(texts(tree)).toContain('Project shapes · projected three shapes')
    expand(tree)
    expect(texts(tree)).toContain('projected three shapes')
  })

  it('renders a terminal card with its output and exit status', () => {
    const tree = render(item({
      name: 'exec_command',
      resultText: 'a.txt\nb.txt',
      resultView: { card: 'terminal', title: 'List files', cwd: '/work', output: 'a.txt\nb.txt', exitCode: 0 } as never,
    }))

    expect(texts(tree)).toContain('List files · a.txt b.txt')
    expand(tree)
    expect(texts(tree)).toContain('/work')
    expect(texts(tree)).toContain('tools.exitCode:code=0')
  })

  it('titles the row from a call card when the result carries no view', () => {
    // `pwsh` declares `presentCall` but no `presentResult`, so a finished row has
    // only the call side to name it — the card title, not the localized tool name.
    const tree = render(item({
      name: 'pwsh',
      resultText: 'hi',
      callView: { card: 'terminal', title: 'echo hi', description: 'Echo hi' } as never,
      resultView: null,
    }))

    expect(texts(tree)).toContain('echo hi · hi')
    expect(texts(tree)).not.toContain('PowerShell')
  })

  it('keeps the call title when the result card does not name the call', () => {
    // This is what `pwsh` actually sends: the call card names the command, the
    // result card carries only output and the exit status, and the host's own
    // contract says an omitted result title keeps the pending one. Reading only
    // the result would leave the row labelled by the localized tool name.
    const tree = render(item({
      name: 'pwsh',
      resultText: 'hi',
      callView: { card: 'terminal', title: 'echo hi', description: 'Echo hi in shell' } as never,
      resultView: { card: 'terminal', output: 'hi', exitCode: 1 } as never,
    }))

    expect(texts(tree)).toContain('echo hi · hi')
    expect(texts(tree)).not.toContain('PowerShell')
    expand(tree)
    expect(texts(tree)).toContain('tools.exitCode:code=1')
  })

  it('renders a read card as numbered file lines', () => {
    const tree = render(item({
      name: 'read',
      resultView: {
        card: 'read', title: 'Read app.ts', path: 'src/app.ts', offset: 1, totalLines: 9,
        lines: [{ number: 1, text: 'const a = 1' }, { number: 2, text: 'const b = 2' }],
      } as never,
    }))

    expand(tree)
    expect(texts(tree)).toContain('src/app.ts:1')
    expect(texts(tree)).toContain('   1  const a = 1\n   2  const b = 2')
  })
})
