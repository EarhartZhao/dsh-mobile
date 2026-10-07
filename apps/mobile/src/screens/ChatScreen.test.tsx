/**
 * The transcript's own loading and failure surfaces.
 *
 * A tail read that is slow, or refused because the page is bigger than one NATS
 * publish, used to leave the screen blank — indistinguishable from a Session
 * that genuinely has no messages.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { FlatList } from 'react-native'
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context'
import { SessionStore, type ConnectionManager } from '@dsh-mobile/core'
import { RpcId } from '@dsh-mobile/protocol'

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
import { MessageActionRow } from '../components/MessageActions'

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

  it('walks back from the oldest real record, not from a live chunk placeholder', async () => {
    const { manager, history } = setup()
    history
      .mockResolvedValueOnce(okHistory(page([5], true)))
      .mockResolvedValueOnce(okHistory(page([4], false)))
    const tree = render(manager)
    await settle()

    // A transient chunk rides seq 0, which is not a log position. Counting it as
    // the oldest seq made the walk ask for records before seq 0: the Host
    // answered an empty page, the walk read that as "history exhausted", and the
    // records between the chunk and the loaded window were never read.
    act(() => {
      manager.store.applyMuxFrame(RpcId('f0'), {
        type: 'session/event', sessionId: 's1' as never,
        event: {
          seq: 0, time: 0, type: 'assistant/chunk',
          data: {
            turn: 1, step: 1, transient: true, attemptId: 'a1', index: 0,
            chunk: { type: 'text-delta', index: 0, text: '写了一半' },
          },
        } as never,
      })
    })
    await settle()

    expect(history.mock.calls.map(call => call[0].beforeSeq)).toEqual([undefined, 5])
    // The chunk rides along at the tail, where its arrival put it; what matters
    // is that the walk reached seq 4 instead of stopping on seq 0.
    expect(manager.store.sessions.get('s1')?.events.map(entry => entry.event.seq)).toEqual([4, 5, 0])
    expect(screenText(tree)).toContain('消息 4')
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

/**
 * Following the newest row, and leaving a transcript alone.
 *
 * The follow scroll used to aim with `scrollToEnd`, which asks VirtualizedList
 * for the last cell's metrics — an average-based guess for a cell it has never
 * measured, and streaming rows are the tallest in the transcript. Landing short
 * of the bottom then fed back into the scroll anchor
 * (`maintainVisibleContentPosition`), so every chunk pulled the list down and
 * the anchor pulled it back: the up-and-down the reader saw while the model was
 * thinking. Exactly one of the two may hold the offset, and only while the
 * reader is at the tail.
 */
describe('ChatScreen tail following', () => {
  const listLayout = (height: number): unknown => ({
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height } },
  })
  const scrollTo = (y: number, contentHeight: number, viewportHeight: number): unknown => ({
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 390, height: contentHeight },
      layoutMeasurement: { width: 390, height: viewportHeight },
    },
  })

  /** The list's own scroll commands, as the screen issues them. */
  function scrollCommands(tree: renderer.ReactTestRenderer) {
    const list = tree.root.findByType(FlatList)
    const instance = list.instance as unknown as {
      scrollToEnd: (params: unknown) => void
      scrollToOffset: (params: unknown) => void
    }
    return {
      list,
      toEnd: jest.spyOn(instance, 'scrollToEnd').mockImplementation(() => undefined),
      toOffset: jest.spyOn(instance, 'scrollToOffset').mockImplementation(() => undefined),
    }
  }

  /** The follow scroll is coalesced into one animation frame. */
  async function frame(): Promise<void> {
    await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 20)) })
  }

  it('pins the newest row to the measured bottom while the model streams', async () => {
    const { manager, history } = setup()
    history.mockResolvedValueOnce(okPage())
    const tree = render(manager)
    await settle()

    // The turn the reader is watching: reasoning arrives, no answer text yet.
    act(() => {
      manager.store.applyMuxFrame(RpcId('reasoning-1'), {
        type: 'session/event', sessionId: 's1' as never,
        event: {
          seq: 2, time: 2, type: 'assistant/chunk',
          data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: '先看目录' } },
        } as never,
      })
    })
    await settle()
    expect(screenText(tree)).toContain('chat.step.thinking')

    const { list, toEnd, toOffset } = scrollCommands(tree)
    act(() => { list.props.onLayout(listLayout(800)) })
    // Two chunks land inside one frame: the second height is the one to aim at.
    act(() => { list.props.onContentSizeChange(390, 1_800) })
    act(() => { list.props.onContentSizeChange(390, 2_000) })
    await frame()

    expect(toOffset.mock.calls).toEqual([[{ offset: 1_200, animated: false }]])
    expect(toEnd).not.toHaveBeenCalled()
    // The anchor stays unarmed while this side owns the offset.
    expect(list.props.maintainVisibleContentPosition).toBeUndefined()
  })

  it('does not drag back a transcript the reader scrolled away from', async () => {
    const { manager, history } = setup()
    history.mockResolvedValueOnce(okPage())
    const tree = render(manager)
    await settle()

    const { list, toEnd, toOffset } = scrollCommands(tree)
    act(() => { list.props.onLayout(listLayout(800)) })
    act(() => { list.props.onScrollBeginDrag() })
    act(() => { list.props.onScroll(scrollTo(200, 2_000, 800)) })
    act(() => { list.props.onScrollEndDrag() })
    // The unlock is deliberately delayed past the drag's own momentum.
    await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 200)) })

    // An older page is prepended under the reader's finger.
    act(() => { list.props.onContentSizeChange(390, 2_400) })
    await frame()

    expect(toOffset).not.toHaveBeenCalled()
    expect(toEnd).not.toHaveBeenCalled()
    // The anchor is what holds their place now.
    expect(list.props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 })
  })

  it('keeps the tail when a stale sample reports the offset a chunk grew away from', async () => {
    const { manager, history } = setup()
    history.mockResolvedValueOnce(okPage())
    const tree = render(manager)
    await settle()

    const { list, toEnd, toOffset } = scrollCommands(tree)
    act(() => { list.props.onLayout(listLayout(800)) })
    // The reader is at the bottom and a chunk lands below them: the sample the
    // native side sends before the follow scroll runs still reports the offset
    // they were reading at. That is growth, not the reader moving, so the tail
    // stays theirs — the sample used to disarm the follow and leave the list a
    // screen short of the newest row.
    act(() => { list.props.onScroll(scrollTo(200, 2_000, 800)) })
    act(() => { list.props.onContentSizeChange(390, 2_400) })
    await frame()

    expect(toOffset.mock.calls).toEqual([[{ offset: 1_600, animated: false }]])
    expect(toEnd).not.toHaveBeenCalled()
    expect(list.props.maintainVisibleContentPosition).toBeUndefined()
  })
})

