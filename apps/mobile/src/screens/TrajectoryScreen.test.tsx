/**
 * The conversation's trajectory screen.
 *
 * The Web's own view is a table with a duration overview, a toolbar and an
 * inspector; the phone lays the same projection out as a list, puts the Web's
 * toolbar and overview above it, and pushes the inspector as a page of its
 * own. What is worth pinning down here is that it reads the log the transcript
 * reads — a tool call and a reasoning block have rows of their own even though
 * Chat renders neither — that its three switches and its search box do what
 * the Web's do, and that it carries no composer.
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

/** Every pressable carrying this accessibility label, in render order. */
function pressablesByLabel(
  tree: renderer.ReactTestRenderer,
  label: string,
): renderer.ReactTestInstance[] {
  return tree.root.findAll(node =>
    typeof node.props.onPress === 'function' && node.props.accessibilityLabel === label)
}

/** The innermost pressable carrying this accessibility label. */
function pressableByLabel(
  tree: renderer.ReactTestRenderer,
  label: string,
): renderer.ReactTestInstance | undefined {
  return pressablesByLabel(tree, label).at(-1)
}

function setup(): { manager: ConnectionManager; store: SessionStore } {
  const store = new SessionStore()
  store.applyBaseline({ summaries: [], workspaces: [] })
  return { manager: { store } as unknown as ConnectionManager, store }
}

/** The left offsets of every block currently drawn on the overview bar. */
function spanLefts(tree: renderer.ReactTestRenderer): string[] {
  return tree.root.findAll((node) => {
    const style = flattenStyle(node.props.style)
    return style?.position === 'absolute' && style.height === 8 && style.borderRadius === 1
  }).map(span => String(flattenStyle(span.props.style)?.left))
}

/** One node's style prop, flattened the way React Native would flatten it. */
function flattenStyle(style: unknown): Record<string, unknown> | null {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (accumulated, entry) => ({ ...accumulated, ...(flattenStyle(entry) ?? {}) }),
      {},
    )
  }
  return typeof style === 'object' && style !== null
    ? style as Record<string, unknown>
    : null
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

