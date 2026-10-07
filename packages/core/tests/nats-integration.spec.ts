/**
 * End-to-end over a real nats-server: a fake plugin responder speaks the
 * documented wire contract (envelope bytes + token header + subject layout,
 * mirroring dsh-mobile-plugin/src/bridge.ts), and the real NatsApiClient +
 * ConnectionManager run against it. This is the "fake app" mirror of the
 * plugin's fake-app.ts — it validates our side of the contract without a
 * live harness.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { connect, headers as natsHeaders, type NatsConnection } from 'nats'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchMobileInfo, NatsApiClient, redeemPairingCode, TOKEN_HEADER } from '@dsh-mobile/protocol'
import { REQUIRED_PLUGIN_FEATURES } from '../src/compatibility.ts'
import { ConnectionManager } from '../src/connection-manager.ts'

const PORT = 16500 + Math.floor(Math.random() * 500)
const URL = `nats://127.0.0.1:${PORT}`
const INSTANCE = 'test-pc'
const VALID_TOKEN = 'test-token-123'
const NATS_SERVER_BIN = process.env.NATS_SERVER_BIN
  ?? (process.platform === 'win32' ? 'C:\\nats-server\\nats-server.exe' : 'nats-server')
const HAS_NATS = spawnSync(NATS_SERVER_BIN, ['-v'], { stdio: 'ignore' }).status === 0
const describeNats = HAS_NATS
  ? describe
  : describe.skip

let server: ChildProcess
let pluginSide: NatsConnection
/** Bridge generation the fake plugin reports; the heartbeat test flips it. */
let bridgeStartedAt = new Date(0).toISOString()
let helloCount = 0
/**
 * List baseline the fake bridge serves. Empty by default so the other cases see
 * a bare host; the invalidation test mutates it (and counts the pulls) to prove
 * the App re-reads the authoritative list.
 */
let listBaseline: { workspaces: unknown[], archivedSessionIds: string[] } = { workspaces: [], archivedSessionIds: [] }
let workspaceListCalls = 0

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function replyOk(rpcId: string, value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }))
}

function replyErr(rpcId: string, message: string): Uint8Array {
  return encoder.encode(JSON.stringify({
    type: 'server-response', rpcId,
    result: { ok: false, error: { code: 'internal', message, details: {} } },
  }))
}

function pushMuxFrame(frame: unknown, eventKey?: string): void {
  pluginSide.publish(
    eventKey === undefined ? `evt.dsh.${INSTANCE}.mux` : `evt.dsh.${INSTANCE}.${eventKey}.mux`,
    encoder.encode(JSON.stringify({ type: 'server-request', rpcId: crypto.randomUUID(), method: 'events.mux', payload: frame })),
  )
}

/** Host-domain frames ride their own subject and schema. */
function pushHostFrame(frame: unknown): void {
  pluginSide.publish(
    `evt.dsh.${INSTANCE}.host`,
    encoder.encode(JSON.stringify({ type: 'server-request', rpcId: crypto.randomUUID(), method: 'events.host', payload: frame })),
  )
}

