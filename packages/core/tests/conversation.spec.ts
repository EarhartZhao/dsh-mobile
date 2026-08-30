import { describe, expect, it } from 'vitest'
import { deriveConversation } from '../src/conversation.ts'
import { SessionStore } from '../src/session-store.ts'
import { RpcId } from '@dsh-mobile/protocol'

const sid = 's-1' as never

function feed(store: SessionStore, seq: number, type: string, data: unknown, view?: unknown): void {
  store.applyMuxFrame(RpcId(crypto.randomUUID()), {
    type: 'session/event', sessionId: sid, event: { seq, type, data } as never,
    ...(view === undefined ? {} : { view } as never),
  })
}

describe('deriveConversation', () => {
  it('renders user/assistant/tool items in order', () => {
    const store = new SessionStore()
    feed(store, 1, 'user/message', { message: { content: [{ type: 'text', text: '你好' }] } })
    feed(store, 2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '你好！' }] } })
    feed(store, 3, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' })
    feed(store, 4, 'tool/result', { turn: 1, step: 1, message: { toolCallId: 'c1', content: [{ type: 'text', text: 'a.txt' }] } })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items.map(i => i.kind)).toEqual(['user', 'assistant', 'tool'])
    expect(items[0]).toMatchObject({ text: '你好' })
    expect(items[1]).toMatchObject({ text: '你好！', interrupted: false })
    expect(items[2]).toMatchObject({ name: 'bash', status: 'done', resultPreview: 'a.txt' })
  })

  it('renders inline user images and compaction markers', () => {
    const store = new SessionStore()
    feed(store, 1, 'user/message', {
      message: {
        content: [
          { type: 'text', text: '看这张图' },
          { type: 'image', mediaType: 'image/png', data: 'aGk=' },
        ],
      },
    })
    feed(store, 2, 'compaction/summary', { compactionId: 'compact-1', summary: '旧上下文' })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items.map(item => item.kind)).toEqual(['user', 'compaction'])
    expect(items[0]).toMatchObject({
      text: '看这张图',
      images: [{ kind: 'data', uri: 'data:image/png;base64,aGk=' }],
    })
    expect(items[1]).toMatchObject({ summary: '旧上下文', compactionId: 'compact-1' })
  })

  it('derives produced files from successful mutation result views', () => {
    const store = new SessionStore()
    feed(store, 1, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'edit', arguments: '{}' })
    feed(store, 2, 'tool/result', {
      turn: 1,
      step: 1,
      message: { toolCallId: 'c1', content: [{ type: 'text', text: 'written' }] },
    }, { for: 'result', view: { card: 'diff', locations: [{ path: 'out/index.html' }] } })
    feed(store, 3, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Done.' }] } })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items.map(item => item.kind)).toEqual(['tool', 'assistant'])
    expect(items[1]).toMatchObject({ text: 'Done.', producedFiles: ['out/index.html'] })
  })

  it('derives tool views and nested sub-call trees', () => {
    const store = new SessionStore()
    feed(store, 1, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'dispatch', arguments: '{"task":"outer"}' },
      { for: 'call', view: { card: 'generic', title: '编排工具', kind: 'other' } })
    feed(store, 2, 'tool/code-dispatch-start', { parentCallId: 'c1', subCallId: 's1', name: 'search', arguments: { query: 'first' } })
    feed(store, 3, 'tool/code-dispatch-start', { parentCallId: 's1', subCallId: 's2', name: 'read', arguments: { path: 'a.ts' } })
    feed(store, 4, 'tool/code-dispatch', { parentCallId: 's1', subCallId: 's2', name: 'read', arguments: { path: 'a.ts' }, content: [{ type: 'text', text: 'leaf result' }] })
    feed(store, 5, 'tool/code-dispatch', { parentCallId: 'c1', subCallId: 's1', name: 'search', arguments: { query: 'first' }, isError: true, content: [{ type: 'text', text: 'outer result' }] })
    feed(store, 6, 'tool/result', {
      turn: 1, step: 1,
      message: { toolCallId: 'c1', content: [{ type: 'text', text: 'final result' }] },
    }, { for: 'result', view: { card: 'generic', title: '编排结果', content: 'final result' } })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items).toHaveLength(1)
    const tool = items[0]
    if (tool?.kind !== 'tool') return
    expect(tool).toMatchObject({
      kind: 'tool',
      callId: 'c1',
      status: 'done',
      resultText: 'final result',
      callView: { card: 'generic', title: '编排工具', kind: 'other' },
      resultView: { card: 'generic', title: '编排结果', content: 'final result' },
    })
    if (tool.kind !== 'tool') return
    expect(tool.subCalls).toHaveLength(1)
    expect(tool.subCalls[0]).toMatchObject({
      callId: 's1',
      name: 'search',
      status: 'error',
      resultText: 'outer result',
    })
    expect(tool.subCalls[0]?.subCalls).toHaveLength(1)
    expect(tool.subCalls[0]?.subCalls[0]).toMatchObject({
      callId: 's2',
      name: 'read',
      status: 'done',
      resultText: 'leaf result',
    })
  })

  it('live chunks form a stream item until the durable message lands', () => {
    const store = new SessionStore()
    feed(store, 1, 'user/message', { message: { content: '问' } })
    feed(store, 2, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '正在' } })
    feed(store, 3, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '回答' } })

    let items = deriveConversation(store.sessions.get('s-1')!)
    expect(items.map(i => i.kind)).toEqual(['user', 'stream'])
    expect(items[1]).toMatchObject({ text: '正在回答' })

    feed(store, 4, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '正在回答。' }] } })
    items = deriveConversation(store.sessions.get('s-1')!)
    expect(items.map(i => i.kind)).toEqual(['user', 'assistant'])
    expect(items[1]).toMatchObject({ text: '正在回答。' })
  })

  it('interrupted finalization carries the marker through', () => {
    const store = new SessionStore()
    feed(store, 1, 'assistant/message', { turn: 1, step: 1, interrupted: true, message: { content: [{ type: 'text', text: '半句' }] } })
    expect(deriveConversation(store.sessions.get('s-1')!)[0]).toMatchObject({ interrupted: true, text: '半句' })
  })

  it('skips injected-context user messages (non-user source kind)', () => {
    const store = new SessionStore()
    // Real wire shape (verified against harness 0.1.1-rc.2): data IS the message.
    feed(store, 1, 'user/message', { content: [{ type: 'text', text: '<system-reminder>AGENTS.md</system-reminder>' }], source: { kind: 'agent-instructions' }, role: 'user' })
    feed(store, 2, 'user/message', { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user', rpcId: 'r1' }, role: 'user' })
    feed(store, 3, 'user/message', { content: [{ type: 'text', text: 'no source kept' }], role: 'user' })
    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items.map(i => i.kind === 'user' ? i.text : i.kind)).toEqual(['hi', 'no source kept'])
  })
})
