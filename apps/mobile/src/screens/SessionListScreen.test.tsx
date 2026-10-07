import React from 'react'
import { FlatList, TextInput } from 'react-native'
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
  /** The list refreshes a stale baseline when it appears; the stub just resolves. */
  refreshBaselineIfStale: jest.fn().mockResolvedValue(undefined),
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

function render(source: ConnectionManager = manager) {
  let tree!: renderer.ReactTestRenderer
  act(() => {
    tree = renderer.create(
      <SessionListScreen manager={source} onOpenSession={jest.fn()} onOpenSettings={jest.fn()} />,
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
  it('centers the empty pane when a workspace chip filters the list to nothing', () => {
    /**
     * The pane's centering used to key off `visible` (sessions that exist
     * anywhere); picking an empty workspace left a non-empty `visible` and no
     * rows, so the message rendered bare against the top-left corner.
     */
    const withEmptyWorkspace = {
      ...manager,
      store: {
        ...manager.store,
        workspaces: [
          { workspaceId: 'w1', title: 'dsh', path: '/tmp/dsh', sessionIds: ['s1'], createdAt: '' },
          { workspaceId: 'w2', title: '空工作区', path: '/tmp/empty', sessionIds: [], createdAt: '' },
        ],
      },
    } as unknown as ConnectionManager
    const tree = render(withEmptyWorkspace)
    const chip = tree.root.findAll(node =>
      typeof node.props.onPress === 'function' && node.findAllByProps({ children: '空工作区' }).length > 0,
    ).at(-1)

    act(() => { chip!.props.onPress() })

    const list = tree.root.findByType(FlatList)
    expect(list.props.contentContainerStyle).toMatchObject({ flexGrow: 1, alignItems: 'center' })
    expect(tree.root.findAllByProps({ children: 'session.noSessions' }).length).toBeGreaterThan(0)
  })

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
    // The two states share one chevron-down glyph; collapsing only rotates its
    // container, so the mark never changes size the way the two triangle
    // characters it replaced did.
    // Scoped to this section's own header: another section's untouched arrow
    // would otherwise make the comparison pass without testing anything.
    const header = (): renderer.ReactTestInstance => tree.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityRole === 'button' &&
      node.props.accessibilityLabel === 'dsh',
    ).at(-1)!
    const glyph = (): unknown => header().findAll(node =>
      typeof node.props?.name === 'string',
    ).at(-1)?.props.name

    const expanded = glyph()
    act(() => { header().props.onPress() })
    const collapsed = glyph()

    expect(expanded).toBe('ChevronDownOutline')
    expect(collapsed).toBe(expanded)
  })

  /**
   * `session.list` ships every Session, subagent children included: one
   * delegating turn leaves a child per agent, each seeded with the parent's own
   * prompt, and the list rendered them as a run of rows that read like
   * duplicates of the same chat. The Web sidebar filters them out
   * (`sessionVisible`), so the App does too.
   */
  const withChild = (): ConnectionManager => ({
    ...manager,
    store: {
      ...manager.store,
      summaries: [
        ...manager.store.summaries,
        {
          sessionId: 'child', blank: false, updatedAt: 4, running: false,
          origin: 'subagent', parentSessionId: 's1', projections: { asOfSeq: 1, values: { title: '子代理会话' } },
        },
      ],
      title: (sessionId: string) => sessionId === 'child' ? '子代理会话' : manager.store.title(sessionId),
    },
  }) as unknown as ConnectionManager

  it('never lists a subagent child the host reports', () => {
    const tree = render(withChild())

    expect(tree.root.findAllByProps({ children: '子代理会话' })).toHaveLength(0)
    // The parent it was delegated from keeps its row.
    expect(tree.root.findAllByProps({ children: '第二个会话' }).length).toBeGreaterThan(0)
  })

  it('drops subagent children from search results too', async () => {
    const client = {
      sessions: {
        search: jest.fn().mockResolvedValue({
          result: {
            ok: true,
            value: {
              items: [
                { sessionId: 's2', snippet: '命中父会话' },
                { sessionId: 'child', snippet: '命中子代理' },
              ],
              hasMore: false,
            },
          },
        }),
      },
    }
    const tree = render({ ...withChild(), client } as unknown as ConnectionManager)
    const input = tree.root.findByType(TextInput)

    act(() => { input.props.onChangeText('天津') })
    await act(async () => { input.props.onSubmitEditing() })

    expect(tree.root.findAllByProps({ children: '命中父会话' }).length).toBeGreaterThan(0)
    expect(tree.root.findAllByProps({ children: '命中子代理' })).toHaveLength(0)
  })
})
