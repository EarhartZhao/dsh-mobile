import { describe, expect, it } from 'vitest'
import { deriveConversation } from '../src/conversation.ts'
import { SessionStore } from '../src/session-store.ts'
import { groupTurns } from '../src/turns.ts'
import { RpcId } from '@dsh-mobile/protocol'

const sid = 's-1' as never

function feed(store: SessionStore, seq: number, type: string, data: unknown): void {
  store.applyMuxFrame(RpcId(crypto.randomUUID()), {
    type: 'session/event', sessionId: sid, event: { seq, type, data } as never,
  })
}

describe('trajectory projection', () => {
  it('carries turn/step and the step clock onto the records a trajectory groups', () => {
    const store = new SessionStore()
    feed(store, 1, 'user/message', { message: { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } })
    feed(store, 2, 'step/start', { turn: 1, step: 1 })
    store.applyMuxFrame(RpcId(crypto.randomUUID()), {
      type: 'session/event', sessionId: sid,
      event: { seq: 3, time: 1_500, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } } } as never,
    })
    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items[1]).toMatchObject({ kind: 'assistant', turn: 1, step: 1 })
  })

  it('times a tool row from its dispatch to its result', () => {
    const store = new SessionStore()
    feed(store, 1, 'user/message', { message: { content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } } })
    store.applyMuxFrame(RpcId(crypto.randomUUID()), {
      type: 'session/event', sessionId: sid,
      event: { seq: 2, time: 2_000, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } } as never,
    })
    store.applyMuxFrame(RpcId(crypto.randomUUID()), {
      type: 'session/event', sessionId: sid,
      event: { seq: 3, time: 5_000, type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] } } } as never,
    })
    const tool = deriveConversation(store.sessions.get('s-1')!).find(i => i.kind === 'tool')
    expect(tool).toMatchObject({ kind: 'tool', turn: 1, step: 1, startedAt: 2_000, endedAt: 5_000, status: 'done' })
  })

  it('attaches the call-time schema the request header advertised', () => {
    const store = new SessionStore()
    feed(store, 1, 'request/header', {
      header: { config: { provider: 'deepseek', model: 'deepseek-flash' }, tools: [{ name: 'bash', description: 'run', parameters: { type: 'object' } }] },
    })
    feed(store, 2, 'user/message', { message: { content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } } })
    feed(store, 3, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' })
    const tool = deriveConversation(store.sessions.get('s-1')!).find(i => i.kind === 'tool')
    expect(tool).toMatchObject({ kind: 'tool', schema: { name: 'bash', description: 'run' } })
  })

  it('marks the first system prompt as initial and a later one as a rewrite', () => {
    const store = new SessionStore()
    feed(store, 1, 'system/message', { message: { content: [{ type: 'text', text: 'you are dsh' }] } })
    feed(store, 2, 'system/message', { message: { content: [{ type: 'text', text: 'you are dsh, revised' }] } })
    const systems = deriveConversation(store.sessions.get('s-1')!).filter(i => i.kind === 'system')
    expect(systems.map(i => i.kind === 'system' ? i.initial : null)).toEqual([true, false])
  })

  it('seats a leading system prompt in the opening turn rather than a turn of its own', () => {
    const store = new SessionStore()
    feed(store, 1, 'system/message', { message: { content: [{ type: 'text', text: 'you are dsh' }] } })
    feed(store, 2, 'user/message', { message: { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } })
    feed(store, 3, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } })
    const turns = groupTurns(deriveConversation(store.sessions.get('s-1')!))
    expect(turns).toHaveLength(1)
    expect(turns[0]!.items.map(i => i.kind)).toEqual(['system', 'user', 'assistant'])
  })
})
