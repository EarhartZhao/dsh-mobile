/**
 * Reading a subagent is reading it whole: the panel's first page must pull the
 * rest on its own, the same way the chat screen does for a Session.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from './Touchable'
import type { ConnectionManager } from '@dsh-mobile/core'
import type { SubagentCatalog } from '@dsh-mobile/protocol'

/**
 * `t` is one stable function, the way the real provider hands it over: a fresh
 * identity per render would re-run the panel's effects on every render.
 */
const mockT = (key: string, values?: Record<string, string | number>): string =>
  values === undefined ? key : `${key}(${Object.values(values).join(',')})`

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({ locale: 'zh-CN', t: mockT }),
}))

import { SubagentPanel } from './SubagentPanel'

/** A history page of one user message per seq, oldest first. */
function page(seqs: number[], hasMore: boolean) {
  return {
    result: {
      ok: true,
      value: {
        events: seqs.map(seq => ({
          event: {
            type: 'user/message', seq, time: seq,
            data: { content: [{ type: 'text', text: `消息 ${seq}` }] },
          },
        })),
        hasMore,
      },
    },
  }
}

const CATALOG = {
  parentAvailable: true,
  entries: [{
    kind: 'child' as const, id: 'child-1', activity: 'inactive' as const,
    hasChildren: false, mode: 'one-shot' as const, label: '子代理甲',
  }],
} as unknown as SubagentCatalog

const trees: renderer.ReactTestRenderer[] = []

function render(manager: ConnectionManager): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  act(() => {
    tree = renderer.create(
      <SubagentPanel
        manager={manager}
        parentSessionId="parent-1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onOpenSession={jest.fn()}
      />,
    )
  })
  trees.push(tree)
  return tree
}

/** Every string currently on screen, joined for `toContain` assertions. */
function screenText(tree: renderer.ReactTestRenderer): string {
  const parts: string[] = []
  const walk = (node: renderer.ReactTestInstance): void => {
    for (const child of node.children) {
      if (typeof child === 'string') parts.push(child)
      else if (typeof child !== 'number') walk(child)
    }
  }
  walk(tree.root)
  return parts.join('|')
}

/** The catalog row's own button, not a link inside the detail card. */
function openEntry(tree: renderer.ReactTestRenderer): void {
  const rows = tree.root.findAllByType(TouchableOpacity)
  const row = rows.find(node => {
    const texts: string[] = []
    const walk = (child: renderer.ReactTestInstance | string | number): void => {
      if (typeof child === 'string') texts.push(child)
      else if (typeof child === 'number') return
      else child.children.forEach(walk)
    }
    node.children.forEach(walk)
    return texts.includes('子代理甲')
  })
  expect(row).toBeDefined()
  act(() => { row!.props.onPress() })
}

/**
 * The panel re-renders per state update, so a page that landed is only on
 * screen after the microtask queue has drained.
 */
async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

function setup() {
  const history = jest.fn()
  const manager = {
    client: { subagents: { history } },
  } as unknown as ConnectionManager
  return { manager, history }
}

afterEach(() => {
  act(() => {
    for (const tree of trees) tree.unmount()
  })
  trees.length = 0
})

describe('SubagentPanel history backfill', () => {
  it('walks the rest of a long transcript on its own, one page at a time', async () => {
    const { manager, history } = setup()
    history
      .mockResolvedValueOnce(page([5, 6], true))
      .mockResolvedValueOnce(page([3, 4], true))
      .mockResolvedValueOnce(page([1, 2], false))
    const tree = render(manager)

    openEntry(tree)
    await settle()
    await settle()

    expect(history.mock.calls.map(call => call[0].beforeSeq)).toEqual([undefined, 5, 3])
    expect(screenText(tree)).toContain('消息 1')
    expect(screenText(tree)).toContain('消息 6')
    // The log is exhausted, so the manual loader is gone too.
    expect(screenText(tree)).not.toContain('subagent.loadOlder')
    expect(screenText(tree)).not.toContain('subagent.backfilling')
  })

  it('stops the walk on pause instead of pulling the next page', async () => {
    const { manager, history } = setup()
    let release: (value: unknown) => void = () => undefined
    history
      .mockResolvedValueOnce(page([5, 6], true))
      .mockReturnValueOnce(new Promise<unknown>(resolve => { release = resolve }))
    const tree = render(manager)

    openEntry(tree)
    await settle()
    expect(screenText(tree)).toContain('subagent.backfilling(0)')

    const pause = tree.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityLabel === 'subagent.pauseBackfill').at(-1)
    expect(pause).toBeDefined()
    act(() => { pause!.props.onPress() })
    await act(async () => { release(page([3, 4], true)) })
    await settle()

    expect(history).toHaveBeenCalledTimes(2)
    expect(screenText(tree)).toContain('subagent.loadOlder')
  })
})
