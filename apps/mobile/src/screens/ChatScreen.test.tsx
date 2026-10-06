/**
 * The transcript's own loading and failure surfaces.
 *
 * A tail read that is slow, or refused because the page is bigger than one NATS
 * publish, used to leave the screen blank — indistinguishable from a Session
 * that genuinely has no messages.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context'
import { SessionStore, type ConnectionManager } from '@dsh-mobile/core'

/**
 * `t` is one stable function, the way the real provider hands it over: a fresh
 * identity per render would re-run the screen's effects on every render.
 */
const mockT = (key: string, values?: Record<string, string | number>): string =>
  values === undefined ? key : `${key}(${Object.values(values).join(',')})`

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({ locale: 'zh-CN', t: mockT }),
}))

// The real renderer builds a native Markdown tree; the test only needs the text
// it was handed, so the double passes its children straight through.
jest.mock('react-native-markdown-display', () => {
  const react = jest.requireActual('react') as typeof React
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      react.createElement(react.Fragment, null, children),
  }
})

import { ChatScreen } from './ChatScreen'

const PAGE = {
  events: [{
    event: {
      type: 'user/message', seq: 1, time: 1,
      data: { content: [{ type: 'text', text: '你好' }] },
    },
  }],
  hasMore: false,
}

const okPage = () => ({ result: { ok: true, value: PAGE } })
const refusal = (message: string) => ({
  result: { ok: false, error: { code: 'internal', message, details: {} } },
})

/** A history page of one user message per seq, oldest first. */
function page(seqs: number[], hasMore: boolean) {
  return {
    events: seqs.map(seq => ({
      event: {
        type: 'user/message', seq, time: seq,
        data: { content: [{ type: 'text', text: `消息 ${seq}` }] },
      },
    })),
    hasMore,
  }
}

const okHistory = (value: ReturnType<typeof page>) => ({ result: { ok: true, value } })

/** The manager surface this screen reads, with the tail read under test. */
function setup() {
  const history = jest.fn()
  const manager = {
    store: new SessionStore(),
    compatibility: { pluginVersion: '0.2.36', mobileApi: 2, features: [] },
    refreshBaseline: jest.fn(async () => undefined),
    client: { sessions: { history, models: jest.fn(async () => refusal('stub')) } },
  } as unknown as ConnectionManager
  return { manager, history }
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

const trees: renderer.ReactTestRenderer[] = []

/**
 * The screen re-renders from a 50ms store throttle, so a page that landed is
 * only on screen after that window has passed.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 80))
  })
}

/**
 * Sheets the screen can open read the safe-area insets, which only exist under
 * a provider; zero them so the test needs no device frame.
 */
const INSETS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}

function render(manager: ConnectionManager): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  act(() => {
    tree = renderer.create(
      <SafeAreaProvider initialMetrics={INSETS}>
        <ChatScreen manager={manager} sessionId="s1" onBack={jest.fn()} />
      </SafeAreaProvider>,
    )
  })
  trees.push(tree)
  return tree
}

// VirtualizedList schedules a cells-to-render timeout; left mounted it fires
// after Jest tears the environment down.
afterEach(() => {
  act(() => {
    for (const tree of trees) tree.unmount()
  })
  trees.length = 0
})

describe('ChatScreen transcript loading', () => {
  it('shows a loading state until the tail read lands', async () => {
    const { manager, history } = setup()
    let release: (value: unknown) => void = () => undefined
    history.mockReturnValueOnce(new Promise<unknown>(resolve => { release = resolve }))
    const tree = render(manager)

    expect(screenText(tree)).toContain('chat.loadingHistory')

    await act(async () => { release(okPage()) })
    await settle()
    expect(screenText(tree)).not.toContain('chat.loadingHistory')
    expect(screenText(tree)).toContain('你好')
  })
})

describe('ChatScreen transcript failure', () => {
  it('reports a refused tail read, downshifts the window, and retries on demand', async () => {
    const { manager, history } = setup()
    history
      .mockResolvedValueOnce(refusal('mobile-history-too-large'))
      .mockResolvedValueOnce(refusal('mobile-history-too-large'))
      .mockResolvedValueOnce(okPage())
    const tree = render(manager)

    await settle()
    // A gateway that cannot answer a big page still gets asked for a small one.
    expect(history.mock.calls.map(call => call[0].maxMessages)).toEqual([120, 40])
    expect(screenText(tree)).toContain('chat.historyFailed(mobile-history-too-large)')

    const retry = tree.root.findAll(node =>
      typeof node.props.onPress === 'function' && node.props.accessibilityLabel === 'common.retry').at(-1)
    expect(retry).toBeDefined()
    act(() => { retry!.props.onPress() })
    await settle()

    expect(history).toHaveBeenCalledTimes(3)
    expect(screenText(tree)).not.toContain('chat.historyFailed')
    expect(screenText(tree)).toContain('你好')
  })
})

describe('ChatScreen transcript backfill', () => {
  it('walks the rest of a long transcript on its own, one page at a time', async () => {
    const { manager, history } = setup()
    history
      .mockResolvedValueOnce(okHistory(page([5], true)))
      .mockResolvedValueOnce(okHistory(page([4], true)))
      .mockResolvedValueOnce(okHistory(page([3], false)))
    const tree = render(manager)

    // Nothing to push the walk along: the tail read landing is enough.
    await settle()
    expect(history.mock.calls.map(call => call[0].beforeSeq)).toEqual([undefined, 5, 4])
    expect(manager.store.sessions.get('s1')?.events.map(entry => entry.event.seq)).toEqual([3, 4, 5])
    expect(screenText(tree)).toContain('消息 3')
    // The log is exhausted, so the manual loader is gone too.
    expect(screenText(tree)).not.toContain('chat.loadOlder')
    expect(screenText(tree)).not.toContain('chat.backfilling')
  })

  it('stops the walk on pause instead of pulling the next page', async () => {
    const { manager, history } = setup()
    let release: (value: unknown) => void = () => undefined
    history
      .mockResolvedValueOnce(okHistory(page([5], true)))
      .mockReturnValueOnce(new Promise<unknown>(resolve => { release = resolve }))
    const tree = render(manager)

    await settle()
    expect(screenText(tree)).toContain('chat.backfilling(0)')

    const pause = tree.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityLabel === 'chat.pauseBackfill').at(-1)
    expect(pause).toBeDefined()
    act(() => { pause!.props.onPress() })
    await act(async () => { release(okHistory(page([4], true))) })
    await settle()

    // The page in flight still lands, and the walk ends there.
    expect(manager.store.sessions.get('s1')?.events.map(entry => entry.event.seq)).toEqual([4, 5])
    expect(history).toHaveBeenCalledTimes(2)
    expect(screenText(tree)).toContain('chat.loadOlder')
  })
})