beforeAll(async () => {
  if (!HAS_NATS) return

  server = spawn(NATS_SERVER_BIN, ['-p', String(PORT)], { stdio: 'ignore' })
  await new Promise(r => setTimeout(r, 1500))
  pluginSide = await connect({ servers: URL })

  // Fake plugin: token gate + whitelist + pair, exactly the bridge's shape.
  const sub = pluginSide.subscribe(`svc.dsh.${INSTANCE}.>`)
  void (async () => {
    for await (const msg of sub) {
      const method = msg.subject.slice(`svc.dsh.${INSTANCE}.`.length)
      const body = JSON.parse(decoder.decode(msg.data)) as { rpcId: string; payload?: Record<string, unknown> }
      if (method === 'pair') {
        const ok = body.payload?.['code'] === 'GOOD-CODE'
        msg.respond(ok
          ? replyOk(body.rpcId, {
              token: VALID_TOKEN,
              deviceId: 'dev-1',
              expiresAt: new Date(Date.now() + 86400_000).toISOString(),
              eventKey: 'device-event-key',
            })
          : replyErr(body.rpcId, 'mobile-pair-failed'))
        continue
      }
      if (msg.headers?.get(TOKEN_HEADER) !== VALID_TOKEN) {
        msg.respond(replyErr(body.rpcId, 'mobile-unauthenticated'))
        continue
      }
      if (method === 'hello') {
        // Reconnect hook: replay the pending approval set.
        helloCount += 1
        pushMuxFrame({ type: 'approval/requested', sessionId: 's-live', approvalId: 'ap-1', toolName: 'bash', reason: 'needs ok' })
        msg.respond(replyOk(body.rpcId, { ok: true }))
        continue
      }
      if (method === 'mobile.info') {
        msg.respond(replyOk(body.rpcId, {
          pluginVersion: '0.2.2',
          mobileApi: 2,
          features: [...REQUIRED_PLUGIN_FEATURES, 'health-check'],
        }))
        continue
      }
      if (method === 'mobile.health') {
        msg.respond(replyOk(body.rpcId, {
          status: 'ok', connection: 'connected', devices: 1,
          pluginVersion: '0.2.2', mobileApi: 2, features: [...REQUIRED_PLUGIN_FEATURES, 'health-check'],
          buildId: 'test-build', loadedFrom: 'C:\\test\\bridge.js', instanceId: INSTANCE,
          startedAt: bridgeStartedAt, uptimeMs: 1000,
          lastConnectedAt: new Date(0).toISOString(), lastReconnectAt: null, lastError: null,
        }))
        continue
      }
      switch (method) {
        case 'host.describe':
          msg.respond(replyOk(body.rpcId, { version: '0.1.1', cwd: 'C:\\dsh', attachedSessions: 0, home: 'C:\\dsh-home', canOpenPath: true }))
          break
        case 'workspace.list':
          workspaceListCalls += 1
          msg.respond(replyOk(body.rpcId, { items: listBaseline.workspaces, archivedSessionIds: listBaseline.archivedSessionIds }))
          break
        case 'session.list':
          msg.respond(replyOk(body.rpcId, { items: [] }))
          break
        case 'session.create':
          msg.respond(replyOk(body.rpcId, { sessionId: 's-new' }))
          break
        case 'reference.files':
          msg.respond(replyOk(body.rpcId, [{ path: 'src/index.ts', kind: 'file' }]))
          break
        case 'reference.sessions':
          msg.respond(replyOk(body.rpcId, [{
            sessionId: 's-source', label: 'Research', sameWorkspace: true,
            createdAt: 1, mention: '@[Research](dsh-session:c291cmNl)',
          }]))
          break
        default:
          msg.respond(replyErr(body.rpcId, 'mobile-forbidden'))
      }
    }
  })()
  await pluginSide.flush()
}, 20000)

afterAll(async () => {
  if (!HAS_NATS) return

  await pluginSide?.drain()
  server?.kill()
})

async function appConn(): Promise<NatsConnection> {
  return connect({ servers: URL })
}

