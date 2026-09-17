import React from 'react'
import renderer, { act } from 'react-test-renderer'
import type { ConnectionManager } from '@dsh-mobile/core'

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({ t: (key: string) => key }),
}))

import { SessionListScreen } from './SessionListScreen'

/** Only the surface the list touches; the unpair affordance must be gone. */
const manager = {
  compatibility: { pluginVersion: '0.2.7', mobileApi: 2, features: [] },
  client: null,
  refreshBaseline: jest.fn(),
  store: {
    on: () => () => undefined,
    summaries: [
      { sessionId: 's1', blank: false, updatedAt: 3, running: false, projections: { asOfSeq: 1, values: { title: '问候开场2' } } },
      { sessionId: 's2', blank: false, updatedAt: 2, running: false },
      { sessionId: 'loose', blank: false, updatedAt: 1, running: false },
    ],
    workspaces: [{ workspaceId: 'w1', title: 'dsh', path: '/tmp/dsh', sessionIds: ['s1', 's2'], createdAt: '' }],
    archivedSessionIds: [],
    sessions: new Map(),
    title: (sessionId: string) =>
      sessionId === 's1' ? '问候开场2' : sessionId === 's2' ? '第二个会话' : undefined,
  },
} as unknown as ConnectionManager

const trees: renderer.ReactTestRenderer[] = []

function render() {
  let tree!: renderer.ReactTestRenderer
  act(() => {
    tree = renderer.create(
      <SessionListScreen manager={manager} onOpenSession={jest.fn()} onOpenSettings={jest.fn()} />,
    )
  })
  trees.push(tree)
  return tree
}

// VirtualizedList schedules a cells-to-render timeout. Left mounted, it fires
// after Jest tears the environment down and reports "Cannot log after tests
// are done", which can fail an otherwise passing run.
afterEach(() => {
  act(() => {
    for (const tree of trees) tree.unmount()
  })
  trees.length = 0
})

describe('SessionListScreen header', () => {
  it('no longer offers unpairing outside of settings', () => {
    const tree = render()

    expect(tree.root.findAllByProps({ children: 'session.unpair' })).toHaveLength(0)
  })
})

describe('SessionListScreen grouping', () => {
  it('heads each workspace and buckets rows that belong to none', () => {
    const tree = render()

    // Workspace header resolves from the workspace title; the loose row lands
    // in the trailing bucket rather than being dropped.
    expect(tree.root.findAllByProps({ children: 'dsh' }).length).toBeGreaterThan(0)
    expect(tree.root.findAllByProps({ children: 'session.ungrouped' }).length).toBeGreaterThan(0)
    expect(tree.root.findAllByProps({ children: '第二个会话' }).length).toBeGreaterThan(0)
  })

  it('hides a section’s rows once its header is tapped, and restores them', () => {
    const tree = render()
    const header = tree.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityRole === 'button' &&
      node.props.accessibilityLabel === 'dsh',
    ).at(-1)

    act(() => { header!.props.onPress() })
    expect(tree.root.findAllByProps({ children: '第二个会话' })).toHaveLength(0)

    act(() => { header!.props.onPress() })
    expect(tree.root.findAllByProps({ children: '第二个会话' }).length).toBeGreaterThan(0)
  })

  it('offers rename, fork, and archive from a session long-press', () => {
    const tree = render()
    const row = tree.root.findAll(node =>
      typeof node.props.onLongPress === 'function' &&
      node.findAllByProps({ children: '第二个会话' }).length > 0,
    ).at(-1)

    act(() => { row!.props.onLongPress() })

    for (const label of ['common.rename', 'session.fork', 'common.archive']) {
      expect(tree.root.findAllByProps({ children: label }).length).toBeGreaterThan(0)
    }
  })

  it('draws the same disclosure glyph whether open or closed', () => {
    const tree = render()
    // Two different triangle characters render at different sizes in the same
    // font, so the arrow visibly changed size on collapse. One glyph the
    // component rotates keeps the two states identical.
    // Scoped to this section's own header: another section's untouched arrow
    // would otherwise make the comparison pass without testing anything.
    const header = (): renderer.ReactTestInstance => tree.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityRole === 'button' &&
      node.props.accessibilityLabel === 'dsh',
    ).at(-1)!
    const glyph = (): unknown => header().findAll(node =>
      typeof node.props.children === 'string' && '▼▶▾▸'.includes(node.props.children),
    ).at(-1)?.props.children

    const expanded = glyph()
    act(() => { header().props.onPress() })
    const collapsed = glyph()

    expect(['▼', '▶', '▾', '▸']).toContain(expanded)
    expect(collapsed).toBe(expanded)
  })
})
