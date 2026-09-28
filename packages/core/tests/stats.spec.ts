import { describe, expect, it } from 'vitest'
import { RpcId } from '@dsh-mobile/protocol'
import { SessionStore } from '../src/session-store.ts'
import { billedInputTokens, formatCacheHitPercent, formatTokensPerSecond, sessionStatsView } from '../src/stats.ts'

const sid = 's-stats' as never

function feed(store: SessionStore, seq: number, type: string, data: unknown, time: number): void {
  store.applyMuxFrame(RpcId(crypto.randomUUID()), {
    type: 'session/event', sessionId: sid, event: { seq, type, data, time } as never,
  })
}

describe('session stats', () => {
  it('folds timing and usage from events when projections are absent', () => {
    const store = new SessionStore()
    feed(store, 1, 'step/start', { turn: 1, step: 1 }, 1_000)
    feed(store, 2, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hi' } }, 1_200)
    feed(store, 3, 'assistant/message', {
      turn: 1, step: 1,
      message: { content: [{ type: 'text', text: 'hi' }] },
      usage: { uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 400, cacheWriteTokens: 10 },
    }, 3_000)
    feed(store, 4, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }, 3_000)
    feed(store, 5, 'tool/result', { turn: 1, step: 1, message: { toolCallId: 'c1', content: [] } }, 3_500)
    feed(store, 6, 'step/end', { turn: 1, step: 1 }, 4_000)

    const view = sessionStatsView(store.sessions.get('s-stats')!)
    expect(view.stats).toEqual({
      turns: 1, steps: 1, llmMs: 2_000, toolMs: 500,
      ttftMs: 200, ttftSteps: 1, decodeMs: 1_800, decodeTokens: 50,
    })
    expect(billedInputTokens(view.usage)).toBe(510)
  })

  it('prefers authoritative context and usage projections', () => {
    const store = new SessionStore()
    store.applyHistory(sid, [], {
      asOfSeq: 1,
      values: {
        sessionStats: {
          turns: 4, steps: 20, llmMs: 101_000, toolMs: 35_400,
          ttftMs: 1_000, ttftSteps: 1, decodeMs: 8_000, decodeTokens: 9_500,
        },
        tokenUsage: {
          uncachedInputTokens: 50_000, outputTokens: 9_500,
          cacheReadTokens: 497_000, cacheWriteTokens: 0,
        },
        contextPressure: { projectedTokens: 547_000, contextWindow: 1_000_000 },
        contextBreakdown: { systemTokens: 12_000, toolsTokens: 78_000, messageTokens: 457_000 },
      },
    } as never)

    const view = sessionStatsView(store.sessions.get('s-stats')!)
    expect(view.stats).toMatchObject({ turns: 4, steps: 20, llmMs: 101_000 })
    expect(view.usage).toMatchObject({ outputTokens: 9_500, cacheReadTokens: 497_000 })
    expect(view.pressure).toEqual({ projectedTokens: 547_000, contextWindow: 1_000_000 })
    expect(view.breakdown).toMatchObject({ messageTokens: 457_000 })
  })
})

describe('formatTokensPerSecond', () => {
  it('keeps a decimal below 10 tok/s and rounds above, like the Web strip', () => {
    expect(formatTokensPerSecond(213.4)).toBe('213')
    expect(formatTokensPerSecond(9.44)).toBe('9.4')
    expect(formatTokensPerSecond(9.95)).toBe('10')
    expect(formatTokensPerSecond(0)).toBe('0')
    expect(formatTokensPerSecond(-5)).toBe('0')
  })
})

describe('formatCacheHitPercent', () => {
  it('reports an exact full hit as 100 and no prompt input as nothing', () => {
    expect(formatCacheHitPercent(500, 500)).toBe('100')
    expect(formatCacheHitPercent(0, 0)).toBeNull()
  })

  it('rounds an ordinary ratio to whole percent, halves up', () => {
    expect(formatCacheHitPercent(497_000, 547_000)).toBe('91')
    expect(formatCacheHitPercent(9, 10)).toBe('90')
    expect(formatCacheHitPercent(1, 3)).toBe('33')
    expect(formatCacheHitPercent(2, 3)).toBe('67')
    expect(formatCacheHitPercent(1, 2)).toBe('50')
  })

  it('never rounds a partial hit up to a full one', () => {
    // The whole reason this is not `Math.round(read / billed * 100)`: a session
    // that missed a single cached token must not read as "缓存命中 100%".
    const ninetyNine = formatCacheHitPercent(9_999, 10_000)
    expect(ninetyNine).not.toBe('100')
    expect(ninetyNine?.startsWith('99.')).toBe(true)
    const lots = formatCacheHitPercent(999_999, 1_000_000)
    expect(lots).not.toBe('100')
    expect(lots?.startsWith('99.')).toBe(true)
    // A single decimal of ordinary precision is enough when it already shows
    // the miss.
    expect(formatCacheHitPercent(9_990, 10_000, 1)).toBe('99.9')
  })
})
