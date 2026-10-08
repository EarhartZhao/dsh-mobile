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
import Markdown from 'react-native-markdown-display'
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
import { WorkspaceBrowserSheet } from '../components/WorkspaceBrowserSheet'

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
    // The screen re-reads its tail on every establish pass; no reconnect
    // happens inside one test case, so the subscription only needs to exist.
    on: jest.fn(() => () => undefined),
    client: {
      sessions: { history, models: jest.fn(async () => refusal('stub')) },
      // The composer's own sheets read these the moment a trigger opens one.
      commands: { list: jest.fn(async () => ({ commands: [] })) },
      catalog: {
        skills: jest.fn(async () => ({ skills: [] })),
        agentPresets: jest.fn(async () => ({ presets: [], authorable: false })),
        permissionPresets: jest.fn(async () => ({ options: [], defaultOptions: [], defaultPreset: 'workspace-write' })),
      },
      references: { files: jest.fn(async () => []), sessions: jest.fn(async () => []) },
    },
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

/**
 * The sources handed to the Markdown renderer.
 *
 * Which rows go through it is the assertion: a prompt is a pre-wrap run of the
 * text that was sent, while an answer is the document the model wrote.
 */
function markdownSources(tree: renderer.ReactTestRenderer): string[] {
  return tree.root
    .findAll(node => (node.type as unknown) === Markdown)
    .map(node => String(node.props.children))
}

const trees: renderer.ReactTestRenderer[] = []

/** The innermost pressable carrying this accessibility label. */
function pressableByLabel(
  tree: renderer.ReactTestRenderer,
  label: string,
): renderer.ReactTestInstance | undefined {
  return tree.root.findAll(node =>
    typeof node.props.onPress === 'function' && node.props.accessibilityLabel === label).at(-1)
}

/** The innermost pressable whose own subtree renders this text. */
function pressableRendering(
  tree: renderer.ReactTestRenderer,
  text: string,
): renderer.ReactTestInstance | undefined {
  return tree.root.findAll(node =>
    typeof node.props.onPress === 'function'
    && node.findAll(child => child.props.children === text).length > 0).at(-1)
}

/** The composer's own input, found by the send placeholder it carries. */
function composer(tree: renderer.ReactTestRenderer): renderer.ReactTestInstance | undefined {
  return tree.root.findAll(node =>
    typeof node.props.onChangeText === 'function'
    && node.props.placeholder === 'chat.sendPlaceholder').at(-1)
}

/**
 * The screen's own wiring into 「浏览工作区」: the sheet owns the browsing, the
 * screen owns what a picked path does to the draft.
 */
function browserInsert(
  tree: renderer.ReactTestRenderer,
): (reference: { path: string; kind: 'file' | 'directory' }) => void {
  return tree.root.findAllByType(WorkspaceBrowserSheet).at(-1)!.props.onInsertReference as
    (reference: { path: string; kind: 'file' | 'directory' }) => void
}

/** Whether a search field carrying this i18n placeholder is on screen. */
function hasField(tree: renderer.ReactTestRenderer, placeholder: string): boolean {
  return tree.root.findAll(node =>
    typeof node.props.onChangeText === 'function'
    && node.props.placeholder === placeholder).length > 0
}

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

function render(manager: ConnectionManager, sessionId = 's1', onBack: () => void = jest.fn()): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  act(() => {
    tree = renderer.create(
      <SafeAreaProvider initialMetrics={INSETS}>
        <ChatScreen manager={manager} sessionId={sessionId} onBack={onBack} />
      </SafeAreaProvider>,
    )
  })
  trees.push(tree)
  return tree
}

