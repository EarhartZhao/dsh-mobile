/**
 * One trajectory record's own page — the Web's inspector, on the phone.
 *
 * The Web shows the record it is inspecting in a panel beside the ledger, with
 * a row of tabs over it. The phone pushes this page instead, and the tabs have
 * to carry the same reading: 概述 with the source, the status, the token
 * buckets and the request's five timing numbers, and the record's payload,
 * result and schema each on a page of their own.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { SessionStore, type ConnectionManager } from '@dsh-mobile/core'
import { RpcId } from '@dsh-mobile/protocol'

const mockT = (key: string, values?: Record<string, string | number>): string =>
  values === undefined ? key : `${key}(${Object.entries(values).map(([name, value]) => `${name}=${String(value)}`).join(',')})`

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({ locale: 'zh-CN', t: mockT }),
}))
jest.mock('react-native-svg', () => ({
  __esModule: true,
  Svg: ({ children }: { children: React.ReactNode }) => children,
  Path: () => null,
  Circle: () => null,
  Rect: () => null,
}))
// The real renderer builds a native Markdown tree; the page test only needs
// the text it was handed, so the double passes its children straight through.
jest.mock('react-native-markdown-display', () => {
  const react = jest.requireActual('react') as typeof React
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      react.createElement(react.Fragment, null, children),
  }
})

import { TrajectoryRecordScreen } from './TrajectoryRecordScreen'

const SESSION = 's1'

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

function setup(): { manager: ConnectionManager; store: SessionStore } {
  const store = new SessionStore()
  store.applyBaseline({ summaries: [], workspaces: [] })
  return { manager: { store } as unknown as ConnectionManager, store }
}

function feed(store: SessionStore, seq: number, type: string, data: unknown): void {
  store.applyMuxFrame(RpcId(`f${seq}`), {
    type: 'session/event', sessionId: SESSION,
    event: { seq, time: seq * 1_000, type, data },
  } as never)
}

/**
 * One turn whose tool call ran a shell command through the code tool, so the
 * record owns parameters, a result and a sub-tool of its own. `#1` the prompt,
 * `#2` the call, `#3` its sub-call.
 */
function toolTurn(store: SessionStore): void {
  feed(store, 1, 'user/message', { content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })
  feed(store, 2, 'request/header', {
    header: { tools: [{ name: 'code', description: 'run a program', parameters: { type: 'object' } }] },
  })
  feed(store, 3, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'code', arguments: '{"source":"ls"}' })
  feed(store, 4, 'tool/code-dispatch-start', {
    parentCallId: 'c1', subCallId: 'c1.1', name: 'bash', arguments: '{"command":"ls"}',
  })
  feed(store, 5, 'tool/code-dispatch', {
    parentCallId: 'c1', subCallId: 'c1.1', name: 'bash', content: [{ type: 'text', text: 'a.txt' }],
  })
  feed(store, 6, 'tool/result', {
    turn: 1, step: 1,
    message: { toolCallId: 'c1', content: [{ type: 'text', text: 'a.txt' }] },
  })
}

/**
 * One answer the log timed end to end: the step opened at 2s, its first token
 * arrived at 3s and the message landed at 4s, with 50 output tokens of which
 * 20 were spent thinking.
 */
function timedAnswer(store: SessionStore): void {
  feed(store, 1, 'user/message', { content: [{ type: 'text', text: '查一下天津' }], source: { kind: 'user' } })
  feed(store, 2, 'step/start', { turn: 1, step: 1 })
  feed(store, 3, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: '先看数据' } })
  feed(store, 4, 'assistant/message', {
    turn: 1, step: 1,
    message: {
      content: [
        { type: 'reasoning', text: '先看数据' },
        { type: 'text', text: '天津这五年的增速是…' },
      ],
    },
    usage: { inputTokens: 100, outputTokens: 50, reasoningTokens: 20 },
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 80))
  })
}

const trees: renderer.ReactTestRenderer[] = []

function render(
  manager: ConnectionManager,
  index: number,
  onBack: () => void = jest.fn(),
): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  act(() => {
    tree = renderer.create(
      <TrajectoryRecordScreen
        manager={manager}
        sessionId={SESSION}
        index={index}
        onBack={onBack}
      />,
    )
  })
  trees.push(tree)
  return tree
}

/** Press the control carrying one label — a tab, or a section that opens it. */
function press(tree: renderer.ReactTestRenderer, label: string): void {
  const target = tree.root.findAll(node =>
    typeof node.props.onPress === 'function' && node.props.accessibilityLabel === label).at(-1)
  act(() => { target?.props.onPress() })
}

afterEach(() => {
  act(() => {
    for (const tree of trees) tree.unmount()
  })
  trees.length = 0
})

