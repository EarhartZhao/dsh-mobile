/**
 * The floating notice card.
 *
 * Two things are worth pinning down, because both were bugs in the strip it
 * replaced: the words are never cut off for good (a tap opens them), and the
 * card clears itself on a clock that a reader can restart.
 */
import React from 'react'
import { Clipboard } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context'

jest.mock('react-native-svg', () => ({
  __esModule: true,
  Svg: ({ children }: { children: React.ReactNode }) => children,
  Path: () => null,
  Circle: () => null,
  Rect: () => null,
}))

import { NoticeToast } from './NoticeToast'
import { spacing } from '../theme'

/** The card reads the top inset; a provider has to exist for that to resolve. */
const INSETS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

/** Mount the card the way the shell does: inside the safe-area provider. */
function mount(card: React.ReactElement): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  act(() => {
    tree = renderer.create(<SafeAreaProvider initialMetrics={INSETS}>{card}</SafeAreaProvider>)
  })
  return tree
}

/**
 * The innermost pressable under this accessibility label. The app's `Touchable`
 * forwards its props to the native view, so the label also sits on the wrapper.
 */
function pressable(
  tree: renderer.ReactTestRenderer,
  label: string,
): renderer.ReactTestInstance | undefined {
  return tree.root.findAll(node =>
    typeof node.props.onPress === 'function' && node.props.accessibilityLabel === label).at(-1)
}

/** The card's own pressable — tap opens, long press copies. */
function card(tree: renderer.ReactTestRenderer): renderer.ReactTestInstance {
  const found = pressable(tree, 'notice.toast')
  expect(found).toBeDefined()
  return found!
}

describe('NoticeToast', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('shows one line until it is tapped, then the whole text', () => {
    const tree = mount(
      <NoticeToast text="发送失败：很长的一段话" level="error" onDismiss={jest.fn()} onCopied={jest.fn()} />,
    )

    const collapsed = tree.root.findAllByProps({ children: '发送失败：很长的一段话' })
    expect(collapsed.length).toBeGreaterThan(0)
    expect(collapsed.every(node => node.props.numberOfLines === 1)).toBe(true)

    act(() => { card(tree).props.onPress() })

    expect(tree.root.findAllByProps({ children: '发送失败：很长的一段话' }).length).toBeGreaterThan(0)
    expect(pressable(tree, 'notice.dismiss')).toBeDefined()
  })

  it('clears the status bar instead of landing under the clock', () => {
    const tree = mount(
      <NoticeToast text="已复制" level="info" onDismiss={jest.fn()} onCopied={jest.fn()} />,
    )

    const host = tree.root.findAll(node => node.props.pointerEvents === 'box-none').at(-1)!
    const style = ([] as { top?: number }[]).concat(host.props.style as never)
    expect(style.some(entry => entry?.top === INSETS.insets.top + spacing(2))).toBe(true)
  })

  it('dismisses an info notice after three seconds', () => {
    const onDismiss = jest.fn()
    mount(<NoticeToast text="已复制" level="info" onDismiss={onDismiss} onCopied={jest.fn()} />)

    act(() => { jest.advanceTimersByTime(2_999) })
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => { jest.advanceTimersByTime(1) })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('gives a failure five seconds', () => {
    const onDismiss = jest.fn()
    mount(<NoticeToast text="发送失败" level="error" onDismiss={onDismiss} onCopied={jest.fn()} />)

    act(() => { jest.advanceTimersByTime(3_000) })
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => { jest.advanceTimersByTime(2_000) })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('restarts the countdown on every tap, so a reader never loses it mid-sentence', () => {
    const onDismiss = jest.fn()
    const tree = mount(
      <NoticeToast text="发送失败" level="error" onDismiss={onDismiss} onCopied={jest.fn()} />,
    )

    act(() => { jest.advanceTimersByTime(4_000) })
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => { card(tree).props.onPress() })

    // The original five seconds would have elapsed here; the tap pushed it out.
    act(() => { jest.advanceTimersByTime(4_999) })
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => { jest.advanceTimersByTime(1) })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('copies the whole text on a long press and tells the shell', () => {
    const onCopied = jest.fn()
    const setString = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {})
    const tree = mount(
      <NoticeToast text="session/writer-held: session is already owned" level="error" onDismiss={jest.fn()} onCopied={onCopied} />,
    )

    act(() => { card(tree).props.onLongPress() })

    expect(setString).toHaveBeenCalledWith('session/writer-held: session is already owned')
    expect(onCopied).toHaveBeenCalledTimes(1)
  })

  it('closes from the button under an opened card', () => {
    const onDismiss = jest.fn()
    const tree = mount(
      <NoticeToast text="发送失败" level="error" onDismiss={onDismiss} onCopied={jest.fn()} />,
    )

    act(() => { card(tree).props.onPress() })
    act(() => { pressable(tree, 'notice.dismiss')!.props.onPress() })

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
