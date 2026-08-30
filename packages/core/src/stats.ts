/**
 * Composer stat projections. Values are defensive wire views: the host may
 * omit an optional projection unit, so the UI can still fall back to a local
 * fold of the loaded event log.
 */
import type { HistoryEntry } from '@dsh-mobile/protocol'
import type { SessionState } from './session-store.ts'

export interface SessionStatsProjection {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
}

export interface SessionUsageProjection {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ContextPressureProjection {
  pressureTokens?: number | undefined
  projectedTokens?: number | undefined
  contextWindow?: number | undefined
}

export interface ContextBreakdownProjection {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}

export interface SessionStatsView {
  stats: SessionStatsProjection
  usage: SessionUsageProjection
  pressure: ContextPressureProjection | null
  breakdown: ContextBreakdownProjection | null
}

type UnknownEvent = { seq?: unknown; time?: unknown; type?: unknown; data?: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numberAt(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined
  const number = value[key]
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : undefined
}

function projectionValue(session: SessionState, key: string): Record<string, unknown> | null {
  return isRecord(session.projections[key]) ? session.projections[key] as Record<string, unknown> : null
}

function eventTime(event: UnknownEvent): number {
  return typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : 0
}

function tokenDelta(chunk: unknown): boolean {
  if (!isRecord(chunk)) return false
  if (chunk['type'] === 'text-delta' || chunk['type'] === 'reasoning-delta') return chunk['text'] !== ''
  if (chunk['type'] === 'tool-call-delta') {
    return chunk['argumentsDelta'] !== '' || chunk['name'] !== undefined
  }
  return false
}

function usageOf(data: unknown): SessionUsageProjection | null {
  if (!isRecord(data) || !isRecord(data['usage'])) return null
  const usage = data['usage']
  const uncachedInputTokens = numberAt(usage, 'uncachedInputTokens')
  const outputTokens = numberAt(usage, 'outputTokens')
  if (uncachedInputTokens === undefined || outputTokens === undefined) return null
  return {
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens: numberAt(usage, 'cacheReadTokens') ?? 0,
    cacheWriteTokens: numberAt(usage, 'cacheWriteTokens') ?? 0,
  }
}

/** Mirrors the host `sessionStats` projection for logs served without it. */
function deriveStats(events: readonly HistoryEntry[]): SessionStatsProjection {
  const result: SessionStatsProjection = {
    turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
  }
  const turns = new Set<number>()
  const openSteps = new Map<string, { start: number; firstToken: number | null }>()
  const pendingCalls = new Map<string, number>()

  for (const entry of events) {
    const event = entry.event as UnknownEvent
    if (!isRecord(event)) continue
    const data = isRecord(event['data']) ? event['data'] : null
    const time = eventTime(event)
    const turn = data !== null && typeof data['turn'] === 'number' ? data['turn'] : undefined
    const step = data !== null && typeof data['step'] === 'number' ? data['step'] : undefined
    const stepId = turn !== undefined && step !== undefined ? `${turn}:${step}` : undefined

    switch (event['type']) {
      case 'step/start': {
        if (stepId !== undefined) openSteps.set(stepId, { start: time, firstToken: null })
        break
      }
      case 'assistant/chunk': {
        if (stepId === undefined || !tokenDelta(data?.['chunk'])) break
        const open = openSteps.get(stepId)
        if (open !== undefined && open.firstToken === null) open.firstToken = time
        break
      }
      case 'assistant/message': {
        if (stepId === undefined) break
        const open = openSteps.get(stepId)
        if (open === undefined) break
        result.llmMs += Math.max(0, time - open.start)
        if (open.firstToken !== null) {
          result.ttftMs += Math.max(0, open.firstToken - open.start)
          result.ttftSteps += 1
          const usage = usageOf(data)
          if (usage !== null) {
            result.decodeMs += Math.max(0, time - open.firstToken)
            result.decodeTokens += usage.outputTokens
          }
        }
        openSteps.delete(stepId)
        break
      }
      case 'tool/call': {
        const callId = data !== null && typeof data['callId'] === 'string' ? data['callId'] : undefined
        if (callId !== undefined) pendingCalls.set(callId, time)
        break
      }
      case 'tool/result': {
        const message = data !== null && isRecord(data['message']) ? data['message'] : null
        const callId = message !== null && typeof message['toolCallId'] === 'string' ? message['toolCallId'] : undefined
        const dispatched = callId === undefined ? undefined : pendingCalls.get(callId)
        if (callId === undefined || dispatched === undefined) break
        result.toolMs += Math.max(0, time - dispatched)
        pendingCalls.delete(callId)
        break
      }
      case 'step/end': {
        result.steps += 1
        if (turn !== undefined) turns.add(turn)
        if (stepId !== undefined) openSteps.delete(stepId)
        break
      }
      default:
        break
    }
  }
  result.turns = turns.size
  return result
}

function deriveUsage(events: readonly HistoryEntry[]): SessionUsageProjection {
  const usage: SessionUsageProjection = {
    uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  }
  for (const entry of events) {
    const event = entry.event as UnknownEvent
    if (!isRecord(event) || event['type'] !== 'assistant/message') continue
    const sample = usageOf(event['data'])
    if (sample === null) continue
    usage.uncachedInputTokens += sample.uncachedInputTokens
    usage.outputTokens += sample.outputTokens
    usage.cacheReadTokens += sample.cacheReadTokens
    usage.cacheWriteTokens += sample.cacheWriteTokens
  }
  return usage
}

/** Builds one stable view from authoritative projections, with local folds as fallbacks. */
export function sessionStatsView(session: SessionState): SessionStatsView {
  const rawStats = projectionValue(session, 'sessionStats')
  const stats: SessionStatsProjection = rawStats === null ? deriveStats(session.events) : {
    turns: numberAt(rawStats, 'turns') ?? 0,
    steps: numberAt(rawStats, 'steps') ?? 0,
    llmMs: numberAt(rawStats, 'llmMs') ?? 0,
    toolMs: numberAt(rawStats, 'toolMs') ?? 0,
    ttftMs: numberAt(rawStats, 'ttftMs') ?? 0,
    ttftSteps: numberAt(rawStats, 'ttftSteps') ?? 0,
    decodeMs: numberAt(rawStats, 'decodeMs') ?? 0,
    decodeTokens: numberAt(rawStats, 'decodeTokens') ?? 0,
  }

  const rawUsage = projectionValue(session, 'tokenUsage')
  const usage: SessionUsageProjection = rawUsage === null ? deriveUsage(session.events) : {
    uncachedInputTokens: numberAt(rawUsage, 'uncachedInputTokens') ?? 0,
    outputTokens: numberAt(rawUsage, 'outputTokens') ?? 0,
    cacheReadTokens: numberAt(rawUsage, 'cacheReadTokens') ?? 0,
    cacheWriteTokens: numberAt(rawUsage, 'cacheWriteTokens') ?? 0,
  }

  const rawPressure = projectionValue(session, 'contextPressure')
  const pressure: ContextPressureProjection | null = rawPressure === null ? null : {
    pressureTokens: numberAt(rawPressure, 'pressureTokens'),
    projectedTokens: numberAt(rawPressure, 'projectedTokens'),
    contextWindow: numberAt(rawPressure, 'contextWindow'),
  }
  const rawBreakdown = projectionValue(session, 'contextBreakdown')
  const breakdown: ContextBreakdownProjection | null = rawBreakdown === null ? null : {
    systemTokens: numberAt(rawBreakdown, 'systemTokens') ?? 0,
    toolsTokens: numberAt(rawBreakdown, 'toolsTokens') ?? 0,
    messageTokens: numberAt(rawBreakdown, 'messageTokens') ?? 0,
  }
  return { stats, usage, pressure, breakdown }
}

/** Billed input is the three disjoint prompt-side buckets (Web parity). */
export function billedInputTokens(usage: SessionUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}
