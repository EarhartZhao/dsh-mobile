import { describe, expect, it } from 'vitest'
import { createMobileFiles, createMobileGoalState } from '@dsh-mobile/protocol'

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

describe('mobile workspace files', () => {
  it('routes listing, text pages, byte windows, and host reveals', async () => {
    const listing = { path: 'src', entries: [{ name: 'a.ts', type: 'file', size: 12 }], truncated: false }
    const page = { absolutePath: '/repo/src/a.ts', version: 'v1', bytes: 120, offset: 1, text: 'export {}', lines: 3, eof: true }
    const window = { absolutePath: '/repo/shot.png', version: 'v1', bytes: 2048, offset: 0, data: 'AAE=', eof: false }
    const seen = newSeen()
    const api = createMobileFiles(
      connection([listing, page, window, window, { watching: true }, { opened: true }], seen), headers, 'dsh-1', () => 'token-1',
    )
    await expect(api.list({ sessionId: 's1' })).resolves.toEqual(listing)
    await expect(api.read({ sessionId: 's1', path: 'src/a.ts', offset: 1, limit: 50 })).resolves.toEqual(page)
    await expect(api.bytes({ sessionId: 's1', path: 'shot.png', length: 4096 })).resolves.toEqual(window)
    await expect(api.related({ sessionId: 's1', path: 'docs/readme.md', relativePath: 'img/shot.png' })).resolves.toEqual(window)
    await expect(api.watch({ sessionId: 's1' })).resolves.toEqual({ watching: true })
    await expect(api.reveal({ sessionId: 's1', path: '/repo/shot.png' })).resolves.toEqual({ opened: true })
    expect(seen.subjects).toEqual([
      'svc.dsh.dsh-1.file.list',
      'svc.dsh.dsh-1.file.read',
      'svc.dsh.dsh-1.file.bytes',
      'svc.dsh.dsh-1.file.related',
      'svc.dsh.dsh-1.file.watch',
      'svc.dsh.dsh-1.file.reveal',
    ])
    expect(seen.payloads[1]).toEqual({ sessionId: 's1', path: 'src/a.ts', offset: 1, limit: 50 })
    expect(seen.payloads[3]).toEqual({ sessionId: 's1', path: 'docs/readme.md', relativePath: 'img/shot.png' })
    expect(seen.payloads[4]).toEqual({ sessionId: 's1' })
    expect(seen.token).toBe('token-1')
  })

  it('refuses to call before the device token exists', async () => {
    const seen = newSeen()
    const api = createMobileFiles(connection([], seen), headers, 'dsh-1', () => undefined)
    await expect(api.list({ sessionId: 's1' })).rejects.toThrow('connection not ready')
    expect(seen.subjects).toEqual([])
  })
})

describe('mobile goal state', () => {
  it('returns the live activation of the current goal', async () => {
    const goal = {
      id: 'goal-1', revision: 2, objective: 'ship', phase: 'active',
      activation: 'disarmed', maxGoalRounds: 8, roundsStarted: 1,
    }
    const seen = newSeen()
    const api = createMobileGoalState(connection([goal], seen), headers, 'dsh-1', () => 'token-1')
    await expect(api.get({ sessionId: 's1' })).resolves.toEqual(goal)
    expect(seen.subjects).toEqual(['svc.dsh.dsh-1.goal.get'])
    expect(seen.payloads[0]).toEqual({ sessionId: 's1' })
  })

  it('normalizes a host without a current goal to null', async () => {
    const seen = newSeen()
    const api = createMobileGoalState(connection([undefined], seen), headers, 'dsh-1', () => 'token-1')
    await expect(api.get({ sessionId: 's1' })).resolves.toBeNull()
  })
})