/** Hand the mounted screen another conversation, as a hop down a lineage does. */
function renderSession(tree: renderer.ReactTestRenderer, manager: ConnectionManager, sessionId: string, onBack: () => void): void {
  act(() => {
    tree.update(
      <SafeAreaProvider initialMetrics={INSETS}>
        <ChatScreen manager={manager} sessionId={sessionId} onBack={onBack} />
      </SafeAreaProvider>,
    )
  })
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

  it('reads the tail again when the Host log runs past the loaded records', async () => {
    const { manager, history } = setup()
    history
      .mockResolvedValueOnce(okHistory(page([2], false)))
      .mockResolvedValueOnce(okHistory(page([4, 5], false)))
    const tree = render(manager)
    await settle()
    expect(screenText(tree)).toContain('消息 2')

    // The Session's live stream died at seq 2 and the Host's log ran on to 5:
    // the closing message and the `turn/end` are in the log, never in a frame
    // the App saw. The bridge's re-opened follow reports where the log stands.
    act(() => {
      manager.store.applyMuxFrame(RpcId('f1'), {
        type: 'session/subscribed', sessionId: 's1' as never, lastSeq: 5,
      })
    })
    await settle()

    expect(history.mock.calls.map(call => call[0].beforeSeq)).toEqual([undefined, undefined])
    expect(screenText(tree)).toContain('消息 5')

    // The same watermark is not read twice: a page that cannot move the tail
    // would otherwise be asked for again on every store change.
    act(() => {
      manager.store.applyMuxFrame(RpcId('f2'), {
        type: 'session/subscribed', sessionId: 's1' as never, lastSeq: 5,
      })
    })
    await settle()
    expect(history.mock.calls).toHaveLength(2)
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

  it('opens the next conversation at its newest row, not where the reader left the last one', async () => {
    const { manager, history } = setup()
    history.mockResolvedValue(okPage())
    const tree = render(manager)
    await settle()

    // The reader parks themselves in the middle of the first conversation, so
    // the tail is theirs no longer and the anchor is holding their place.
    const first = scrollCommands(tree)
    act(() => { first.list.props.onLayout(listLayout(800)) })
    act(() => { first.list.props.onScrollBeginDrag() })
    act(() => { first.list.props.onScroll(scrollTo(200, 2_000, 800)) })
    act(() => { first.list.props.onScrollEndDrag() })
    await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 200)) })
    expect(first.list.props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 })

    // A hop down the lineage swaps the conversation under the same screen.
    renderSession(tree, manager, 'child', jest.fn())
    await settle()

    // The new transcript is a fresh one that opens on its tail: the anchor is
    // unarmed again, and the first size it reports is followed to the bottom.
    // Carried over, the reader's old place left them on the first screen of a
    // conversation whose answer sat below the fold.
    const next = scrollCommands(tree)
    expect(next.list.props.maintainVisibleContentPosition).toBeUndefined()
    act(() => { next.list.props.onLayout(listLayout(800)) })
    act(() => { next.list.props.onContentSizeChange(390, 3_000) })
    await frame()

    expect(next.toOffset.mock.calls).toEqual([[{ offset: 2_200, animated: false }]])
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

  it('reads a settled step as one line and expands it on tap, the way the Web does', async () => {
    const { manager, history } = setup()
    history.mockResolvedValueOnce(okPage())
    const tree = render(manager)
    await settle()

    feed(manager, 2, 'assistant/message', {
      turn: 1, step: 1,
      message: {
        content: [
          { type: 'reasoning', text: '先规划一下\n\n再看来源' },
          { type: 'text', text: '开始查。' },
        ],
      },
    })
    feed(manager, 3, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'web_search', arguments: '{}' })
    feed(manager, 4, 'tool/result', {
      turn: 1, step: 1,
      message: { toolCallId: 'c1', content: [{ type: 'text', text: '8 个来源' }] },
    })
    feed(manager, 5, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle()
    // Settled, the trace folds back to its answer: a closed turn opens only
    // because the reader opened it.
    expect(screenText(tree)).not.toContain('先规划一下')

    const openBlock = pressableByLabel(tree, 'chat.toolCallSummary(1)')
    expect(openBlock).toBeDefined()
    act(() => { openBlock!.props.onPress() })
    await settle()

    // One truncated line, exactly the Web's `ReasoningRow`: the settled preview
    // is the thought's own first line, and the rest stays folded.
    expect(screenText(tree)).toContain('先规划一下')
    expect(screenText(tree)).not.toContain('再看来源')

    const row = pressableRendering(tree, 'chat.thoughtStep')
    expect(row).toBeDefined()
    act(() => { row!.props.onPress() })
    await settle()
    expect(screenText(tree)).toContain('再看来源')
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

/**
 * The manager surface for a conversation opened as a subagent child.
 *
 * The list carries the child's parent, and the parent's own catalog carries the
 * mode the child's durable address needs — the two facts `subagent.history`
 * takes and a plain `session.history` cannot stand in for.
 */
function setupChild(mode: 'one-shot' | 'continuable') {
  const history = jest.fn(async () => okPage())
  // The request is the point of this double: the address the read was sent
  // with is what the test asserts on.
  const subagentHistory = jest.fn(async (_request: unknown) => okPage())
  const store = new SessionStore()
  store.applyBaseline({
    summaries: [
      {
        sessionId: 'parent', updatedAt: 0, running: false, blank: false,
        projections: { asOfSeq: 1, values: { subagentCatalog: [{ id: 'child', createdAt: 1, mode, label: 'data' }] } },
      },
      {
        sessionId: 'child', updatedAt: 0, running: false, blank: false,
        parentSessionId: 'parent', origin: 'subagent',
      },
    ],
    workspaces: [],
  } as never)
  const manager = {
    store,
    compatibility: { pluginVersion: '0.2.36', mobileApi: 2, features: [] },
    refreshBaseline: jest.fn(async () => undefined),
    on: jest.fn(() => () => undefined),
    client: {
      sessions: { history, models: jest.fn(async () => refusal('stub')) },
      subagents: { history: subagentHistory, list: jest.fn(async () => refusal('stub')) },
      // The screen reads the process catalogs on mount, whichever Session it
      // opened: the real client always carries this face.
      catalog: {
        skills: jest.fn(async () => ({ skills: [] })),
        agentPresets: jest.fn(async () => ({ presets: [], authorable: false })),
        permissionPresets: jest.fn(async () => ({ options: [], defaultOptions: [], defaultPreset: 'workspace-write' })),
      },
    },
  } as unknown as ConnectionManager
  return { manager, history, subagentHistory }
}

describe('ChatScreen subagent conversation', () => {
  it('reads a child transcript through its durable parent address', async () => {
    const { manager, history, subagentHistory } = setupChild('continuable')
    const tree = render(manager, 'child')

    await settle()
    // The Host refuses a child read as a Session ("subagent Sessions require
    // their durable parent address"), so the read must never be sent as one.
    expect(history).not.toHaveBeenCalled()
    expect(subagentHistory.mock.calls[0]?.[0]).toMatchObject({
      parentSessionId: 'parent', childSessionId: 'child', mode: 'continuable',
    })
    expect(screenText(tree)).toContain('你好')
  })

  it('explains the one-shot child it cannot take a message for', async () => {
    const { manager } = setupChild('one-shot')
    const tree = render(manager, 'child')

    await settle()
    expect(screenText(tree)).toContain('subagent.readOnly.oneShotTitle')
    expect(screenText(tree)).toContain('subagent.readOnly.oneShotBody')
    // The draft it would have taken is gone with the composer.
    expect(screenText(tree)).not.toContain('chat.sendPlaceholder')
  })

  it('draws a sub-agent prompt as the text that was sent, and its answer as Markdown', async () => {
    const { manager, subagentHistory } = setupChild('continuable')
    const prompt = '补齐细分行业数据。\n\n'
      + '```\ncurl -sSL -m 40 --compressed -H \'User-Agent: Mozilla/5.0\' "URL" -o /tmp/f.html\n```\n\n'
      + '**注意**：不要用 pip 安装包。'
    const answer = '## 已停止检索\n\n以下为本轮已确认的数据汇总（全部来自重庆市统计局官方发布）。'
    const transcript = {
      events: [
        {
          event: {
            type: 'user/message', seq: 1, time: 1,
            data: { content: [{ type: 'text', text: prompt }] },
          },
        },
        {
          event: {
            type: 'assistant/message', seq: 2, time: 2,
            data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: answer }] } },
          },
        },
      ],
      hasMore: false,
    } as unknown as ReturnType<typeof page>
    subagentHistory.mockResolvedValue(okHistory(transcript))
    const tree = render(manager, 'child')
    await settle()

    // A prompt is pre-wrap text, the way the Web's bubble renders it. Sent
    // through the Markdown renderer instead, its fenced block became a code
    // card carrying a horizontal ScrollView, and inside a bubble whose width is
    // an at-most `maxWidth: '82%'` that measured the prompt several times too
    // tall and too wide — the answer below it was clipped off the screen, which
    // read as a sub-agent that answered nothing.
    expect(screenText(tree)).toContain(prompt)
    expect(markdownSources(tree)).toEqual([answer])
  })

  it('takes a back press again after the screen is handed another conversation', async () => {
    const { manager } = setup()
    const onBack = jest.fn()
    const tree = render(manager, 'parent', onBack)
    await settle()

    const back = (): void => {
      act(() => { pressableByLabel(tree, 'chat.back')?.props.onPress() })
    }

    // One press closes the conversation; the duplicate activation of that same
    // press does not ask again.
    back()
    back()
    expect(onBack).toHaveBeenCalledTimes(1)

    // The composer belongs to the conversation it was written for: a half-typed
    // message must not ride into the conversation next door.
    act(() => { composer(tree)?.props.onChangeText('给父会话的草稿') })
    expect(composer(tree)?.props.value).toBe('给父会话的草稿')

    // Following a subagent swaps the Session under the same mounted screen, so
    // backing out of the child and then out of its parent has to work.
    renderSession(tree, manager, 'child', onBack)
    await settle()
    expect(composer(tree)?.props.value).toBe('')
    back()
    expect(onBack).toHaveBeenCalledTimes(2)
  })
})

