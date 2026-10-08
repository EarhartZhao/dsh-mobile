/**
 * The conversation's trajectory screen.
 *
 * The Web's own view is a table with a timeline and an inspector; the phone
 * lays the same projection out as a list. What is worth pinning down here is
 * that it reads the log the transcript reads — a tool call and a reasoning
 * block have rows of their own even though Chat renders neither — and that it
 * opens without a composer.
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

import { TrajectoryScreen } from './TrajectoryScreen'
import { toolDisplayName } from '../ui-labels'

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

/** The innermost pressable carrying this accessibility label. */
function pressableByLabel(
  tree: renderer.ReactTestRenderer,
  label: string,
): renderer.ReactTestInstance | undefined {
  return tree.root.findAll(node =>
    typeof node.props.onPress === 'function' && node.props.accessibilityLabel === label).at(-1)
}

function setup(): { manager: ConnectionManager; store: SessionStore } {
  const store = new SessionStore()
  store.applyBaseline({ summaries: [], workspaces: [] })
  return { manager: { store } as unknown as ConnectionManager, store }
}

/** One recorded event, the way the store's mux frames deliver them. */
function feed(store: SessionStore, seq: number, type: string, data: unknown): void {
  store.applyMuxFrame(RpcId(`f${seq}`), {
    type: 'session/event', sessionId: SESSION,
    event: { seq, time: seq * 1_000, type, data },
  } as never)
}

/** One turn: a prompt, a step that thought then answered, and a tool call. */
function planningTurn(store: SessionStore): void {
  feed(store, 1, 'turn/start', { turn: 1 })
  feed(store, 2, 'user/message', { content: [{ type: 'text', text: '查一下天津的经济数据' }] })
  feed(store, 3, 'assistant/message', {
    turn: 1, step: 1,
    message: {
      content: [
        { type: 'reasoning', text: '先规划一下' },
        { type: 'text', text: '我来查一下天津近五年的经济数据。' },
      ],
    },
  })
  feed(store, 4, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'web_search', arguments: '{"query":"天津 GDP"}' })
  feed(store, 5, 'tool/result', {
    turn: 1, step: 1,
    message: { toolCallId: 'c1', content: [{ type: 'text', text: '8 个来源' }] },
  })
  feed(store, 6, 'turn/end', { turn: 1, reason: 'completed' })
}

