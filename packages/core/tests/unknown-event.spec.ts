import { describe, expect, it } from 'vitest'
import { compactJson, isUnclaimedSurfaceEvent, prettyJson } from '../src/unknown-event.ts'

describe('isUnclaimedSurfaceEvent', () => {
  it('claims an append-origin surface event this client cannot render', () => {
    // A newer dsh (or a plugin-driven surface) adds a message-producing type:
    // the fallback row is what keeps it visible instead of silently dropped.
    // The host marks surface eligibility with `surfaceOp`, so a stale client
    // needs no matching table to notice the new type.
    expect(isUnclaimedSurfaceEvent('notice/message', 'append')).toBe(true)
    expect(isUnclaimedSurfaceEvent('user/message', 'append')).toBe(true)
    expect(isUnclaimedSurfaceEvent('tool/result', 'append')).toBe(true)
    expect(isUnclaimedSurfaceEvent('assistant/message', 'append')).toBe(true)
  })

  it('excludes the surface events the harness writes for the model alone', () => {
    // The rendered system prompt and developer instructions are surface events,
    // but the web projects them into hidden nodes; disclosing them would put
    // model-facing boilerplate in the reader's transcript.
    expect(isUnclaimedSurfaceEvent('system/message', 'append')).toBe(false)
    expect(isUnclaimedSurfaceEvent('developer/message', 'append')).toBe(false)
  })

  it('excludes replacement copies and log-only bookkeeping', () => {
    // A replacement shadows a surface range for the model; the reader already
    // saw the append-origin event it replaced.
    expect(isUnclaimedSurfaceEvent('user/message', { op: 'replace' })).toBe(false)
    expect(isUnclaimedSurfaceEvent('user/message', undefined)).toBe(false)
    // Log-only bookkeeping carries no marker — step/turn boundaries, attempt
    // records, dispatch bookkeeping, a plugin's own private events.
    expect(isUnclaimedSurfaceEvent('step/start', undefined)).toBe(false)
    expect(isUnclaimedSurfaceEvent('turn/end', undefined)).toBe(false)
    expect(isUnclaimedSurfaceEvent('assistant/attempt', undefined)).toBe(false)
    expect(isUnclaimedSurfaceEvent('my-plugin/notice', undefined)).toBe(false)
    // A marker on a log-only type is a shape a conformant host cannot produce
    // (it rejects a non-surface type carrying the marker). The client trusts the
    // marker rather than keeping a type table that would go stale, and showing
    // the row is the safer side of that trade.
    expect(isUnclaimedSurfaceEvent('step/start', 'append')).toBe(true)
  })

  it('survives a malformed event type', () => {
    expect(isUnclaimedSurfaceEvent(undefined, 'append')).toBe(false)
    expect(isUnclaimedSurfaceEvent(42, 'append')).toBe(false)
  })
})

describe('payload previews', () => {
  it('compacts the collapsed preview to one capped line', () => {
    // JSON.stringify escapes the newline, so the preview stays one physical line
    // while keeping the payload verbatim.
    expect(compactJson({ kind: 'notice', text: 'hello\n  world' })).toBe('{"kind":"notice","text":"hello\\n world"}')
    expect(compactJson('plain text')).toBe('plain text')
    expect(compactJson({ text: 'x'.repeat(400) })).toHaveLength(200)
  })

  it('indents the expanded payload and caps it', () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(prettyJson({ text: 'x'.repeat(9000) }).endsWith('…')).toBe(true)
    expect(prettyJson({ text: 'x'.repeat(9000) })).toHaveLength(4000)
  })

  it('never throws on a payload it cannot serialize', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    expect(typeof compactJson(cyclic)).toBe('string')
    expect(compactJson(undefined)).toBe('undefined')
  })
})