describe('ChatScreen composer triggers', () => {
  it('keeps a subagent conversation text-only', async () => {
    const { manager } = setupChild('continuable')
    const tree = render(manager, 'child')
    await settle()

    // The attach circle is the sheet's only door in this conversation, and it
    // is gone.
    expect(pressableByLabel(tree, 'chat.add')).toBeUndefined()

    // `/` and `@` stay text: a child's commands are its parent's, and a mention
    // would only earn a refusal from the child domain.
    act(() => { composer(tree)?.props.onChangeText('/compact') })
    await settle()
    expect(hasField(tree, 'plus.searchCommands')).toBe(false)
    expect(composer(tree)?.props.value).toBe('/compact')

    act(() => { composer(tree)?.props.onChangeText('@reports') })
    await settle()
    expect(hasField(tree, 'plus.searchReferences')).toBe(false)
  })

  it('opens the sheet from a typed trigger in a top-level chat, on that tab', async () => {
    const { manager } = setup()
    const tree = render(manager, 's1')
    await settle()
    expect(pressableByLabel(tree, 'chat.add')).toBeDefined()

    act(() => { composer(tree)?.props.onChangeText('/') })
    await settle()
    expect(hasField(tree, 'plus.searchCommands')).toBe(true)
    expect(hasField(tree, 'plus.searchReferences')).toBe(false)

    // The modal owns the screen from here, so the other trigger gets its own
    // open — the sheet seeds its tab once, when it becomes visible.
    act(() => { pressableRendering(tree, 'common.close')?.props.onPress() })
    const other = render(setup().manager, 's1')
    await settle()
    act(() => { composer(other)?.props.onChangeText('@') })
    await settle()
    expect(hasField(other, 'plus.searchReferences')).toBe(true)
    expect(hasField(other, 'plus.searchCommands')).toBe(false)
  })

  it('fills a tab the reader switched to by hand, instead of leaving it blank', async () => {
    const { manager } = setup()
    const tree = render(manager, 's1')
    await settle()

    // The attach button opens on commands, which fetches only commands.
    act(() => { pressableByLabel(tree, 'chat.add')?.props.onPress() })
    await settle()
    expect(hasField(tree, 'plus.searchCommands')).toBe(true)
    expect(screenText(tree)).not.toContain('plus.noReferences')

    // Switching tabs has to ask for the tab's own data; the sheet keeps that
    // state privately, so a tab nothing fetched used to render as blank.
    act(() => { pressableRendering(tree, 'plus.tab.references')?.props.onPress() })
    await settle()
    expect(hasField(tree, 'plus.searchReferences')).toBe(true)
    expect(screenText(tree)).toContain('plus.noReferences')
  })

  it('stays shut while the reader edits what a pick just wrote', async () => {
    const { manager } = setup()
    // One command to pick and one file to mention: the two ways into the
    // sheet's own tabs.
    const client = manager.client as unknown as {
      commands: { list: jest.Mock }
      references: { files: jest.Mock }
    }
    client.commands.list = jest.fn(async () => ({ commands: [{ name: 'compact', description: '压缩上下文' }] }))
    client.references.files = jest.fn(async () => [{ path: '/w/a.ts', kind: 'file' }])
    const tree = render(manager)
    await settle()

    // A typed `/` is a line being written: the pick finishes it in place and
    // the sheet closes on its own — never through the close handler that
    // remembers a dismissal.
    act(() => { composer(tree)?.props.onChangeText('/') })
    await settle()
    // The row's own line is `/{name}`, which React renders as two children;
    // its description is the one string that identifies the row outright.
    act(() => { pressableRendering(tree, '压缩上下文')?.props.onPress() })
    await settle()
    expect(composer(tree)?.props.value).toBe('/compact ')
    expect(hasField(tree, 'plus.searchCommands')).toBe(false)

    // Deleting the space the insert ended with used to look like a fresh
    // query, so the sheet came back seeded with the line just picked.
    act(() => { composer(tree)?.props.onChangeText('/compact') })
    await settle()
    expect(hasField(tree, 'plus.searchCommands')).toBe(false)
    expect(composer(tree)?.props.value).toBe('/compact')

    // Same for a mention, whose own text is what the trigger detector reads.
    act(() => { composer(tree)?.props.onChangeText('/compact @') })
    await settle()
    expect(hasField(tree, 'plus.searchReferences')).toBe(true)
    act(() => { pressableRendering(tree, 'a.ts')?.props.onPress() })
    await settle()
    expect(composer(tree)?.props.value).toBe('/compact @/w/a.ts ')
    expect(hasField(tree, 'plus.searchReferences')).toBe(false)

    act(() => { composer(tree)?.props.onChangeText('/compact @/w/a.ts') })
    await settle()
    expect(hasField(tree, 'plus.searchReferences')).toBe(false)

    // Suppressing a finished token is not a latch: the next trigger, at its
    // own offset, still opens its tab.
    act(() => { composer(tree)?.props.onChangeText('/compact @/w/a.ts and /') })
    await settle()
    expect(hasField(tree, 'plus.searchCommands')).toBe(true)
  })

  it('stays shut while the reader edits a mention the file browser inserted', async () => {
    const { manager } = setup()
    const tree = render(manager)
    await settle()

    // 「浏览工作区」 writes the mention straight into the draft and keeps a
    // chip beside it — the same text a pick writes, through a different door.
    act(() => { browserInsert(tree)({ path: '/w/a.ts', kind: 'file' }) })
    await settle()
    expect(composer(tree)?.props.value).toBe('@/w/a.ts ')
    expect(screenText(tree)).toContain('a.ts')

    act(() => { composer(tree)?.props.onChangeText('@/w/a.ts') })
    await settle()
    expect(hasField(tree, 'plus.searchReferences')).toBe(false)
    expect(composer(tree)?.props.value).toBe('@/w/a.ts')

    // The flap: delete the space, type one back, delete it again. Only the
    // token is the identity, so the space coming and going must not lose the
    // dismissal the insert recorded.
    act(() => { composer(tree)?.props.onChangeText('@/w/a.ts ') })
    await settle()
    expect(hasField(tree, 'plus.searchReferences')).toBe(false)

    act(() => { composer(tree)?.props.onChangeText('@/w/a.ts') })
    await settle()
    expect(hasField(tree, 'plus.searchReferences')).toBe(false)
  })
})

