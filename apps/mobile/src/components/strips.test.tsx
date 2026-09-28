import React from 'react'
import renderer, { act } from 'react-test-renderer'
import type { SessionStatsView } from '@dsh-mobile/core'

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({
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

describe('SessionStatsBar', () => {
  it('keeps a permanent one-liner: counts, decode speed, cache hit', () => {
    // The web keeps the same composition next to the composer; the phone strip
    // must show it without opening anything.
    const tree = render(view())

    expect(texts(tree)).toContain('stats.counts(turns=1,steps=3) · stats.tokensPerSecond(tps=213) · stats.cacheHit(percent=91)')
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
