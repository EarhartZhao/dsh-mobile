/**
 * How a reply is read off the mobile wire.
 *
 * The frozen error union is a closed set, and a plugin older than 0.2.37
 * forwards the Host's own namespaced code verbatim. Reading the envelope
 * strictly then threw away the one thing the reader needed — the Host's
 * message — and surfaced a zod issue dump instead.
 */
import { describe, expect, it } from 'vitest'
import { MobileRemoteError, readMobileResponse } from '@dsh-mobile/protocol'

const encoder = new TextEncoder()

function body(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

function failure(error: unknown): Uint8Array {
  return body({ type: 'server-response', rpcId: 'r1', result: { ok: false, error } })
}

describe('mobile reply reading', () => {
  it('returns the value of a successful reply', () => {
    expect(readMobileResponse(body({
      type: 'server-response',
      rpcId: 'r1',
      result: { ok: true, value: { commands: [{ name: 'plan' }] } },
    }))).toEqual({ commands: [{ name: 'plan' }] })
  })

  it('carries the code and message of a failure the frozen union names', () => {
    const data = failure({ code: 'agent-busy', message: 'busy', details: { reason: 'r' } })
    expect(() => readMobileResponse(data)).toThrow(MobileRemoteError)
    try {
      readMobileResponse(data)
    } catch (error) {
      expect((error as MobileRemoteError).code).toBe('agent-busy')
      expect((error as MobileRemoteError).message).toBe('busy')
    }
  })

  it('keeps a code this build has never seen, with the Host\'s own message', () => {
    // Exactly what a plugin <= 0.2.36 sends for `command.list` inside a
    // subagent conversation.
    const data = failure({
      code: 'session/agent-busy',
      message: 'session "child-1" is owned by subagent routing',
      details: { reason: 'use subagent delivery for this child session' },
    })
    try {
      readMobileResponse(data)
      throw new Error('expected a failure')
    } catch (error) {
      expect(error).toBeInstanceOf(MobileRemoteError)
      expect((error as MobileRemoteError).code).toBe('session/agent-busy')
      expect((error as MobileRemoteError).message).toBe('session "child-1" is owned by subagent routing')
    }
  })

  it('reports a body that is not a server response at all', () => {
    expect(() => readMobileResponse(encoder.encode('not json'))).toThrow('the reply was not JSON')
    expect(() => readMobileResponse(body({ hello: 'world' }))).toThrow('the reply was not a server response')
  })
})