/**
 * What a turn still in flight renders.
 *
 * The web reads a running turn run by run, holds its icon row back until the
 * turn closes, and keeps the live trace open for as long as the turn is the one
 * being watched. Every part of that is visible to the reader while the model
 * works, so each is worth pinning down here.
 */
describe('ChatScreen running turn', () => {
  const s1 = 's1' as never

  /** One recorded event, the way the store's mux frames deliver them. */
  function feed(manager: ConnectionManager, seq: number, type: string, data: unknown): void {
    act(() => {
      manager.store.applyMuxFrame(RpcId(`f${seq}`), {
        type: 'session/event', sessionId: s1,
        event: { seq, time: seq, type, data } as never,
      })
    })
  }

  /** A step that thought, then answered, then called a tool. */
  function planningTurn(manager: ConnectionManager): void {
    feed(manager, 2, 'assistant/message', {
      turn: 1, step: 1,
      message: {
        content: [
          { type: 'reasoning', text: '先规划一下' },
          { type: 'text', text: '我来查一下天津近五年的经济数据。' },
        ],
      },
    })
    feed(manager, 3, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'web_search', arguments: '{}' })
    feed(manager, 4, 'tool/result', {
      turn: 1, step: 1,
      message: { toolCallId: 'c1', content: [{ type: 'text', text: '8 个来源' }] },
    })
    feed(manager, 5, 'assistant/message', {
      turn: 1, step: 2,
      message: {
        content: [
          { type: 'reasoning', text: '再看看来源' },
          { type: 'text', text: '结果如下。' },
        ],
      },
    })
  }

  /** The transcript's rows, as the list was handed them. */
  function rowText(tree: renderer.ReactTestRenderer): string[] {
    const list = tree.root.findByType(FlatList)
    return (list.props.data as { kind: string, item?: { text?: string } }[])
      .map(row => row.kind === 'turn' ? 'process' : row.item?.text ?? '')
  }

  it('keeps every run where it happened, so a narrated answer stays above the work after it', async () => {
    const { manager, history } = setup()
    history.mockResolvedValueOnce(okPage())
    const tree = render(manager)
    await settle()

    planningTurn(manager)
    await settle()

    // The web emits a step's reasoning, then its reply, then the tools that
    // followed, and folds the lot only once the turn closes. Hoisting every run
    // above the turn's answers put "我来查一下…" under work that came after it.
    expect(rowText(tree)).toEqual([
      '你好', 'process', '我来查一下天津近五年的经济数据。', 'process', '结果如下。',
    ])
    expect(manager.store.sessions.get('s1')?.running ?? false).toBe(false)
  })

  it('holds the icon row back until the turn closes', async () => {
    const { manager, history } = setup()
    history.mockResolvedValueOnce(okPage())
    const tree = render(manager)
    await settle()

    planningTurn(manager)
    await settle()
    // The prompt keeps its own clock row throughout; the answer still being
    // written has nothing to copy, rate or fork from yet.
    expect(tree.root.findAllByType(MessageActionRow)).toHaveLength(1)

    feed(manager, 9, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle()
    // Once it closes, the web leaves one reply standing per turn: the prompt
    // keeps its clock row and the closing answer gets the turn's icon row. The
    // narration that led into the tool call is not an answer — it folds into the
    // disclosure above with the work it announced, so it carries no row.
    expect(tree.root.findAllByType(MessageActionRow)).toHaveLength(2)
    expect(screenText(tree)).not.toContain('我来查一下天津近五年的经济数据。')
    expect(screenText(tree)).toContain('结果如下。')
  })

  it('keeps a live turn\'s trace open between its steps', async () => {
    const { manager, history } = setup()
    history.mockResolvedValueOnce(okPage())
    const tree = render(manager)
    await settle()

    planningTurn(manager)
    await settle()

    // Nothing is in flight in this instant — the tool returned and the next
    // step has not opened — but the turn is still the one being watched. The
    // block used to fold here and unfold on the next chunk, which is the
    // up-and-down the reader saw while the model worked.
    expect(manager.store.sessions.get('s1')?.running).toBe(false)
    expect(screenText(tree)).toContain('chat.thoughtStep')
    expect(screenText(tree)).toContain('先规划一下')
  })

  it('stops showing a turn as live once the Host reports the Session idle', async () => {
    const { manager, history } = setup()
    history.mockResolvedValueOnce(okPage())
    const tree = render(manager)
    await settle()

    const status = (running: boolean): void => {
      act(() => {
        manager.store.applyHostFrame({ type: 'host/session-status', sessionId: s1, running })
      })
    }
    const chunk = (): void => {
      act(() => {
        manager.store.applyMuxFrame(RpcId('f0'), {
          type: 'session/event', sessionId: s1,
          event: {
            seq: 0, time: 0, type: 'assistant/chunk',
            data: {
              turn: 1, step: 1, transient: true, attemptId: 'a1', index: 0,
              chunk: { type: 'text-delta', index: 0, text: '写了一半' },
            },
          } as never,
        })
      })
    }

    // The live stream drops mid-turn: the chunks land, their closing message and
    // the turn's `turn/end` never do, so the log still reads as work in flight.
    status(true)
    chunk()
    await settle()
    expect(screenText(tree)).toContain('chat.running')

    // The Host is the authority on whether anything is running: once it says the
    // Session is idle the clock goes away, instead of running over a finished
    // turn until the screen is reloaded from scratch.
    status(false)
    await settle()
    expect(screenText(tree)).not.toContain('chat.running')
    expect(screenText(tree)).not.toContain('写了一半')
  })
})