/**
 * The screen re-derives on the store's own 50ms throttle, so a fed log is only
 * on screen after that window has passed.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 80))
  })
}

const trees: renderer.ReactTestRenderer[] = []

function render(manager: ConnectionManager, onBack: () => void = jest.fn()): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  act(() => { tree = renderer.create(<TrajectoryScreen manager={manager} sessionId={SESSION} onBack={onBack} />) })
  trees.push(tree)
  return tree
}

afterEach(() => {
  act(() => {
    for (const tree of trees) tree.unmount()
  })
  trees.length = 0
})

describe('TrajectoryScreen', () => {
  it('lists a turn\u2019s whole membership, including what the transcript hides', async () => {
    const { manager, store } = setup()
    const tree = render(manager)
    planningTurn(store)
    await settle()

    const text = screenText(tree)
    // The turn boundary is the section header; it carries the closing reason.
    expect(text).toContain('trajectory.turn(turn=1)')
    expect(text).toContain('trajectory.status.done')
    expect(text).toContain('trajectory.calls(count=1)')

    // The prompt, the reasoning and the answer each get their own row.
    expect(text).toContain('trajectory.kind.user')
    expect(text).toContain('查一下天津的经济数据')
    expect(text).toContain('先规划一下')
    expect(text).toContain('我来查一下天津近五年的经济数据。')

    // A tool call is a row here even though the transcript folds it away.
    expect(text).toContain(toolDisplayName('web_search', mockT))
    expect(text).toContain('8 个来源')
  })

  it('opens a folded record onto its arguments, and carries no composer', async () => {
    const { manager, store } = setup()
    const tree = render(manager)
    planningTurn(store)
    await settle()

    // Nothing to type into: a trajectory is for reading what happened.
    expect(tree.root.findAll(node => typeof node.props.onChangeText === 'function')).toHaveLength(0)

    // The tool's detail only exists once the row is open.
    expect(screenText(tree)).not.toContain('trajectory.args')
    const row = pressableByLabel(tree, 'trajectory.detail')
    expect(row).toBeDefined()
    act(() => { row?.props.onPress() })
    expect(screenText(tree)).toContain('trajectory.args')
    expect(screenText(tree)).toContain('query')
  })

  it('says so when the conversation has no records', async () => {
    const { manager } = setup()
    const tree = render(manager)
    await settle()

    expect(screenText(tree)).toContain('trajectory.empty')
  })

  it('groups a turn into its message and step sections, the way the Web does', async () => {
    const { manager, store } = setup()
    const tree = render(manager)
    feed(store, 1, 'system/message', { message: { content: [{ type: 'text', text: 'you are dsh' }] } })
    feed(store, 2, 'user/message', { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })
    feed(store, 3, 'assistant/message', {
      turn: 1, step: 1,
      usage: { inputTokens: 120, outputTokens: 30, reasoningTokens: 5 },
      message: { content: [{ type: 'text', text: 'hello' }] },
    })
    await settle()

    const text = screenText(tree)
    // The preamble and the step are separate sections, in log order.
    expect(text).toContain('trajectory.group.message')
    expect(text).toContain('trajectory.group.step(step=1)')
    // The system prompt is recorded here even though the transcript hides it.
    expect(text).toContain('trajectory.kind.system')
    expect(text).toContain('you are dsh')
    // Records are numbered, and the answer carries the Web's token columns.
    expect(text).toContain('#|1')
    expect(text).toContain('trajectory.metric.input(value=120)')
    expect(text).toContain('trajectory.metric.output(value=30)')
    expect(text).toContain('trajectory.metric.think(value=5)')
  })

  it('files a stepless record that fell after a step below it, not in the preamble', async () => {
    const { manager, store } = setup()
    const tree = render(manager)
    feed(store, 1, 'user/message', { content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })
    feed(store, 2, 'assistant/message', {
      turn: 1, step: 1,
      message: { content: [{ type: 'text', text: 'working' }] },
    })
    // An injected context record lands mid-turn, after the step that ran. The
    // Web opens a second 「消息」 section where it fell rather than lifting it
    // over the step, and a phone that lifted it printed a later clock above an
    // earlier one.
    feed(store, 3, 'user/message', {
      content: [{ type: 'text', text: 'current runtime context' }],
      source: { kind: 'runtime-context' },
    })
    await settle()

    const text = screenText(tree)
    const preamble = text.indexOf('trajectory.group.message')
    const step = text.indexOf('trajectory.group.step(step=1)')
    const late = text.lastIndexOf('trajectory.group.message')
    expect(preamble).toBeGreaterThanOrEqual(0)
    expect(preamble).toBeLessThan(step)
    expect(step).toBeLessThan(late)
    // The record is still in the turn, and still readable.
    expect(text).toContain('trajectory.context.from(source=runtime-context)')
    expect(text).toContain('current runtime context')
  })

  it('opens a tool onto its sub-tool row', async () => {
    const { manager, store } = setup()
    const tree = render(manager)
    feed(store, 1, 'user/message', { content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })
    feed(store, 2, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'code', arguments: '{}' })
    feed(store, 3, 'tool/code-dispatch-start', { parentCallId: 'c1', subCallId: 'c1.1', name: 'bash', arguments: '{"command":"ls"}' })
    feed(store, 4, 'tool/code-dispatch', { parentCallId: 'c1', subCallId: 'c1.1', name: 'bash', content: [{ type: 'text', text: 'a.txt' }] })
    await settle()

    expect(screenText(tree)).toContain('trajectory.subtools(count=1)')
    expect(screenText(tree)).not.toContain('trajectory.kind.subtool')
    act(() => { pressableByLabel(tree, 'trajectory.detail')?.props.onPress() })
    expect(screenText(tree)).toContain('trajectory.kind.subtool')
  })

  it('goes back where it came from', async () => {
    const { manager } = setup()
    const onBack = jest.fn()
    const tree = render(manager, onBack)
    await settle()

    act(() => { pressableByLabel(tree, 'chat.back')?.props.onPress() })
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
