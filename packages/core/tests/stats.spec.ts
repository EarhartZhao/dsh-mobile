import { describe, expect, it } from 'vitest'
import { RpcId } from '@dsh-mobile/protocol'
import { SessionStore } from '../src/session-store.ts'
import { billedInputTokens, sessionStatsView } from '../src/stats.ts'

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
