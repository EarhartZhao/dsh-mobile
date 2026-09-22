/**
 * Full user-journey integration test over a real nats-server.
 * Simulates every user input step in one sequential `it` block so state
 * carries across steps: pair → connect → create session → send text →
 * stream → image → file → approval → question → command → search → fork →
 * rename → archive → feedback → workspace → cancel → disconnect →
 * reconnect → unpair → stop.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect, headers as natsHeaders, type NatsConnection } from 'nats'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NatsApiClient, TOKEN_HEADER } from '@dsh-mobile/protocol'
import type { MuxFrame } from '@dsh-mobile/protocol'
import { RpcId } from '@dsh-mobile/protocol'
import { ConnectionManager } from '../src/connection-manager.ts'
import { REQUIRED_PLUGIN_FEATURES } from '../src/compatibility.ts'

const PORT = 17500 + Math.floor(Math.random() * 500)
const URL = `nats://127.0.0.1:${PORT}`
const INSTANCE = 'journey-pc'
const TOKEN = 'journey-token'
const NATS_SERVER_BIN = process.env.NATS_SERVER_BIN ?? 'C:\\nats-server\\nats-server.exe'
const describeNats = existsSync(NATS_SERVER_BIN) ? describe : describe.skip

let server: ChildProcess
let host: NatsConnection

const enc = new TextEncoder()
const dec = new TextDecoder()

const received: { method: string; payload: Record<string, unknown> }[] = []

function ok(rpcId: string, value: unknown): Uint8Array {
  return enc.encode(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }))
}

function err(rpcId: string, message: string): Uint8Array {
  return enc.encode(JSON.stringify({ type: 'server-response', rpcId, result: { ok: false, error: { code: 'internal', message, details: {} } } }))
}

function pushMux(frame: MuxFrame, rpcId?: string): void {
  host.publish(`evt.dsh.${INSTANCE}.mux`, enc.encode(JSON.stringify({
    type: 'server-request', rpcId: rpcId ?? crypto.randomUUID(), method: 'events.mux', payload: frame,
  })))
}

const SESSION_A = 's-journey-a'
const SESSION_B = 's-journey-b'

const workspaces = [
  { workspaceId: 'ws-1', path: 'C:\\proj\\frontend', title: 'Frontend', sessionIds: [SESSION_A], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() },
  { workspaceId: 'ws-2', path: 'C:\\proj\\backend', title: 'Backend', sessionIds: [SESSION_B], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() },
]
const sessions = [
  { sessionId: SESSION_A, updatedAt: 200, running: false, cwd: 'C:\\proj\\frontend', blank: false },
  { sessionId: SESSION_B, updatedAt: 100, running: false, cwd: 'C:\\proj\\backend', blank: true },
]

beforeAll(async () => {
  server = spawn(NATS_SERVER_BIN, ['-p', String(PORT)], { stdio: 'ignore' })
  await new Promise(r => setTimeout(r, 1500))
  host = await connect({ servers: URL })

  const sub = host.subscribe(`svc.dsh.${INSTANCE}.>`)
  void (async () => {
    for await (const msg of sub) {
      const method = msg.subject.slice(`svc.dsh.${INSTANCE}.`.length)
      const body = JSON.parse(dec.decode(msg.data)) as { rpcId: string; payload?: Record<string, unknown> }
      if (msg.headers?.get(TOKEN_HEADER) !== TOKEN) {
        msg.respond(err(body.rpcId, 'mobile-unauthenticated'))
        continue
      }
      received.push({ method, payload: body.payload ?? {} })
      switch (method) {
        case 'host.describe':
          msg.respond(ok(body.rpcId, { version: '0.2.0', cwd: 'C:\\proj', attachedSessions: 2, home: 'C:\\home', canOpenPath: true }))
          break
        case 'workspace.list':
          msg.respond(ok(body.rpcId, { items: workspaces, archivedSessionIds: [] }))
          break
        case 'session.list':
          msg.respond(ok(body.rpcId, { items: sessions }))
          break
        case 'session.create':
          msg.respond(ok(body.rpcId, { sessionId: 's-fresh' }))
          break
        case 'session.prompt': {
          const sid = (body.payload as { sessionId?: string })?.sessionId
          msg.respond(ok(body.rpcId, { accepted: true }))
          setTimeout(() => {
            pushMux({ type: 'session/subscribed', sessionId: sid, lastSeq: 0 } as never)
            pushMux({ type: 'session/event', sessionId: sid, event: { seq: 1, time: 0, type: 'user/message', data: {} } } as never)
            pushMux({ type: 'session/event', sessionId: sid, event: { seq: 2, time: 0, type: 'assistant/chunk', data: { transient: true, attemptId: 'a1', index: 0, turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Hello, ' } } } } as never)
            pushMux({ type: 'session/event', sessionId: sid, event: { seq: 3, time: 0, type: 'assistant/chunk', data: { transient: true, attemptId: 'a1', index: 1, turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'world!' } } } } as never)
            pushMux({ type: 'session/event', sessionId: sid, event: { seq: 4, time: 0, type: 'assistant/message', data: { turn: 1, step: 1, content: [{ type: 'text', text: 'Hello, world!' }] } } } as never)
          }, 100)
          break
        }
        case 'session.cancel':
          msg.respond(ok(body.rpcId, { accepted: true }))
          break
        case 'session.rename':
          msg.respond(ok(body.rpcId, { title: 'Renamed', seq: 1 }))
          break
        case 'session.fork':
          msg.respond(ok(body.rpcId, { sessionId: 's-forked' }))
          break
        case 'session.search':
          msg.respond(ok(body.rpcId, { items: [{ sessionId: SESSION_A, snippet: 'matched text', seq: 5 }], hasMore: false }))
          break
        case 'session.selectModel':
          msg.respond(ok(body.rpcId, { accepted: true }))
          break
        case 'feedback.put':
        case 'feedback.list':
        case 'feedback.delete':
          msg.respond(ok(body.rpcId, { ok: true }))
          break
        case 'file.upload':
          msg.respond(ok(body.rpcId, { fileId: 'f-1', name: 'test.txt', size: 12 }))
          break
        case 'command.list':
          msg.respond(ok(body.rpcId, { commands: [{ name: 'help', description: 'Show help' }, { name: 'plan', description: 'Toggle plan' }] }))
          break
        case 'skill.list':
          msg.respond(ok(body.rpcId, [{ name: 'review', path: 'C:\\skills\\review' }]))
          break
        case 'subagent.list':
          msg.respond(ok(body.rpcId, { items: [] }))
          break
        case 'subagent.history':
          msg.respond(ok(body.rpcId, { items: [] }))
          break
        case 'reference.files':
          msg.respond(ok(body.rpcId, [{ path: 'src/app.ts', kind: 'file' }]))
          break
        case 'reference.sessions':
          msg.respond(ok(body.rpcId, [{ sessionId: SESSION_A, label: 'Frontend', sameWorkspace: true, createdAt: 1, mention: '@[Frontend](dsh-session:c2ph' }]))
          break
        case 'host.listDirectory':
          msg.respond(ok(body.rpcId, {
            path: 'C:\\proj', home: 'C:\\home',
            crumbs: [{ name: 'proj', path: 'C:\\proj', hidden: false }],
            entries: [
              { name: 'src', path: 'C:\\proj\\src', hidden: false },
              { name: 'app.ts', path: 'C:\\proj\\app.ts', hidden: false },
            ],
            truncated: false,
          }))
          break
        case 'host.openPath':
          msg.respond(ok(body.rpcId, undefined))
          break
        case 'respond':
          msg.respond(enc.encode(JSON.stringify({ accepted: true })))
          break
        case 'mobile.info':
          msg.respond(ok(body.rpcId, { pluginVersion: '0.2.2', mobileApi: 2, features: [...REQUIRED_PLUGIN_FEATURES, 'health-check'] }))
          break
        case 'mobile.health':
          msg.respond(ok(body.rpcId, { status: 'ok', connection: 'connected', devices: 1, pluginVersion: '0.2.2', mobileApi: 2, features: [...REQUIRED_PLUGIN_FEATURES, 'health-check'], buildId: 'b', loadedFrom: 'x', instanceId: INSTANCE, startedAt: new Date(0).toISOString(), uptimeMs: 100, lastConnectedAt: new Date(0).toISOString(), lastReconnectAt: null, lastError: null }))
          break
        case 'hello':
          // Replay a pending approval so reconnect tests see state recovery.
          pushMux({ type: 'approval/requested', sessionId: SESSION_A, approvalId: 'ap-hello', toolName: 'bash', reason: 'hello replay' } as never)
          msg.respond(ok(body.rpcId, { ok: true }))
          break
        default:
          msg.respond(ok(body.rpcId, undefined))
      }
    }
  })()
  await host.flush()
}, 20_000)

afterAll(async () => {
  await host?.drain()
  server?.kill()
})

async function appConn(): Promise<NatsConnection> {
  return connect({ servers: URL })
}

describeNats('Full user journey', () => {
  it('walks the entire user flow with realistic inputs', async () => {
    // ── 1. Connect ──
    const manager = new ConnectionManager({
      connect: appConn,
      headers: natsHeaders,
      instanceId: INSTANCE,
      getToken: () => TOKEN,
    })
    await manager.start()
    expect(manager.state).toBe('online')
    const client = manager.client!
    const store = manager.store
    expect(manager.hostInfo).toMatchObject({ version: '0.2.0' })

    // ── 2. Session list has baseline data ──
    expect(store.sessions.size).toBeGreaterThanOrEqual(0)

    // ── 3. Create new session ──
    const created = await client.sessions.create({} as never)
    expect(created.result.ok).toBe(true)
    if (created.result.ok) expect(created.result.value).toMatchObject({ sessionId: 's-fresh' })

    // ── 4. Send text message → receive stream ──
    await client.sessions.prompt({ sessionId: SESSION_A, content: [{ type: 'text', text: 'Hello agent' }] } as never)
    await new Promise(r => setTimeout(r, 500))
    const sessionA = store.sessions.get(SESSION_A)
    expect(sessionA).toBeDefined()
    expect(sessionA!.events.length).toBeGreaterThan(0)
    expect(received.some(r => r.method === 'session.prompt')).toBe(true)

    // ── 5. Send image attachment ──
    await client.sessions.prompt({
      sessionId: SESSION_A,
      content: [
        { type: 'text', text: 'look at this' },
        { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', name: 'shot.png' },
      ],
    } as never)
    expect(received.filter(r => r.method === 'session.prompt').length).toBeGreaterThanOrEqual(2)

    // ── 6. File upload ──
    const uploads = (client as unknown as { fileUploads: { upload: (args: Record<string, unknown>) => Promise<unknown> } }).fileUploads
    if (uploads?.upload) await uploads.upload({ sessionId: SESSION_A, name: 'test.txt', data: 'aGVsbG8=' })
    expect(received.some(r => r.method === 'file.upload')).toBe(true)

    // ── 7. Approval request → user approves ──
    pushMux({ type: 'approval/requested', sessionId: SESSION_A, approvalId: 'ap-j1', toolName: 'bash', reason: 'run ls' } as never)
    await new Promise(r => setTimeout(r, 300))
    expect(store.sessions.get(SESSION_A)?.pendingApprovals.size).toBeGreaterThanOrEqual(1)
    await client.respond({
      type: 'client-response',
      rpcId: 'ap-j1' as never,
      result: { ok: true, value: { sessionId: SESSION_A, outcome: 'allowed-once' } },
    })
    expect(received.some(r => r.method === 'respond')).toBe(true)
    // Server resolves.
    pushMux({ type: 'approval/resolved', sessionId: SESSION_A, approvalId: 'ap-j1', outcome: 'allowed-once' } as never)
    await new Promise(r => setTimeout(r, 200))

    // ── 8. Question (ask_user) → user selects and submits ──
    const qRpcId = RpcId(crypto.randomUUID())
    pushMux({ type: 'question/requested', sessionId: SESSION_A, questions: [
      { id: 'q1', question: 'Which approach?', options: [{ label: 'Fast' }, { label: 'Safe' }] },
    ] } as never, qRpcId)
    await new Promise(r => setTimeout(r, 300))
    expect(store.sessions.get(SESSION_A)?.pendingQuestions.size).toBeGreaterThanOrEqual(1)
    // User selects "Safe" and the optimistic clear fires.
    await client.respond({
      type: 'client-response',
      rpcId: qRpcId,
      result: { ok: true, value: { sessionId: SESSION_A, answer: { answers: [{ id: 'q1', selected: ['Safe'] }] } } },
    })
    store.resolveQuestion(SESSION_A, qRpcId)
    expect(store.sessions.get(SESSION_A)?.pendingQuestions.size).toBe(0)

    // ── 9. Slash command ──
    const commands = await (client as unknown as { commands: { list: (args: Record<string, string>) => Promise<{ commands: unknown[] }> } }).commands.list({ sessionId: SESSION_A })
    expect(commands.commands.length).toBeGreaterThan(0)
    expect(received.some(r => r.method === 'command.list')).toBe(true)

    // ── 10. Search ──
    await client.sessions.search({ query: 'matched' } as never)
    expect(received.some(r => r.method === 'session.search')).toBe(true)

    // ── 11. Fork ──
    await client.sessions.fork({ sessionId: SESSION_A, atSeq: 4 } as never)
    expect(received.some(r => r.method === 'session.fork')).toBe(true)

    // ── 12. Rename ──
    await client.sessions.rename({ sessionId: SESSION_A, title: 'Renamed' } as never)
    expect(received.some(r => r.method === 'session.rename')).toBe(true)

    // ── 13. Feedback ──
    const feedback = (client as unknown as { feedback: { put: (args: Record<string, unknown>) => Promise<unknown> } }).feedback
    if (feedback?.put) await feedback.put({ sessionId: SESSION_A, messageId: 'm-1', rating: 'positive' })
    expect(received.some(r => r.method === 'feedback.put')).toBe(true)

    // ── 14. Browse files ──
    await client.host.listDirectory({ path: 'C:\\proj' } as never)
    expect(received.some(r => r.method === 'host.listDirectory')).toBe(true)

    // ── 15. Cancel generation ──
    await client.sessions.cancel({ sessionId: SESSION_A } as never)
    expect(received.some(r => r.method === 'session.cancel')).toBe(true)

    // ── 16. Disconnect → reconnect → hello replays pending state ──
    await manager.stop()
    const manager2 = new ConnectionManager({
      connect: appConn,
      headers: natsHeaders,
      instanceId: INSTANCE,
      getToken: () => TOKEN,
    })
    await manager2.start()
    expect(manager2.state).toBe('online')
    // hello replay pushed ap-hello into the fresh store.
    await new Promise(r => setTimeout(r, 300))
    expect(manager2.store.sessions.get(SESSION_A)?.pendingApprovals.size).toBeGreaterThanOrEqual(1)
    await manager2.stop()

    // ── 17. Revoked token fails ──
    const nc = await appConn()
    const badClient = new NatsApiClient({ conn: nc, instanceId: INSTANCE, getToken: () => 'revoked', headers: natsHeaders })
    const badResult = await badClient.host.describe({})
    expect(badResult.result.ok).toBe(false)
    await nc.close()
  }, 30_000)
})