/**
 * The composer's two mode controls.
 *
 * Access mode belongs in the composer, as it does on the Web. The previous
 * attempt drew it from the `permissions` projection's own `options`, which the
 * host never sends — that projection carries the selected value only, and the
 * roster is a separate process catalog — so the control was silently absent.
 * Agent mode is a seat for a conversation that has not run yet, and nothing
 * else: the host freezes the composition at the first turn.
 */
function setupModes(overrides: {
  blank?: boolean
  permission?: string
  options?: { value: string; name: string; description?: string }[]
  presets?: { id: string; name?: string; isDefault?: boolean }[]
}) {
  const execute = jest.fn(async () => ({ result: { kind: 'success', text: '' } }))
  const selectPreset = jest.fn(async () => ({ result: { ok: true, value: {} } }))
  const store = new SessionStore()
  store.applyBaseline({
    summaries: [{
      sessionId: 's1',
      blank: overrides.blank ?? false,
      updatedAt: 0,
      running: false,
      ...(overrides.permission === undefined
        ? {}
        : { projections: { asOfSeq: 1, values: { permissions: { currentValue: overrides.permission } } } }),
    }],
    workspaces: [],
  } as never)
  const manager = {
    store,
    compatibility: { pluginVersion: '0.2.38', mobileApi: 2, features: [] },
    refreshBaseline: jest.fn(async () => undefined),
    on: jest.fn(() => () => undefined),
    client: {
      sessions: { history: jest.fn(async () => okPage()), models: jest.fn(async () => refusal('stub')) },
      commands: { list: jest.fn(async () => ({ commands: [] })), execute },
      catalog: {
        skills: jest.fn(async () => ({ skills: [] })),
        agentPresets: jest.fn(async () => ({
          presets: overrides.presets ?? [], authorable: false, modeSelectionEnabled: true,
        })),
        permissionPresets: jest.fn(async () => ({
          options: overrides.options ?? [], defaultOptions: [], defaultPreset: 'workspace-write',
        })),
      },
      references: { files: jest.fn(async () => []), sessions: jest.fn(async () => []) },
      agentPresets: { select: selectPreset },
    },
  } as unknown as ConnectionManager
  return { manager, execute, selectPreset }
}