describeNats('NatsApiClient over real NATS', () => {
  it('redeems a pairing code and rejects a bad one', async () => {
    const nc = await appConn()
    const device = await redeemPairingCode(nc, natsHeaders, INSTANCE, 'GOOD-CODE', 'vitest')
    expect(device.token).toBe(VALID_TOKEN)
    await expect(redeemPairingCode(nc, natsHeaders, INSTANCE, 'WRONG', 'vitest')).rejects.toThrow('mobile-pair-failed')
    await nc.close()
  })

  it('unary calls map to subjects and carry the token header', async () => {
    const nc = await appConn()
    const client = new NatsApiClient({ conn: nc, instanceId: INSTANCE, getToken: () => VALID_TOKEN, headers: natsHeaders })
    const describe = await client.host.describe({})
    expect(describe.result.ok && describe.result.value.version).toBe('0.1.1')
    const created = await client.sessions.create({} as never)
    expect(created.result.ok).toBe(true)
    await nc.close()
  })

  it('discovers canonical file and session references through the bridge', async () => {
    const nc = await appConn()
    const client = new NatsApiClient({ conn: nc, instanceId: INSTANCE, getToken: () => VALID_TOKEN, headers: natsHeaders })
    await expect(client.references.files({ sessionId: 's-live', query: 'src' })).resolves.toEqual([
      { path: 'src/index.ts', kind: 'file' },
    ])
    await expect(client.references.sessions({ sessionId: 's-live', query: 'res' })).resolves.toEqual([
      {
        sessionId: 's-source', label: 'Research', sameWorkspace: true,
        createdAt: 1, mention: '@[Research](dsh-session:c291cmNl)',
      },
    ])
    await nc.close()
  })

  it('gate rejects calls without a valid token', async () => {
    const nc = await appConn()
    const client = new NatsApiClient({ conn: nc, instanceId: INSTANCE, getToken: () => undefined, headers: natsHeaders })
    const result = await client.host.describe({})
    expect(result.result.ok).toBe(false)
    if (!result.result.ok) expect(result.result.error.message).toBe('mobile-unauthenticated')
    await nc.close()
  })

  it('stream subscription receives parsed mux frames', async () => {
    const nc = await appConn()
    const client = new NatsApiClient({ conn: nc, instanceId: INSTANCE, getToken: () => VALID_TOKEN, headers: natsHeaders })
    const abort = new AbortController()
    const frames: unknown[] = []
    const stream = client.events.mux({}, abort.signal)
    const reader = (async () => {
      for await (const frame of stream) {
        frames.push(frame.payload)
        if (frames.length >= 1) break
      }
    })()
    // Give the subscription a beat to register, then publish.
    await new Promise(r => setTimeout(r, 300))
    pushMuxFrame({ type: 'session/subscribed', sessionId: 's-live', lastSeq: 0 })
    await reader
    abort.abort()
    expect(frames[0]).toMatchObject({ type: 'session/subscribed', sessionId: 's-live' })
    await nc.close()
  })

  it('subscribes to a device-scoped event subject when pairing returned an event key', async () => {
    const nc = await appConn()
    const client = new NatsApiClient({
      conn: nc,
      instanceId: INSTANCE,
      getToken: () => VALID_TOKEN,
      headers: natsHeaders,
      eventKey: 'device-event-key',
    })
    const abort = new AbortController()
    const frames: unknown[] = []
    const stream = client.events.mux({}, abort.signal)
    const reader = (async () => {
      for await (const frame of stream) {
        frames.push(frame.payload)
        if (frames.length >= 1) break
      }
    })()
    await new Promise(r => setTimeout(r, 300))
    pushMuxFrame({ type: 'session/subscribed', sessionId: 's-live', lastSeq: 0 }, 'device-event-key')
    await reader
    abort.abort()
    expect(frames[0]).toMatchObject({ type: 'session/subscribed', sessionId: 's-live' })
    await nc.close()
  })

  it('keeps a question frame whose intent the frozen schema does not know', async () => {
    const nc = await appConn()
    const client = new NatsApiClient({ conn: nc, instanceId: INSTANCE, getToken: () => VALID_TOKEN, headers: natsHeaders })
    const abort = new AbortController()
    const frames: unknown[] = []
    const stream = client.events.mux({}, abort.signal)
    const reader = (async () => {
      for await (const frame of stream) {
        frames.push(frame.payload)
        if (frames.length >= 1) break
      }
    })()
    await new Promise(r => setTimeout(r, 300))
    // The vendor schema models `intent` as a strict one-arm union, so without the
    // wide re-read this frame is dropped whole: the user waits on a question that
    // never appears and nothing explains why.
    pushMuxFrame({
      type: 'question/requested',
      sessionId: 's-live',
      questions: [{
        id: 'scope',
        question: 'Which surface?',
        options: [{ label: 'A' }, { label: 'B' }],
        intent: { kind: 'diff-review', paths: ['a.ts'] },
      }],
    })
    await reader
    abort.abort()

    expect(frames[0]).toMatchObject({
      type: 'question/requested',
      sessionId: 's-live',
      questions: [{ id: 'scope', question: 'Which surface?', intent: { kind: 'diff-review', paths: ['a.ts'] } }],
    })
    await nc.close()
  })

  it('does not misreport an offline bridge as an unknown plugin version', async () => {
    const nc = await appConn()
    await expect(fetchMobileInfo(nc, natsHeaders, 'offline-pc', VALID_TOKEN, 200)).rejects.toThrow()
    await nc.close()
  })

  it('treats an explicit mobile.info rejection as a legacy plugin', async () => {
    const sub = pluginSide.subscribe('svc.dsh.legacy-pc.mobile.info', { max: 1 })
    const responder = (async () => {
      for await (const msg of sub) {
        const body = JSON.parse(decoder.decode(msg.data)) as { rpcId: string }
        msg.respond(replyErr(body.rpcId, 'mobile-forbidden'))
      }
    })()
    await pluginSide.flush()

    const nc = await appConn()
    await expect(fetchMobileInfo(nc, natsHeaders, 'legacy-pc', VALID_TOKEN, 1_000)).resolves.toBeNull()
    await responder
    await nc.close()
  })

  it('keeps a malformed mobile.info response as a protocol error', async () => {
    const sub = pluginSide.subscribe('svc.dsh.malformed-pc.mobile.info', { max: 1 })
    const responder = (async () => {
      for await (const msg of sub) {
        const body = JSON.parse(decoder.decode(msg.data)) as { rpcId: string }
        msg.respond(replyOk(body.rpcId, { pluginVersion: '0.2.2' }))
      }
    })()
    await pluginSide.flush()

    const nc = await appConn()
    await expect(fetchMobileInfo(nc, natsHeaders, 'malformed-pc', VALID_TOKEN, 1_000)).rejects.toThrow('mobile-info-invalid')
    await responder
    await nc.close()
  })
})

