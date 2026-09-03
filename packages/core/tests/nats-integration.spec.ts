/**
 * End-to-end over a real nats-server: a fake plugin responder speaks the
 * documented wire contract (envelope bytes + token header + subject layout,
 * mirroring dsh-mobile-plugin/src/bridge.ts), and the real NatsApiClient +
 * ConnectionManager run against it. This is the "fake app" mirror of the
 * plugin's fake-app.ts — it validates our side of the contract without a
 * live harness.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect, headers as natsHeaders, type NatsConnection } from 'nats'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchMobileInfo, NatsApiClient, redeemPairingCode, TOKEN_HEADER } from '@dsh-mobile/protocol'
import { REQUIRED_PLUGIN_FEATURES } from '../src/compatibility.ts'
import { ConnectionManager } from '../src/connection-manager.ts'

const PORT = 16500 + Math.floor(Math.random() * 500)
const URL = `nats://127.0.0.1:${PORT}`
const INSTANCE = 'test-pc'
const VALID_TOKEN = 'test-token-123'
const NATS_SERVER_BIN = process.env.NATS_SERVER_BIN ?? 'C:\\nats-server\\nats-server.exe'
const describeNats = existsSync(NATS_SERVER_BIN) ? describe : describe.skip

let server: ChildProcess
let pluginSide: NatsConnection

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

function pushMuxFrame(frame: unknown): void {
  pluginSide.publish(
    `evt.dsh.${INSTANCE}.mux`,
    encoder.encode(JSON.stringify({ type: 'server-request', rpcId: crypto.randomUUID(), method: 'events.mux', payload: frame })),
  )
}

beforeAll(async () => {
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
          ? replyOk(body.rpcId, { token: VALID_TOKEN, deviceId: 'dev-1', expiresAt: new Date(Date.now() + 86400_000).toISOString() })
          : replyErr(body.rpcId, 'mobile-pair-failed'))
        continue
      }
      if (msg.headers?.get(TOKEN_HEADER) !== VALID_TOKEN) {
        msg.respond(replyErr(body.rpcId, 'mobile-unauthenticated'))
        continue
      }
      if (method === 'hello') {
        // Reconnect hook: replay the pending approval set.
        pushMuxFrame({ type: 'approval/requested', sessionId: 's-live', approvalId: 'ap-1', toolName: 'bash', reason: 'needs ok' })
        msg.respond(replyOk(body.rpcId, { ok: true }))
        continue
      }
      if (method === 'mobile.info') {
        msg.respond(replyOk(body.rpcId, {
          pluginVersion: '0.1.0',
          mobileApi: 1,
          features: [...REQUIRED_PLUGIN_FEATURES, 'health-check'],
        }))
        continue
      }
      if (method === 'mobile.health') {
        msg.respond(replyOk(body.rpcId, {
          status: 'ok', connection: 'connected', devices: 1,
          pluginVersion: '0.2.0', mobileApi: 1, features: [...REQUIRED_PLUGIN_FEATURES, 'health-check'],
          buildId: 'test-build', loadedFrom: 'C:\\test\\bridge.js', instanceId: INSTANCE,
          startedAt: new Date(0).toISOString(), uptimeMs: 1000,
          lastConnectedAt: new Date(0).toISOString(), lastReconnectAt: null, lastError: null,
        }))
        continue
      }
      switch (method) {
        case 'host.describe':
          msg.respond(replyOk(body.rpcId, { version: '0.1.1', cwd: 'C:\\dsh', attachedSessions: 0, home: 'C:\\dsh-home', canOpenPath: true }))
          break
        case 'workspace.list':
          msg.respond(replyOk(body.rpcId, { items: [], archivedSessionIds: [] }))
          break
        case 'session.list':
          msg.respond(replyOk(body.rpcId, { items: [] }))
          break
        case 'session.create':
          msg.respond(replyOk(body.rpcId, { sessionId: 's-new' }))
          break
        default:
          msg.respond(replyErr(body.rpcId, 'mobile-forbidden'))
      }
    }
  })()
  await pluginSide.flush()
}, 20000)

afterAll(async () => {
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
        msg.respond(replyOk(body.rpcId, { pluginVersion: '0.2.0' }))
      }
    })()
    await pluginSide.flush()

    const nc = await appConn()
    await expect(fetchMobileInfo(nc, natsHeaders, 'malformed-pc', VALID_TOKEN, 1_000)).rejects.toThrow('mobile-info-invalid')
    await responder
    await nc.close()
  })
})

describe('ConnectionManager', () => {
  it('runs the full establish pass: describe → baseline → hello replay → online', async () => {
    const manager = new ConnectionManager({
      connect: appConn,
      headers: natsHeaders,
      instanceId: INSTANCE,
      getToken: () => VALID_TOKEN,
    })
    await manager.start()
    expect(manager.state).toBe('online')
    expect(manager.hostInfo).toMatchObject({ version: '0.1.1' })
    expect(manager.health).toMatchObject({ status: 'ok', pluginVersion: '0.2.0', instanceId: INSTANCE })
    expect(manager.healthLatencyMs).toEqual(expect.any(Number))
    // hello replay delivered the pending approval into the store.
    await new Promise(r => setTimeout(r, 300))
    expect(manager.store.sessions.get('s-live')?.pendingApprovals.size).toBe(1)
    await manager.stop()
    expect(manager.state).toBe('stopped')
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
