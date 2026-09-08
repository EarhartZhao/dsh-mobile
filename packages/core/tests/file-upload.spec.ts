import { describe, expect, it } from 'vitest'
import { createMobileFilePrompts, createMobileFileUploads } from '@dsh-mobile/protocol'

function headers() {
  const values = new Map<string, string>()
  return {
    set(name: string, value: string) { values.set(name, value) },
    get(name: string) { return values.get(name) },
  }
}

function connection(reply: unknown, seen: { subject?: string; body?: string; token: string | undefined }) {
  return {
    async request(subject: string, body: string, options: { headers: { get?: (name: string) => string | undefined } }) {
      seen.subject = subject
      seen.body = body
      seen.token = options.headers.get?.('x-dsh-token')
      return { data: new TextEncoder().encode(JSON.stringify({
        type: 'server-response', rpcId: JSON.parse(body).rpcId, result: { ok: true, value: reply },
      })) }
    },
  } as never
}

describe('mobile file upload fallback', () => {
  it('uploads canonical base64 bytes and returns the staged receipt', async () => {
    const seen: { subject?: string; body?: string; token: string | undefined } = { token: undefined }
    const value = { receiptId: 'receipt-1', file: { attachmentId: 'sha256:file', name: 'notes.txt', bytes: 2 } }
    const api = createMobileFileUploads(connection(value, seen), headers, 'dsh-1', () => 'token-1')
    await expect(api.upload({ sessionId: 's1', data: 'AAE=', name: 'notes.txt' })).resolves.toEqual(value)
    expect(seen.subject).toBe('svc.dsh.dsh-1.file.upload')
    expect(seen.token).toBe('token-1')
    expect(JSON.parse(seen.body!).payload).toEqual({ sessionId: 's1', data: 'AAE=', name: 'notes.txt' })
  })

  it('submits a file receipt through the current session prompt Remote', async () => {
    const seen: { subject?: string; body?: string; token: string | undefined } = { token: undefined }
    const api = createMobileFilePrompts(connection({ accepted: true }, seen), headers, 'dsh-1', () => 'token-1')
    await expect(api.prompt({
      sessionId: 's1', mode: 'queue', content: [{ type: 'file', receiptId: 'receipt-1' }],
    })).resolves.toEqual({ accepted: true })
    expect(seen.subject).toBe('svc.dsh.dsh-1.session.prompt')
    expect(JSON.parse(seen.body!).payload.content).toEqual([{ type: 'file', receiptId: 'receipt-1' }])
  })
})
