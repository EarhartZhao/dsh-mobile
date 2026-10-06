import { describe, expect, it } from 'vitest'
import {
  redeemPairingCode,
  sendHello,
  TOKEN_HEADER,
  type NatsConnLike,
  type NatsHeadersLike,
} from '@dsh-mobile/protocol'

const encoder = new TextEncoder()

function memoryHeaders(): NatsHeadersLike {
  const values = new Map<string, string>()
  return {
    set: (key, value) => { values.set(key, value) },
    get: key => values.get(key),
  }
}

function response(rpcId: string, value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify({
    type: 'server-response',
    rpcId,
    result: { ok: true, value },
  }))
}

describe('pairing protocol', () => {
  it('sends the installation id when redeeming a code and returns the event key', async () => {
    let request: { subject: string, payload: Record<string, unknown> } | null = null
    const conn = {
      request: async (subject: string, data?: Uint8Array | string) => {
        const envelope = JSON.parse(String(data)) as { rpcId: string, payload: Record<string, unknown> }
        request = { subject, payload: envelope.payload }
        return {
          subject,
          data: response(envelope.rpcId, {
            token: 'device-token',
            deviceId: 'device-id',
            expiresAt: '2027-01-01T00:00:00.000Z',
            eventKey: 'event-key',
            installationId: '0e4d8614-fef3-4e31-82ec-b442974c0956',
          }),
        }
      },
      subscribe: () => { throw new Error('not used') },
      flush: async () => undefined,
      close: async () => undefined,
    } as NatsConnLike

    const paired = await redeemPairingCode(
      conn,
      memoryHeaders,
      'home-test',
      'ABCDEFGH',
      'Pixel 8',
      { installationId: '0e4d8614-fef3-4e31-82ec-b442974c0956' },
    )

    expect(request).toEqual({
      subject: 'svc.dsh.home-test.pair',
      payload: {
        code: 'ABCDEFGH',
        deviceName: 'Pixel 8',
        installationId: '0e4d8614-fef3-4e31-82ec-b442974c0956',
      },
    })
    expect(paired.eventKey).toBe('event-key')
  })

  it('echoes the event key and installation id on hello', async () => {
    let request: {
      subject: string
      payload: Record<string, unknown>
      token: string | undefined
    } | null = null
    const conn = {
      request: async (
        subject: string,
        data?: Uint8Array | string,
        options?: { headers?: NatsHeadersLike },
      ) => {
        const envelope = JSON.parse(String(data)) as { rpcId: string, payload: Record<string, unknown> }
        request = {
          subject,
          payload: envelope.payload,
          token: options?.headers?.get(TOKEN_HEADER),
        }
        return { subject, data: response(envelope.rpcId, { ok: true }) }
      },
      subscribe: () => { throw new Error('not used') },
      flush: async () => undefined,
      close: async () => undefined,
    } as NatsConnLike

    await sendHello(conn, memoryHeaders, 'home-test', 'device-token', {
      deviceName: 'Pixel 8',
      eventKey: 'event-key',
      installationId: '0e4d8614-fef3-4e31-82ec-b442974c0956',
    })

    expect(request).toEqual({
      subject: 'svc.dsh.home-test.hello',
      payload: {
        deviceName: 'Pixel 8',
        installationId: '0e4d8614-fef3-4e31-82ec-b442974c0956',
        eventKey: 'event-key',
      },
      token: 'device-token',
    })
  })
})
