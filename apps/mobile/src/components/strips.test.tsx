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
}))

import { SessionStatsBar } from './strips'

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
