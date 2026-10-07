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
  it('discloses an unclaimed surface event instead of dropping it', () => {
    const store = new SessionStore()
    feed(store, 1, 'user/message', { message: { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } })
    // A newer dsh (or a plugin-driven surface) adds a message-producing type.
    // Without the fallback the reader would see nothing at all.
    store.applyMuxFrame(RpcId(crypto.randomUUID()), {
      type: 'session/event', sessionId: sid,
      event: {
        seq: 2, time: 5, type: 'notice/message', surfaceOp: 'append',
        data: { text: 'plugin notice', level: 'info' },
      } as never,
    })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items.map(i => i.kind)).toEqual(['user', 'unknown'])
    expect(items[1]).toMatchObject({
      kind: 'unknown',
      eventType: 'notice/message',
      data: { text: 'plugin notice', level: 'info' },
    })
  })

  it('keeps model-facing surface events and log-only events out of the transcript', () => {
    const store = new SessionStore()
    // The rendered system prompt and developer instructions are surface events
    // the harness writes for the model; the web hides them, and so does this.
    feed(store, 1, 'system/message', { message: { content: [{ type: 'text', text: 'you are dsh' }] } })
    feed(store, 2, 'developer/message', { turn: 1, step: 1, message: { content: [], source: { kind: 'developer' } } })
    // Injected context is a user-role message with a non-user source.
    feed(store, 3, 'user/message', { message: { content: [{ type: 'text', text: 'skill body' }], source: { kind: 'skill-invocation' } } })
    // Log-only bookkeeping carries no surface marker.
    feed(store, 4, 'step/start', { turn: 1, step: 1 })
    feed(store, 5, 'assistant/attempt', { turn: 1, step: 1 })

    expect(deriveConversation(store.sessions.get('s-1')!)).toEqual([])
  })

  it('surfaces a named tool-call delta as a preparing row until the call lands', () => {
    const store = new SessionStore()
    feed(store, 1, 'user/message', { message: { content: [{ type: 'text', text: '看看' }] } })
    store.applyMuxFrame(RpcId(crypto.randomUUID()), {
      type: 'session/event', sessionId: sid,
      event: {
        type: 'assistant/chunk', time: 5,
        data: {
          turn: 1, step: 1, transient: true, attemptId: 'a1', index: 0,
          chunk: { type: 'tool-call-delta', id: 'c9', name: 'bash', argumentsDelta: '{"cmd"' },
        },
      } as never,
    })

    expect(deriveConversation(store.sessions.get('s-1')!).map(i => i.kind)).toEqual(['user', 'preparing'])

    // The durable call supersedes the announcement: one row, not two.
    feed(store, 6, 'tool/call', { turn: 1, step: 1, callId: 'c9', name: 'bash', arguments: '{"cmd":"ls"}' })
    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items.map(i => i.kind)).toEqual(['user', 'tool'])
  })

  it('drops an announcement whose call never lands when the turn ends', () => {
    const store = new SessionStore()
    feed(store, 1, 'user/message', { message: { content: [{ type: 'text', text: '看看' }] } })
    store.applyMuxFrame(RpcId(crypto.randomUUID()), {
      type: 'session/event', sessionId: sid,
      event: {
        type: 'assistant/chunk', time: 5,
        data: {
          turn: 1, step: 1, transient: true, attemptId: 'a1', index: 0,
          chunk: { type: 'tool-call-delta', id: 'c9', name: 'bash' },
        },
      } as never,
    })
    feed(store, 6, 'turn/end', { turn: 1, reason: { kind: 'aborted' } })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items.map(i => i.kind)).toEqual(['user', 'turn-end'])
    expect(items.at(-1)).toMatchObject({ kind: 'turn-end', reason: 'aborted' })
  })

  it('records turn boundaries as timing markers in log order', () => {
    const store = new SessionStore()
    feed(store, 1, 'turn/start', { turn: 1 })
    feed(store, 2, 'user/message', { message: { content: [{ type: 'text', text: '你好' }] } })
    feed(store, 3, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '你好！' }] } })
    feed(store, 4, 'turn/end', { turn: 1, reason: { kind: 'completed' } })

    expect(deriveConversation(store.sessions.get('s-1')!).map(i => i.kind))
      .toEqual(['turn-start', 'user', 'assistant', 'turn-end'])
  })

  it('keeps a live stream item inside its own turn, below the prompt', () => {
    const store = new SessionStore()
    feed(store, 1, 'user/message', { message: { content: [{ type: 'text', text: '讲一下架构' }] } })
    // Transient chunks carry no seq of their own; before the fix the buffer
    // opened at the placeholder zero and the final sort put this item first,
    // so a running turn's reasoning rendered above the prompt.
    store.applyMuxFrame(RpcId(crypto.randomUUID()), {
      type: 'session/event', sessionId: sid,
      event: {
        type: 'assistant/chunk', time: 2,
        data: { turn: 1, step: 1, transient: true, attemptId: 'a1', index: 0, chunk: { type: 'reasoning-delta', text: '先看目录' } },
      } as never,
    })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items.map(i => i.kind)).toEqual(['user', 'stream'])
    expect(items[1]).toMatchObject({ reasoning: '先看目录' })
  })

  it('keeps a live stream item behind the prompt even before any durable turn event', () => {
    const store = new SessionStore()
    // The first chunks of a fresh turn can outrun the prompt's own durable
    // frame; the placeholder seq must not hoist them above it once it lands.
    store.applyMuxFrame(RpcId(crypto.randomUUID()), {
      type: 'session/event', sessionId: sid,
      event: {
        type: 'assistant/chunk', time: 1,
        data: { turn: 1, step: 1, transient: true, attemptId: 'a1', index: 0, chunk: { type: 'reasoning-delta', text: '先想一下' } },
      } as never,
    })
    feed(store, 8, 'user/message', { message: { content: [{ type: 'text', text: '你好' }] } })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items.map(i => i.kind)).toEqual(['user', 'stream'])
  })

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

  it('keeps the host render intent from the call frame on the tool row', () => {
    const store = new SessionStore()
    // The bridge fills the frame's `view` slot from the tool's declared
    // presenter; the row's own title comes from there, not from the tool name.
    feed(store, 1, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '{"command":"echo hi"}' },
      { for: 'call', view: { card: 'terminal', title: 'echo hi', description: 'Echo hi' } })
    let items = deriveConversation(store.sessions.get('s-1')!)
    expect(items[0]).toMatchObject({
      kind: 'tool',
      status: 'running',
      callView: { card: 'terminal', title: 'echo hi' },
      resultView: null,
    })

    // `pwsh` declares no result presenter, so its result frame carries no view:
    // that must clear only the result side, leaving the call card in place.
    feed(store, 2, 'tool/result', {
      turn: 1, step: 1,
      message: { toolCallId: 'c1', content: [{ type: 'text', text: 'hi' }], isError: false },
    })
    items = deriveConversation(store.sessions.get('s-1')!)
    expect(items[0]).toMatchObject({
      status: 'done',
      callView: { card: 'terminal', title: 'echo hi' },
      resultView: null,
    })
  })

  it('surfaces delivered files with the description the model wrote', () => {
    const store = new SessionStore()
    // The `present` tool records durable `deliverables/presented`; its files are
    // what the web renders as a card per deliverable.
    feed(store, 1, 'deliverables/presented', {
      turn: 1,
      callId: 'call-1',
      files: [
        { path: 'DSH-课程笔记/第04讲-Agent-loop.md', description: '第 04 课讲义：Agent loop 的 turn/step 模型' },
        { path: 'dsh-课程大纲.md' },
        { path: '' },
      ],
    })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items).toEqual([{
      kind: 'delivery',
      key: 'd1',
      seq: 1,
      time: 0,
      files: [
        { path: 'DSH-课程笔记/第04讲-Agent-loop.md', description: '第 04 课讲义：Agent loop 的 turn/step 模型' },
        { path: 'dsh-课程大纲.md' },
      ],
    }])
  })

  it('reads delivered files from the present call itself, and dedupes the event', () => {
    const store = new SessionStore()
    // The browser reads presentations from the call's arguments; the durable
    // event records the same fact. Both must land on ONE card per path.
    feed(store, 1, 'tool/call', {
      turn: 1, step: 1, callId: 'c1', name: 'present',
      arguments: JSON.stringify({ files: [
        { path: 'a.md', description: '讲义' },
        { path: 'b.md' },
      ] }),
    })
    feed(store, 2, 'tool/result', { turn: 1, step: 1, message: { toolCallId: 'c1', content: [] } })
    feed(store, 3, 'deliverables/presented', { turn: 1, callId: 'c1', files: [{ path: 'a.md', description: '讲义' }] })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items.filter(item => item.kind === 'delivery')).toEqual([
      expect.objectContaining({
        kind: 'delivery',
        files: [{ path: 'a.md', description: '讲义' }, { path: 'b.md' }],
      }),
    ])
  })

  it('carries the durable assistant message id for feedback targeting', () => {
    const store = new SessionStore()
    feed(store, 1, 'assistant/message', {
      turn: 1, step: 1, message: { id: 'm-1', content: [{ type: 'text', text: 'hi' }] },
    })
    // An event without a message id stays renderable, just not ratable.
    feed(store, 2, 'assistant/message', { turn: 2, step: 1, message: { content: [{ type: 'text', text: 'plain' }] } })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items[0]).toMatchObject({ kind: 'assistant', messageId: 'm-1' })
    expect(items[1]).toMatchObject({ kind: 'assistant', text: 'plain' })
    expect((items[1] as { messageId?: string }).messageId).toBeUndefined()
  })

  it('reads the step\'s token accounting off the assistant message', () => {
    const store = new SessionStore()
    // The provider's own field names, as `assistant/message` records them: the
    // prompt bucket is `inputTokens`. Reading only the token-meter projection's
    // alias (`uncachedInputTokens`) left every usage pill off on the phone.
    feed(store, 1, 'assistant/message', {
      turn: 1,
      step: 1,
      message: { content: [{ type: 'text', text: 'hi' }] },
      usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 400, cacheWriteTokens: 7, reasoningTokens: 2, totalTokens: 422 },
    })
    // A replayed projection sample spells the same bucket the projection's way,
    // and that too is accounting.
    feed(store, 2, 'assistant/message', {
      turn: 2,
      step: 1,
      message: { content: [{ type: 'text', text: 'sample' }] },
      usage: { uncachedInputTokens: 12, outputTokens: 3, cacheReadTokens: 400, cacheWriteTokens: 7, reasoningTokens: 2 },
    })
    // A message the host billed nothing for carries no accounting at all, which
    // is what keeps the turn's usage pill off rather than showing zeros.
    feed(store, 3, 'assistant/message', { turn: 3, step: 1, message: { content: [{ type: 'text', text: 'plain' }] } })
    // A partial usage block is not accounting this client can report.
    feed(store, 4, 'assistant/message', {
      turn: 4, step: 1, message: { content: [{ type: 'text', text: 'partial' }] }, usage: { outputTokens: 5 },
    })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items[0]).toMatchObject({
      kind: 'assistant',
      usage: { uncachedInputTokens: 12, outputTokens: 3, cacheReadTokens: 400, cacheWriteTokens: 7, reasoningTokens: 2 },
    })
    expect(items[1]).toMatchObject({
      kind: 'assistant',
      usage: { uncachedInputTokens: 12, outputTokens: 3, cacheReadTokens: 400, cacheWriteTokens: 7, reasoningTokens: 2 },
    })
    expect(items[2]).not.toHaveProperty('usage')
    expect(items[3]).not.toHaveProperty('usage')
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

  it('derives the same sub-call tree from the renamed PTC dispatch events', () => {
    const store = new SessionStore()
    feed(store, 1, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'dispatch', arguments: '{"task":"outer"}' })
    // dsh 0.1.5 renamed tool/code-dispatch* to tool/ptc-dispatch*.
    feed(store, 2, 'tool/ptc-dispatch-start', { parentCallId: 'c1', subCallId: 's1', name: 'search', arguments: { query: 'first' } })
    feed(store, 3, 'tool/ptc-dispatch', {
      parentCallId: 'c1', subCallId: 's1', name: 'search', arguments: { query: 'first' },
      content: [{ type: 'text', text: 'outer result' }],
    })
    feed(store, 4, 'tool/result', {
      turn: 1, step: 1,
      message: { toolCallId: 'c1', content: [{ type: 'text', text: 'final result' }] },
    })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items).toHaveLength(1)
    const tool = items[0]
    if (tool?.kind !== 'tool') return
    expect(tool).toMatchObject({ callId: 'c1', status: 'done', resultText: 'final result' })
    expect(tool.subCalls).toHaveLength(1)
    expect(tool.subCalls[0]).toMatchObject({
      callId: 's1',
      name: 'search',
      status: 'done',
      resultText: 'outer result',
    })
  })

  it('keeps one sub-call tree when legacy and renamed dispatch events interleave', () => {
    const store = new SessionStore()
    feed(store, 1, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'dispatch', arguments: '{}' })
    feed(store, 2, 'tool/code-dispatch-start', { parentCallId: 'c1', subCallId: 's1', name: 'search', arguments: { query: 'q' } })
    feed(store, 3, 'tool/ptc-dispatch', {
      parentCallId: 'c1', subCallId: 's1', name: 'search', arguments: { query: 'q' },
      content: [{ type: 'text', text: 'ok' }],
    })

    const items = deriveConversation(store.sessions.get('s-1')!)
    const tool = items[0]
    if (tool?.kind !== 'tool') return
    expect(tool.subCalls).toHaveLength(1)
    expect(tool.subCalls[0]).toMatchObject({ callId: 's1', name: 'search', status: 'done', resultText: 'ok' })
  })

  it('keeps attachment images from root and nested read_image results', () => {
    const store = new SessionStore()
    const image = {
      type: 'image',
      attachment: { attachmentId: 'sha256:image', mediaType: 'image/png', width: 2, height: 1, bytes: 10, name: 'shot.png' },
    }
    feed(store, 1, 'tool/call', { turn: 1, step: 1, callId: 'root', name: 'read_image', arguments: '{"file_path":"shot.png"}' })
    feed(store, 2, 'tool/result', {
      turn: 1,
      step: 1,
      message: {
        content: [{
          type: 'tool-result', toolCallId: 'root', isError: false,
          content: [{ type: 'text', text: 'image result' }, image],
        }],
      },
    })
    feed(store, 3, 'tool/call', { turn: 1, step: 2, callId: 'code', name: 'run_code', arguments: '{}' })
    feed(store, 4, 'tool/code-dispatch-start', { parentCallId: 'code', subCallId: 'nested', name: 'read_image', arguments: { file_path: 'shot.png' } })
    feed(store, 5, 'tool/code-dispatch', {
      parentCallId: 'code', subCallId: 'nested', name: 'read_image', arguments: { file_path: 'shot.png' },
      content: [{ type: 'text', text: 'nested image' }, image],
    })

    const items = deriveConversation(store.sessions.get('s-1')!)
    expect(items[0]).toMatchObject({
      kind: 'tool',
      resultText: 'image result',
      resultImages: [{ kind: 'attachment', attachmentId: 'sha256:image', name: 'shot.png' }],
    })
    expect(items[1]).toMatchObject({
      kind: 'tool',
      subCalls: [{
        callId: 'nested',
        resultText: 'nested image',
        resultImages: [{ kind: 'attachment', attachmentId: 'sha256:image', name: 'shot.png' }],
      }],
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

  it('drops abandoned live streams on the transient stream end marker', () => {
    const store = new SessionStore()
    feed(store, 1, 'assistant/chunk', { turn: 1, step: 1, transient: true, attemptId: 'a1', index: 0, chunk: { type: 'text-delta', index: 0, text: '半句' } })
    expect(deriveConversation(store.sessions.get('s-1')!)).toHaveLength(1)
    feed(store, 2, 'assistant/stream-end', { turn: 1, step: 1, transient: true, attemptId: 'a1', index: 1, outcome: { kind: 'abandoned' } })
    expect(deriveConversation(store.sessions.get('s-1')!)).toEqual([])
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
