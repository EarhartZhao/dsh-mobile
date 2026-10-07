import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({
    locale: 'zh-CN',
    t: (key: string, values?: Record<string, string | number>) => values === undefined
      ? key
      : `${key}(${Object.entries(values).map(([name, value]) => `${name}=${String(value)}`).join(',')})`,
  }),
}))

import { MessageActionRow, messageClock } from './MessageActions'
import type { MessageActionRowProps } from './MessageActions'

/** Every distinct line of text rendered anywhere in the tree. */
function texts(tree: renderer.ReactTestRenderer): string[] {
  const lines = tree.root
    .findAll(node => typeof node.props?.children === 'string')
    .map(node => node.props.children as string)
  return [...new Set(lines)]
}

/** The press handler of the one control whose accessibility label matches. */
function press(tree: renderer.ReactTestRenderer, label: string): () => void {
  const node = tree.root.findAll(entry => typeof entry.props?.onPress === 'function'
    && entry.props.accessibilityLabel === label)
  expect(node.length).toBeGreaterThan(0)
  return node[0]!.props.onPress as () => void
}

/** Whether any node carries this accessibility label. */
function hasLabel(tree: renderer.ReactTestRenderer, label: string): boolean {
  return tree.root.findAll(entry => entry.props?.accessibilityLabel === label).length > 0
}

/** A message timestamp on the current local day, so the clock stays a plain time. */
const TODAY_18_57 = ((): number => {
  const at = new Date()
  at.setHours(18, 57, 0, 0)
  return at.getTime()
})()

function render(overrides: Partial<MessageActionRowProps> = {}): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  const props: MessageActionRowProps = {
    time: TODAY_18_57,
    clock: 'end',
    canRate: true,
    onCopy: jest.fn(),
    onRate: jest.fn(),
    onBranch: jest.fn(),
    ...overrides,
  }
  act(() => { tree = renderer.create(<MessageActionRow {...props} />) })
  return tree
}

describe('messageClock', () => {
  const noon = new Date(2026, 8, 28, 12, 0).getTime()

  it('shows the time alone for a message sent today', () => {
    expect(messageClock(new Date(2026, 8, 28, 18, 57).getTime(), 'zh-CN', noon)).toBe('18:57')
  })

  it('adds the date once the message is older, and the year once it is further', () => {
    // Localized numeric date, zero-padded 24-hour clock — the web's clock.md
    // and clock.ymd cut, not a hand-rolled format.
    expect(messageClock(new Date(2026, 8, 20, 9, 5).getTime(), 'zh-CN', noon)).toBe('9/20 09:05')
    expect(messageClock(new Date(2025, 11, 31, 23, 30).getTime(), 'zh-CN', noon)).toBe('2025/12/31 23:30')
  })

  it('renders no clock at all when the message carries no time', () => {
    expect(messageClock(0, 'zh-CN', noon)).toBeNull()
    expect(messageClock(Number.NaN, 'zh-CN', noon)).toBeNull()
  })
})

describe('MessageActionRow', () => {
  it('always offers copy and the clock, and reports the rating it holds', () => {
    const tree = render()

    // Copy is an icon now, so it is found by its label rather than its text;
    // the clock still reads as text and the branch control stays hidden.
    expect(hasLabel(tree, 'actions.copy')).toBe(true)
    expect(texts(tree)).toEqual(expect.arrayContaining(['18:57']))
    expect(hasLabel(tree, 'actions.branch')).toBe(false)
    expect(press(tree, 'actions.feedbackUp')).toBeDefined()
  })

  it('hides the rating pair when the Host serves no message feedback', () => {
    const tree = render({ canRate: false })

    expect(hasLabel(tree, 'actions.feedbackUp')).toBe(false)
    expect(hasLabel(tree, 'actions.feedbackDown')).toBe(false)
  })

  it('asks for the rating a click selects, and for a retraction when it is held', () => {
    const onRate = jest.fn()
    const select = render({ onRate })
    act(() => { press(select, 'actions.feedbackUp')() })
    expect(onRate).toHaveBeenLastCalledWith('positive')

    const held = render({
      onRate,
      rating: { messageId: 'm1', rating: 'positive', version: 'v1', createdAt: 0, updatedAt: 0 },
    })
    act(() => { press(held, 'actions.feedbackUp')() })
    expect(onRate).toHaveBeenLastCalledWith(null)
  })

  it('offers the branch control only where a turn boundary exists', () => {
    expect(hasLabel(render(), 'actions.branch')).toBe(false)
    expect(hasLabel(render({ branch: { seq: 12 } }), 'actions.branch')).toBe(true)
    // A live turn keeps the control, labelled as unavailable rather than gone.
    expect(hasLabel(render({ branch: { unavailable: true } }), 'actions.branchUnavailable')).toBe(true)
  })

  it('puts the clock before the actions on a prompt and after them on an answer', () => {
    const label = (clock: 'start' | 'end'): string[] => {
      const tree = render({ clock })
      return tree.root
        .findAll(node => typeof node.props?.children === 'string')
        .map(node => node.props.children as string)
    }

    expect(label('start')[0]).toBe('18:57')
    expect(label('end').at(-1)).toBe('18:57')
  })

  it('shows the turn-usage pill only for a turn that recorded tokens', () => {
    // No accounting is a different fact from a measured zero: the pill is left
    // off entirely rather than printed as `用量 0 tok`.
    expect(hasLabel(render(), 'message.turnUsage.title')).toBe(false)

    const tree = render({
      usage: {
        totalTokens: 12_300, uncachedInputTokens: 100, cacheReadTokens: 12_000,
        cacheWriteTokens: 0, outputTokens: 200,
      },
    })
    expect(hasLabel(tree, 'message.turnUsage.title')).toBe(true)
    expect(texts(tree)).toContain('message.turnUsage.consumed(total=12.3K)')
  })

  it('opens the turn-usage panel on the pill', () => {
    const tree = render({
      usage: {
        totalTokens: 12_300, uncachedInputTokens: 100, cacheReadTokens: 12_000,
        cacheWriteTokens: 0, outputTokens: 200, reasoningTokens: 40,
      },
    })
    act(() => { press(tree, 'message.turnUsage.title')() })

    expect(texts(tree)).toEqual(expect.arrayContaining([
      'message.turnUsage.title',
      'message.turnUsage.count(count=12,300)',
      'message.turnUsage.cacheHit', '99.2%',
      'message.turnUsage.input', 'message.turnUsage.count(count=100)',
      'message.turnUsage.cacheRead', 'message.turnUsage.count(count=12,000)',
      // The reasoning share rides the output row, which is where the web puts it.
      'message.turnUsage.count(count=200)message.turnUsage.reasoning(tokens=message.turnUsage.count(count=40))',
    ]))
    // A bucket the turn never wrote drops its row instead of reporting zero.
    expect(texts(tree)).not.toContain('message.turnUsage.cacheWrite')
  })
})