describe('TrajectoryRecordScreen', () => {
  it('opens on the Web inspector\'s summary of an answer', async () => {
    const { manager, store } = setup()
    // 用户 #1 · 思考 #2 · 助手 #3: the answer is the page under test.
    const tree = render(manager, 3)
    timedAnswer(store)
    await settle()

    const text = screenText(tree)
    // The tabs the Web offers for a message, and the record's place in the log.
    expect(text).toContain('trajectory.detail.tab.overview')
    expect(text).toContain('trajectory.detail.tab.preview')
    expect(text).toContain('trajectory.raw')
    expect(text).toContain('trajectory.turn(turn=1)chat.step.separatortrajectory.group.step(step=1)')
    // The summary reads source, status and the step's three token buckets.
    expect(text).toContain('trajectory.request.label(request=1)')
    expect(text).toContain('trajectory.detail.status')
    expect(text).toContain('trajectory.status.done')
    expect(text).toContain('trajectory.detail.tokens')
    expect(text).toContain('trajectory.unit.tokens(value=50)')
    expect(text).toContain('trajectory.detail.reasoning')
    expect(text).toContain('trajectory.unit.tokens(value=20)')
    expect(text).toContain('trajectory.detail.content')
    expect(text).toContain('trajectory.unit.tokens(value=30)')
    // And the request's five timing readings, measured off the recorded clocks.
    expect(text).toContain('trajectory.detail.requestTiming')
    expect(text).toContain('trajectory.timing.started')
    expect(text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/)
    expect(text).toContain('trajectory.timing.totalDuration')
    expect(text).toContain('trajectory.unit.seconds(value=2.00)')
    expect(text).toContain('trajectory.timing.ttft')
    expect(text).toContain('trajectory.timing.generation')
    expect(text).toContain('trajectory.unit.seconds(value=1.00)')
    expect(text).toContain('trajectory.timing.throughput')
    expect(text).toContain('trajectory.unit.tps(value=50.0)')
    // The preview carries the thinking the answer was produced from.
    expect(text).toContain('trajectory.kind.thinking')
    expect(text).toContain('先看数据')
  })

  it('prints one call\'s parameters, result and schema each on its own page', async () => {
    const { manager, store } = setup()
    const tree = render(manager, 2)
    toolTurn(store)
    await settle()

    // 概述 opens with the call's own facts and clips what it captured.
    expect(screenText(tree)).toContain('trajectory.args')
    expect(screenText(tree)).toContain('source')

    press(tree, 'trajectory.args')
    const payload = screenText(tree)
    expect(payload).toContain('trajectory.args')
    expect(payload).toContain('{"source":"ls"}')

    press(tree, 'trajectory.schema')
    const schema = screenText(tree)
    expect(schema).toContain('run a program')
  })

  it('keeps a call\'s result and the sub-tools it ran on the summary', async () => {
    const { manager, store } = setup()
    const tree = render(manager, 2)
    toolTurn(store)
    await settle()

    const text = screenText(tree)
    expect(text).toContain('trajectory.result')
    expect(text).toContain('a.txt')
    expect(text).toContain('trajectory.record.children')
    expect(text).toContain('trajectory.subtools(count=1)')
    expect(text).toContain('bash')
  })

  it('shows a prompt\'s source, the way the Web labels it', async () => {
    const { manager, store } = setup()
    const tree = render(manager, 1)
    feed(store, 1, 'user/message', {
      content: [{ type: 'text', text: '查一下天津' }],
      source: { kind: 'goal', round: 2 },
    })
    await settle()

    const text = screenText(tree)
    expect(text).toContain('trajectory.detail.tab.source')
    expect(text).toContain('trajectory.source.goalRound(round=2)')
  })

  it('opens a system prompt on the one page it has', async () => {
    const { manager, store } = setup()
    feed(store, 1, 'system/message', { message: { content: [{ type: 'text', text: '你是 dsh' }] } })
    const tree = render(manager, 1)
    await settle()

    // The Web's system record has no 概述: it opens straight on 系统提示词.
    const text = screenText(tree)
    expect(text).toContain('trajectory.detail.tab.systemPrompt')
    expect(text).toContain('你是 dsh')
    expect(text).not.toContain('trajectory.detail.tab.overview')
  })

  it('says so when the log no longer holds the record', async () => {
    const { manager, store } = setup()
    const tree = render(manager, 99)
    toolTurn(store)
    await settle()

    expect(screenText(tree)).toContain('trajectory.record.missing')
  })

  it('goes back to the trajectory it was opened from', async () => {
    const { manager } = setup()
    const onBack = jest.fn()
    const tree = render(manager, 1, onBack)
    await settle()

    const back = tree.root.findAll(node =>
      typeof node.props.onPress === 'function' && node.props.accessibilityLabel === 'chat.back').at(-1)
    act(() => { back?.props.onPress() })
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