function render(
  manager: ConnectionManager,
  onBack: () => void = jest.fn(),
  onOpenRecord: (index: number) => void = jest.fn(),
): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  act(() => {
    tree = renderer.create(
      <TrajectoryScreen
        manager={manager}
        sessionId={SESSION}
        onBack={onBack}
        onOpenRecord={onOpenRecord}
      />,
    )
  })
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

  it('opens a record as its own page instead of unfolding it in the list', async () => {
    const { manager, store } = setup()
    const onOpenRecord = jest.fn()
    const tree = render(manager, jest.fn(), onOpenRecord)
    planningTurn(store)
    await settle()

    // The row's detail belongs to the record page now, not to an inline fold.
    expect(screenText(tree)).not.toContain('trajectory.args')

    const rows = pressablesByLabel(tree, 'trajectory.record.open')
    expect(rows.length).toBeGreaterThan(0)
    act(() => { rows[0]?.props.onPress() })
    // The first row is the prompt, the ledger's `#1`.
    expect(onOpenRecord).toHaveBeenCalledWith(1)
  })

  it('carries the trajectory\u2019s own search box and no composer', async () => {
    const { manager, store } = setup()
    const tree = render(manager)
    planningTurn(store)
    await settle()

    // The only field on this screen is the toolbar's search: a trajectory is
    // for reading what happened, not for asking for more. (React Native
    // forwards the props to its host view, so one field can appear twice.)
    const fields = tree.root.findAll(node => typeof node.props.onChangeText === 'function')
    expect(fields.length).toBeGreaterThan(0)
    expect(fields.every(field => field.props.accessibilityLabel === 'trajectory.toolbar.search'))
      .toBe(true)
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

  it('draws the Web\u2019s three-lane overview above the ledger', async () => {
    const { manager, store } = setup()
    const tree = render(manager)
    planningTurn(store)
    await settle()

    const text = screenText(tree)
    // The bar names the Web's own lanes, and counts every record on it.
    expect(text).toContain('trajectory.lane.input')
    expect(text).toContain('trajectory.lane.model')
    expect(text).toContain('trajectory.lane.tools')
    expect(tree.root.findAll(node => node.props.accessibilityLabel === 'trajectory.timeline.aria'))
      .not.toHaveLength(0)
    // 用户 · 思考 · 助手 · 工具 — one block per record.
    // 用户 · 思考 · 助手 · 工具, one equal-width slot each.
    expect([...new Set(spanLefts(tree))]).toEqual(['0%', '25%', '50%', '75%'])
  })

  it('folds every turn from the toolbar, and opens them again', async () => {
    const { manager, store } = setup()
    const tree = render(manager)
    planningTurn(store)
    await settle()

    act(() => { pressableByLabel(tree, 'trajectory.toolbar.collapseTurns')?.props.onPress() })
    const folded = screenText(tree)
    // Every turn keeps its header; its records are what folded away.
    expect(folded).toContain('trajectory.turn(turn=1)')
    expect(folded).not.toContain('trajectory.group.step(step=1)')
    expect(folded).not.toContain(toolDisplayName('web_search', mockT))

    act(() => { pressableByLabel(tree, 'trajectory.toolbar.expandTurns')?.props.onPress() })
    expect(screenText(tree)).toContain('trajectory.group.step(step=1)')
  })

  it('folds a single turn from its own header', async () => {
    const { manager, store } = setup()
    const tree = render(manager)
    planningTurn(store)
    await settle()

    act(() => { pressableByLabel(tree, 'trajectory.turn.collapse')?.props.onPress() })
    const folded = screenText(tree)
    expect(folded).toContain('trajectory.turn(turn=1)')
    expect(folded).not.toContain('先规划一下')
    act(() => { pressableByLabel(tree, 'trajectory.turn.expand')?.props.onPress() })
    expect(screenText(tree)).toContain('先规划一下')
  })

  it('drops the tool rows from the ledger when 调用 folds them away', async () => {
    const { manager, store } = setup()
    const tree = render(manager)
    planningTurn(store)
    await settle()

    act(() => { pressableByLabel(tree, 'trajectory.toolbar.collapseCalls')?.props.onPress() })
    const folded = screenText(tree)
    expect(folded).not.toContain(toolDisplayName('web_search', mockT))
    // Everything that is not a call is still listed.
    expect(folded).toContain('我来查一下天津近五年的经济数据。')
    expect(folded).toContain('先规划一下')
  })

  it('scales the overview by recorded durations when 时长 is switched on', async () => {
    const { manager, store } = setup()
    const tree = render(manager)
    planningTurn(store)
    await settle()

    const equalWidth = new Set(spanLefts(tree)).size

    // Off, the button offers the recorded-duration projection.
    expect(pressableByLabel(tree, 'trajectory.toolbar.useActualDuration')).toBeDefined()
    act(() => { pressableByLabel(tree, 'trajectory.toolbar.useActualDuration')?.props.onPress() })
    // On, it offers the way back to equal-width operations.
    const on = pressableByLabel(tree, 'trajectory.toolbar.useEqualWidth')
    expect(on?.props.accessibilityState).toEqual({ selected: true })
    // And the bar itself changed: the same records now share the time domain.
    expect(new Set(spanLefts(tree)).size).toBeLessThan(equalWidth)
    act(() => { on?.props.onPress() })
    expect(pressableByLabel(tree, 'trajectory.toolbar.useActualDuration')).toBeDefined()
    expect(new Set(spanLefts(tree)).size).toBe(equalWidth)
  })

  it('answers the search box with its hits, and counts them', async () => {
    const { manager, store } = setup()
    const tree = render(manager)
    planningTurn(store)
    await settle()

    const field = tree.root.findAll(node => typeof node.props.onChangeText === 'function')[0]
    act(() => { field?.props.onChangeText('8 个来源') })

    const text = screenText(tree)
    expect(text).toContain('trajectory.search.count(count=1)')
    // Only the hit stays in the ledger — including its turn and section
    // headers, which is what keeps it readable.
    expect(text).toContain(toolDisplayName('web_search', mockT))
    expect(text).toContain('trajectory.turn(turn=1)')
    expect(text).not.toContain('查一下天津的经济数据')
    expect(text).not.toContain('先规划一下')

    act(() => { field?.props.onChangeText('没有这种东西') })
    expect(screenText(tree)).toContain('trajectory.search.empty')
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
