import { describe, expect, it } from 'vitest'
import { createMobileMessageFeedback } from '@dsh-mobile/protocol'

function headers() {
  const values = new Map<string, string>()
  return {
    set(name: string, value: string) { values.set(name, value) },
    get(name: string) { return values.get(name) },
  }
}

interface Seen {
  subjects: string[]
  payloads: unknown[]
  token: string | undefined
}

function connection(replies: unknown[], seen: Seen) {
  return {
    async request(subject: string, body: string, options: { headers: { get?: (name: string) => string | undefined } }) {
      const envelope = JSON.parse(body) as { rpcId: string; payload: unknown }
      seen.subjects.push(subject)
      seen.payloads.push(envelope.payload)
      seen.token = options.headers.get?.('x-dsh-token')
      return { data: new TextEncoder().encode(JSON.stringify({
        type: 'server-response',
        rpcId: envelope.rpcId,
        result: { ok: true, value: replies.shift() },
      })) }
    },
  } as never
}

function newSeen(): Seen {
  return { subjects: [], payloads: [], token: undefined }
}

describe('mobile message feedback', () => {
  it('lists, rates, and clears with the observed version', async () => {
    const item = { messageId: 'm1', rating: 'positive', version: 'v1', createdAt: 1, updatedAt: 2 }
    const seen = newSeen()
    const api = createMobileMessageFeedback(
      connection([
        { ok: true, value: { items: [item] } },
        { ok: true, value: item },
        { ok: true, value: { absent: true } },
      ], seen),
      headers, 'dsh-1', () => 'token-1',
    )
    await expect(api.list({ sessionId: 's1' })).resolves.toEqual({ ok: true, value: { items: [item] } })
    await expect(api.put({
      sessionId: 's1', messageId: 'm1', rating: 'positive', ifVersion: null,
    })).resolves.toEqual({ ok: true, value: item })
    await expect(api.delete({ sessionId: 's1', messageId: 'm1', ifVersion: 'v1' }))
      .resolves.toEqual({ ok: true, value: { absent: true } })
    expect(seen.subjects).toEqual([
      'svc.dsh.dsh-1.feedback.list',
      'svc.dsh.dsh-1.feedback.put',
      'svc.dsh.dsh-1.feedback.delete',
    ])
    expect(seen.payloads[1]).toEqual({
      sessionId: 's1', messageId: 'm1', rating: 'positive', ifVersion: null,
    })
    expect(seen.token).toBe('token-1')
  })

  it('returns business failures instead of throwing', async () => {
    const conflict = { ok: false, error: { code: 'version-conflict', current: null } }
    const seen = newSeen()
    const api = createMobileMessageFeedback(
      connection([conflict], seen), headers, 'dsh-1', () => 'token-1',
    )
    // The host reports a stale compare-and-set as data, so callers retry with
    // `error.current` rather than catching.
    await expect(api.put({
      sessionId: 's1', messageId: 'm1', rating: 'negative', ifVersion: 'v0',
    })).resolves.toEqual(conflict)
  })

  it('refuses to call before the device token exists', async () => {
    const seen = newSeen()
    const api = createMobileMessageFeedback(connection([], seen), headers, 'dsh-1', () => undefined)
    await expect(api.list({ sessionId: 's1' })).rejects.toThrow('connection not ready')
    expect(seen.subjects).toEqual([])
  })
})
