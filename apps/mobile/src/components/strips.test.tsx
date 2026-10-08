import React from 'react'
import renderer, { act } from 'react-test-renderer'
import type { SessionStatsView } from '@dsh-mobile/core'

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({
    locale: 'zh-CN',
    t: (key: string, values?: Record<string, string | number>) => values === undefined
      ? key
      : `${key}(${Object.entries(values).map(([name, value]) => `${name}=${String(value)}`).join(',')})`,
  }),
}))
jest.mock('react-native-svg', () => ({
  __esModule: true,
  Svg: ({ children }: { children: React.ReactNode }) => children,
  Path: () => null,
  Circle: () => null,
  Rect: () => null,
}))

import { GoalBar, SessionStatsBar, TodoStrip } from './strips'

/** Every distinct line of text rendered anywhere in the tree. */
function texts(tree: renderer.ReactTestRenderer): string[] {
  return [...new Set(tree.root
    .findAll(node => typeof node.props?.children === 'string')
    .map(node => node.props.children as string))]
}

function view(overrides: Partial<SessionStatsView> = {}): SessionStatsView {
  return {
    stats: {
      turns: 1, steps: 3, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
      decodeMs: 2_000, decodeTokens: 426, ...overrides.stats,
    },
    usage: {
      uncachedInputTokens: 50_000, outputTokens: 9_500,
      cacheReadTokens: 497_000, cacheWriteTokens: 0, ...overrides.usage,
    },
    pressure: overrides.pressure ?? null,
    breakdown: overrides.breakdown ?? null,
  }
}

function render(value: SessionStatsView): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  act(() => { tree = renderer.create(<SessionStatsBar view={value} />) })
  return tree
}

/** Press the one control carrying this accessibility label. */
function press(tree: renderer.ReactTestRenderer, label: string): void {
  const node = tree.root.findAll(entry => typeof entry.props?.onPress === 'function'
    && entry.props.accessibilityLabel === label)
  expect(node.length).toBeGreaterThan(0)
  act(() => { (node[0]!.props.onPress as () => void)() })
}