describe('ChatScreen composer mode controls', () => {
  // What the host actually publishes: the machine value in both places. The
  // product labels («仅可查看» and friends) live in the client's dictionary,
  // which is why `mockT` surfaces the key rather than the copy.
  const OPTIONS = [
    { value: 'workspace-write', name: 'workspace-write' },
    { value: 'read-only', name: 'read-only' },
    { value: 'danger-full-access', name: 'danger-full-access' },
  ]

  it('shows the access mode beside the composer and switches it through the command', async () => {
    const { manager, execute } = setupModes({ permission: 'workspace-write', options: OPTIONS })
    const tree = render(manager)
    await settle()

    // The chip names the projection's value, resolved through the catalog.
    expect(pressableByLabel(tree, 'chat.permissionMode(permission.workspaceWrite)')).toBeDefined()

    act(() => { pressableByLabel(tree, 'chat.permissionMode(permission.workspaceWrite)')?.props.onPress() })
    await settle()
    // Both the current mode and the ones it can switch to are offered; the
    // values are the host's names, never a locally invented label.
    expect(screenText(tree)).toContain('chat.permissionTitle')
    expect(pressableByLabel(tree, 'permission.readOnly')).toBeDefined()
    expect(pressableByLabel(tree, 'permission.fullAccess')).toBeDefined()

    act(() => { pressableByLabel(tree, 'permission.readOnly')?.props.onPress() })
    await settle()
    expect(execute).toHaveBeenCalledWith({ sessionId: 's1', line: '/permission read-only' })
  })

  it('leaves the composer without a switcher when the host offers no catalog', async () => {
    // A bridge older than the catalog mapping answers nothing here; a control
    // that cannot set anything must not take a seat in the composer.
    const { manager } = setupModes({ permission: 'workspace-write' })
    const tree = render(manager)
    await settle()

    expect(pressableByLabel(tree, 'chat.permissionMode(workspace-write)')).toBeUndefined()
  })

  it('offers agent mode on a conversation that has not started, and nowhere else', async () => {
    const presets = [{ id: 'standard', name: '标准', isDefault: true }, { id: 'ptc', name: 'PTC' }]
    const manager = setupModes({ blank: true, presets }).manager
    const tree = render(manager)
    await settle()

    expect(pressableByLabel(tree, 'chat.presetMode(标准)')).toBeDefined()
    act(() => { pressableByLabel(tree, 'chat.presetMode(标准)')?.props.onPress() })
    await settle()
    expect(screenText(tree)).toContain('chat.presetSeat')

    act(() => { pressableByLabel(tree, 'PTC')?.props.onPress() })
    await settle()
    expect((manager.client as unknown as { agentPresets: { select: jest.Mock } }).agentPresets.select)
      .toHaveBeenCalledWith({ sessionId: 's1', agentPreset: 'ptc' })

    // The same roster on a started conversation: the host refuses the swap
    // there, so the seat is gone and only the header's line reports the mode.
    const started = setupModes({ blank: false, presets }).manager
    const other = render(started)
    await settle()
    expect(pressableByLabel(other, 'chat.presetMode(标准)')).toBeUndefined()
  })
})