describeNats('ConnectionManager', () => {
  it('runs the full establish pass: describe → baseline → hello replay → online', async () => {
    const established: { generation: number }[] = []
    const manager = new ConnectionManager({
      connect: appConn,
      headers: natsHeaders,
      instanceId: INSTANCE,
      getToken: () => VALID_TOKEN,
    })
    manager.on('established', payload => established.push(payload))
    await manager.start()
    expect(manager.state).toBe('online')
    // Screens heal from this signal: one pass, one notification.
    expect(established).toHaveLength(1)
    expect(manager.hostInfo).toMatchObject({ version: '0.1.1' })
    expect(manager.health).toMatchObject({ status: 'ok', pluginVersion: '0.2.2', instanceId: INSTANCE })
    expect(manager.healthLatencyMs).toEqual(expect.any(Number))
    // hello replay delivered the pending approval into the store.
    await new Promise(r => setTimeout(r, 300))
    expect(manager.store.sessions.get('s-live')?.pendingApprovals.size).toBe(1)
    await manager.stop()
    expect(manager.state).toBe('stopped')
  })

  it('re-pulls the list baseline when another client changes the host', async () => {
    const manager = new ConnectionManager({
      connect: appConn,
      headers: natsHeaders,
      instanceId: INSTANCE,
      getToken: () => VALID_TOKEN,
    })
    await manager.start()
    expect(manager.state).toBe('online')
    const pullsBefore = workspaceListCalls

    // The desktop creates a chat inside a workspace. The frame that reaches the
    // phone names no workspace at all — `sessionIds` lives on the workspace view —
    // so patching it in place would file the row under 未分组 forever. Re-pulling
    // the authoritative baseline is what puts it where it belongs.
    listBaseline = {
      workspaces: [{
        workspaceId: 'ws-learn',
        path: 'C:\\dsh\\learner',
        title: 'learner',
        sessionIds: ['s-new'],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }],
      archivedSessionIds: [],
    }
    pushHostFrame({ type: 'host/session-added', sessionId: 's-new', blank: false })

    const deadline = Date.now() + 5_000
    while (!manager.store.workspaces.some(workspace => workspace.workspaceId === 'ws-learn') && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50))
    }
    expect(manager.store.workspaces).toMatchObject([{ workspaceId: 'ws-learn', sessionIds: ['s-new'] }])
    expect(workspaceListCalls).toBeGreaterThan(pullsBefore)

    await manager.stop()
    listBaseline = { workspaces: [], archivedSessionIds: [] }
  })

  it('refreshes the baseline only when the caller says it may be stale', async () => {
    const manager = new ConnectionManager({
      connect: appConn,
      headers: natsHeaders,
      instanceId: INSTANCE,
      getToken: () => VALID_TOKEN,
    })
    await manager.start()
    const pullsBefore = workspaceListCalls

    // A baseline that just landed is trusted: switching screens must not re-pull.
    await manager.refreshBaselineIfStale(60_000)
    expect(workspaceListCalls).toBe(pullsBefore)

    // The caller naming "no age is trustworthy" is how the app asks on returning
    // to the foreground after a long gap.
    await manager.refreshBaselineIfStale(0)
    expect(workspaceListCalls).toBeGreaterThan(pullsBefore)
    await manager.stop()
  })

  it('re-establishes when the bridge restarts under a live connection', async () => {
    const manager = new ConnectionManager({
      connect: appConn,
      headers: natsHeaders,
      instanceId: INSTANCE,
      getToken: () => VALID_TOKEN,
      bridgeProbeMs: 60,
    })
    await manager.start()
    expect(manager.state).toBe('online')
    const hellosBefore = helloCount

    // The same NATS connection stays up while the bridge process is replaced.
    bridgeStartedAt = new Date(60_000).toISOString()
    const deadline = Date.now() + 5_000
    while (helloCount === hellosBefore && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50))
    }
    expect(helloCount).toBeGreaterThan(hellosBefore)
    expect(manager.state).toBe('online')
    expect(manager.health).toMatchObject({ startedAt: bridgeStartedAt })
    await manager.stop()
  })

  it('never reaches online without a token (keeps retrying in background)', async () => {
    const manager = new ConnectionManager({
      connect: appConn,
      headers: natsHeaders,
      instanceId: INSTANCE,
      getToken: () => undefined,
    })
    await manager.start()
    expect(manager.state).not.toBe('online')
    await manager.stop()
    expect(manager.state).toBe('stopped')
  })
})