/**
 * The web's floating "back to bottom" control: the way back once the reader
 * has left the tail.
 */
describe('ChatScreen scroll-to-bottom control', () => {
  const listLayout = (height: number): unknown => ({
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height } },
  })
  const scrollTo = (y: number, contentHeight: number, viewportHeight: number): unknown => ({
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 390, height: contentHeight },
      layoutMeasurement: { width: 390, height: viewportHeight },
    },
  })
  /** The control, as the screen renders it — label and press handler together. */
  function backToBottom(tree: renderer.ReactTestRenderer): renderer.ReactTestInstance | undefined {
    return tree.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityLabel === 'chat.toBottom').at(-1)
  }

  it('appears away from the tail and returns the reader to the measured bottom', async () => {
    const { manager, history } = setup()
    history.mockResolvedValueOnce(okPage())
    const tree = render(manager)
    await settle()

    const list = tree.root.findByType(FlatList)
    const instance = list.instance as unknown as {
      scrollToEnd: (params: unknown) => void
      scrollToOffset: (params: unknown) => void
    }
    const toEnd = jest.spyOn(instance, 'scrollToEnd').mockImplementation(() => undefined)
    const toOffset = jest.spyOn(instance, 'scrollToOffset').mockImplementation(() => undefined)

    // At the tail there is nowhere to go back to.
    expect(backToBottom(tree)).toBeUndefined()

    act(() => { list.props.onLayout(listLayout(800)) })
    act(() => { list.props.onContentSizeChange(390, 2_000) })
    act(() => { list.props.onScrollBeginDrag() })
    act(() => { list.props.onScroll(scrollTo(200, 2_000, 800)) })
    act(() => { list.props.onScrollEndDrag() })
    // The unlock is deliberately delayed past the drag's own momentum.
    await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 200)) })

    const control = backToBottom(tree)
    expect(control).toBeDefined()

    act(() => { control!.props.onPress() })

    // It aims at the measured bottom — not `scrollToEnd`, whose unmeasured-row
    // estimate is what left the list short in the first place — and then retires
    // because the reader is following the tail again.
    expect(toOffset).toHaveBeenLastCalledWith({ offset: 1_200, animated: true })
    expect(toEnd).not.toHaveBeenCalled()
    expect(backToBottom(tree)).toBeUndefined()
    expect(list.props.maintainVisibleContentPosition).toBeUndefined()
  })
})