describe('SessionStatsBar', () => {
  it('splits the reading into the web\u2019s timing pill and usage pill', () => {
    // The web centres two pills under the composer: the gauge carries what the
    // session has done and how fast, the database carries what it billed. Both
    // stay visible without opening anything.
    const tree = render(view())

    // `557K tok` is the web usage pill's own total: billed input (50K + 497K)
    // plus output (9.5K), compacted exactly like the web's formatTokens.
    expect(texts(tree)).toContain('stats.counts(turns=1,steps=3) · stats.tokensPerSecond(tps=213)')
    expect(texts(tree)).toContain('stats.totalTokens(tokens=557K) · stats.cacheHit(percent=91)')
  })

  it('opens the timing panel on the gauge pill', () => {
    // The figures a pill cannot hold live in the shared stat panel: the timings
    // behind the speed reading, each with its own duration.
    const tree = render(view({
      stats: {
        turns: 1, steps: 3, llmMs: 12_500, toolMs: 3_000, ttftMs: 1_600, ttftSteps: 2,
        decodeMs: 2_000, decodeTokens: 426,
      },
    }))
    press(tree, 'stats.dialog.title')

    expect(texts(tree)).toEqual(expect.arrayContaining([
      'stats.dialog.llmTime', '12.5s',
      'stats.dialog.toolTime', '3s',
      'stats.dialog.ttft', '0.8s',
      'stats.dialog.speed', 'stats.tokensPerSecond(tps=213)',
    ]))
  })

  it('opens the usage panel with the session\u2019s exact buckets', () => {
    const tree = render(view({ stats: { ...view().stats, decodeMs: 0, decodeTokens: 0 } }))
    press(tree, 'stats.dialog.usageTitle')

    expect(texts(tree)).toEqual(expect.arrayContaining([
      'stats.dialog.usageTitle', 'message.turnUsage.count(count=556,500)',
      'message.turnUsage.cacheHit', '91%',
      'message.turnUsage.input', 'message.turnUsage.count(count=50,000)',
      'message.turnUsage.cacheRead', 'message.turnUsage.count(count=497,000)',
      'message.turnUsage.output', 'message.turnUsage.count(count=9,500)',
    ]))
  })

  it('drops the parts a session has no measurement for', () => {
    // No decode timing and no billed input: counts alone, never invented zeros.
    const tree = render(view({
      stats: { turns: 2, steps: 5, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
      usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }))

    expect(texts(tree)).toContain('stats.counts(turns=2,steps=5)')
  })

  it('renders nothing at all when the session has no figure to show', () => {
    let tree!: renderer.ReactTestRenderer | undefined
    act(() => {
      tree = renderer.create(<SessionStatsBar view={view({
        stats: { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
        usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      })} />)
    })

    expect(tree!.toJSON()).toBeNull()
  })
})

/** The band's own strips, folded so the composer keeps its room. */
describe('bottom strips', () => {
  function mount(element: React.ReactElement): renderer.ReactTestRenderer {
    let tree!: renderer.ReactTestRenderer
    act(() => { tree = renderer.create(element) })
    return tree
  }

  it('shows three plan rows and the remainder until the reader opens it', () => {
    const todos = Array.from({ length: 5 }, (_, i) => ({
      content: `任务 ${i + 1}`,
      status: (i === 0 ? 'completed' : 'pending') as 'completed' | 'pending',
    }))
    const tree = mount(<TodoStrip todos={todos} />)

    expect(texts(tree)).toContain('plan.todoTitle(done=1,total=5)')
    expect(texts(tree)).toEqual(expect.arrayContaining(['任务 1', '任务 2', '任务 3']))
    expect(texts(tree)).not.toContain('任务 4')
    expect(texts(tree)).toContain('plan.todoMore(count=2)')

    press(tree, 'plan.todoToggle')
    expect(texts(tree)).toEqual(expect.arrayContaining(['任务 4', '任务 5']))
    expect(texts(tree)).not.toContain('plan.todoMore(count=2)')
  })

  it('keeps a plan that already fits flat, with no control of its own', () => {
    const tree = mount(<TodoStrip todos={[{ content: '任务 1', status: 'pending' }]} />)

    expect(texts(tree)).toContain('任务 1')
    expect(tree.root.findAll(node => node.props.accessibilityLabel === 'plan.todoToggle')).toHaveLength(0)
  })

  it('folds a long objective to its first two lines and opens on tap', () => {
    const goal = {
      id: 'g1', revision: 1, phase: 'active' as const,
      objective: '把移动端的聊天页按 Web 的样式重做一遍，包含用户消息、助手消息、思考过程与输入框。',
    }
    const tree = mount(
      <GoalBar goal={goal} onEdit={jest.fn()} onPause={jest.fn()} onResume={jest.fn()} onComplete={jest.fn()} onClear={jest.fn()} />,
    )

    const objective = (): number | undefined => tree.root
      .findAll(node => node.props.children === goal.objective)
      .at(-1)?.props.numberOfLines as number | undefined
    expect(objective()).toBe(2)

    press(tree, 'goal.expand')
    expect(objective()).toBeUndefined()
  })

  it('leaves a one-line objective without a fold control', () => {
    const goal = { id: 'g1', revision: 1, phase: 'active' as const, objective: '修好滚动' }
    const tree = mount(
      <GoalBar goal={goal} onEdit={jest.fn()} onPause={jest.fn()} onResume={jest.fn()} onComplete={jest.fn()} onClear={jest.fn()} />,
    )

    expect(texts(tree)).toContain('修好滚动')
    expect(tree.root.findAll(node => node.props.accessibilityLabel === 'goal.expand')).toHaveLength(0)
  })
})
