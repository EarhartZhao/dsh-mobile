/**
 * One trajectory record's own page.
 *
 * The Web shows the record it is inspecting in a panel beside the ledger; the
 * phone pushes this page. What matters is that nothing is left behind: the
 * full body, every labelled block the projection captured, and the sub-tool
 * calls the record owns.
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
 * `#2` the answer, `#3` the call, `#4` its sub-call.
 */
function toolTurn(store: SessionStore): void {
  feed(store, 1, 'user/message', { content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })
  feed(store, 2, 'assistant/message', {
    turn: 1, step: 1,
    message: { content: [{ type: 'text', text: 'ok' }] },
  })
  feed(store, 3, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'code', arguments: '{"source":"ls"}' })
  feed(store, 4, 'tool/code-dispatch-start', { parentCallId: 'c1', subCallId: 'c1.1', name: 'bash', arguments: '{"command":"ls"}' })
  feed(store, 5, 'tool/code-dispatch', { parentCallId: 'c1', subCallId: 'c1.1', name: 'bash', content: [{ type: 'text', text: 'a.txt' }] })
  feed(store, 6, 'tool/result', {
    turn: 1, step: 1,
    message: { toolCallId: 'c1', content: [{ type: 'text', text: 'a.txt' }] },
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

afterEach(() => {
  act(() => {
    for (const tree of trees) tree.unmount()
  })
  trees.length = 0
})

describe('TrajectoryRecordScreen', () => {
  it('prints a call in full: its parameters, its result and its sub-tools', async () => {
    const { manager, store } = setup()
    const tree = render(manager, 3)
    toolTurn(store)
    await settle()

    const text = screenText(tree)
    expect(text).toContain('trajectory.record.title(index=3)')
    expect(text).toContain('trajectory.kind.tool')
    // The section it was filed under, and the turn it belongs to.
    expect(text).toContain('trajectory.record.field.turn')
    expect(text).toContain('trajectory.turn(turn=1)')
    expect(text).toContain('trajectory.group.step(step=1)')
    // The call's own parameters are captured, not summarized.
    expect(text).toContain('trajectory.args')
    expect(text).toContain('source')
    // Its result is the record's body, in full.
    expect(text).toContain('trajectory.record.body')
    expect(text).toContain('a.txt')
    // And the sub-tool it ran is here too, as a block of its own.
    expect(text).toContain('trajectory.record.children')
    expect(text).toContain('trajectory.subtools(count=1)')
    expect(text).toContain('bash')
  })

  it('prints a reasoning block on the record that owns it', async () => {
    const { manager, store } = setup()
    feed(store, 1, 'assistant/message', {
      turn: 1, step: 1,
      message: {
        content: [
          { type: 'reasoning', text: '先看一遍日志' },
          { type: 'text', text: '看完了' },
        ],
      },
    })
    const tree = render(manager, 1)
    await settle()

    const text = screenText(tree)
    expect(text).toContain('trajectory.kind.thinking')
    expect(text).toContain('先看一遍日志')
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
