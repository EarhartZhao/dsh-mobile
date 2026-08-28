/**
 * Local e2e rig: a fake dsh-mobile-plugin speaking the documented wire
 * contract over a local nats-server, so the Android app (emulator or device)
 * can complete pairing → describe → baseline → live frames without a real
 * harness. Run from packages/core (nats resolves from there):
 *
 *   nats-server -p 4333 -ws 8333 --user demo --pass demo
 *   node scripts/fake-host.mjs            # from packages/core
 *
 * App QR payload to paste on the pairing screen (emulator → host loopback):
 *   {"hub":"ws://10.0.2.2:8333","user":"demo","pass":"demo","instance":"demo","code":"GOOD-CODE"}
 */
import { connect } from 'nats'

const INSTANCE = process.env.DSH_FAKE_INSTANCE ?? 'demo'
const URL = process.env.DSH_FAKE_NATS ?? 'nats://127.0.0.1:4333'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const ok = (rpcId, value) => encoder.encode(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }))
const err = (rpcId, message) => encoder.encode(JSON.stringify({ type: 'server-response', rpcId, result: { ok: false, error: { code: 'internal', message, details: {} } } }))

const nc = await connect({ servers: URL, user: 'demo', pass: 'demo' })
console.log(`[fake-host] connected to ${URL}, instance=${INSTANCE}`)

process.on('unhandledRejection', e => console.error('[fake-host] unhandledRejection:', e))
process.on('uncaughtException', e => console.error('[fake-host] uncaughtException:', e))

void (async () => {
  for await (const s of nc.status()) console.log(`[fake-host] status: ${s.type}`)
})()

function pushMux(frame) {
  nc.publish(`evt.dsh.${INSTANCE}.mux`, encoder.encode(JSON.stringify({
    type: 'server-request', rpcId: crypto.randomUUID(), method: 'events.mux', payload: frame,
  })))
}

function pushHost(frame) {
  nc.publish(`evt.dsh.${INSTANCE}.host`, encoder.encode(JSON.stringify({
    type: 'server-request', rpcId: crypto.randomUUID(), method: 'events.host', payload: frame,
  })))
}

// The history fixture commits seq 1-4; live events continue from there (the
// host owns the sequence — the app drops live frames at or below the
// baseline watermark).
let seq = 4
function pushAssistant(text) {
  seq += 1
  pushMux({ type: 'session/event', sessionId: 's-demo', event: { seq, type: 'assistant/message', time: Date.now(), data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } } } })
}

const sub = nc.subscribe(`svc.dsh.${INSTANCE}.>`)
void (async () => {
  for await (const msg of sub) {
    const method = msg.subject.slice(`svc.dsh.${INSTANCE}.`.length)
    const body = JSON.parse(decoder.decode(msg.data))
    if (method === 'pair') {
      const good = body.payload?.code === 'GOOD-CODE'
      msg.respond(good ? ok(body.rpcId, { token: 'demo-token', deviceId: 'dev-demo', expiresAt: new Date(Date.now() + 86400_000).toISOString() }) : err(body.rpcId, 'mobile-pair-failed'))
      console.log(`[fake-host] pair ${good ? 'redeemed' : 'rejected'}`)
      continue
    }
    if (msg.headers?.get('x-dsh-token') !== 'demo-token') {
      msg.respond(err(body.rpcId, 'mobile-unauthenticated'))
      continue
    }
    if (method === 'hello') {
      // Reconnect hook: replay one pending approval.
      pushMux({ type: 'approval/requested', sessionId: 's-demo', approvalId: 'ap-1', toolName: 'bash', reason: '运行 npm test' })
      msg.respond(ok(body.rpcId, { ok: true }))
      continue
    }
    switch (method) {
      case 'host.describe':
        msg.respond(ok(body.rpcId, { version: '0.1.1-fake', cwd: 'C:\\dsh', attachedSessions: 1, home: 'C:\\dsh-home', canOpenPath: false }))
        break
      case 'workspace.list':
        msg.respond(ok(body.rpcId, { items: [{ workspaceId: 'w-1', path: 'C:\\code\\demo', title: 'demo 工作区', sessionIds: ['s-demo'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], archivedSessionIds: [] }))
        break
      case 'session.list':
        msg.respond(ok(body.rpcId, { items: [{ sessionId: 's-demo', updatedAt: Date.now(), running: false, blank: false, cwd: 'C:\\code\\demo' }] }))
        break
      case 'session.history':
        msg.respond(ok(body.rpcId, {
          events: [
            { event: { seq: 1, type: 'user/message', time: Date.now() - 60000, data: { message: { role: 'user', content: [{ type: 'text', text: '帮我看看这个项目' }] } } } },
            { event: { seq: 2, type: 'assistant/message', time: Date.now() - 55000, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '好的，我先看一下项目结构。' }] } } } },
            { event: { seq: 3, type: 'tool/call', time: Date.now() - 54000, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } } },
            { event: { seq: 4, type: 'tool/result', time: Date.now() - 53000, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'README.md\nsrc/\npackage.json' }] } } } },
          ],
          hasMore: false,
          projections: { asOfSeq: 4, values: { title: 'demo 会话' } },
        }))
        break
      case 'session.prompt': {
        msg.respond(ok(body.rpcId, { accepted: true }))
        const text = body.payload?.content?.[0]?.text ?? ''
        console.log(`[fake-host] prompt: ${text}`)
        seq += 1
        pushMux({ type: 'session/event', sessionId: 's-demo', event: { seq, type: 'user/message', time: Date.now(), data: { message: { role: 'user', content: [{ type: 'text', text }] } } } })
        // Stream a reply in chunks, then finalize — exercises the live path.
        const answer = `收到：「${text}」。这是来自 fake-host 的流式回复。`
        let i = 0
        const timer = setInterval(() => {
          i += 1
          seq += 1
          if (i <= answer.length) {
            pushMux({ type: 'session/event', sessionId: 's-demo', event: { seq, type: 'assistant/chunk', time: Date.now(), data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: answer[i - 1] } } } })
          } else {
            clearInterval(timer)
            seq += 1
            pushMux({ type: 'session/event', sessionId: 's-demo', event: { seq, type: 'assistant/message', time: Date.now(), data: { turn: 2, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: answer }] } } } })
            pushHost({ type: 'host/session-status', sessionId: 's-demo', running: false })
          }
        }, 80)
        pushHost({ type: 'host/session-status', sessionId: 's-demo', running: true })
        break
      }
      case 'respond': {
        const value = body.result?.value
        console.log(`[fake-host] respond: ${JSON.stringify(value)}`)
        if (value?.approvalId !== undefined) {
          pushMux({ type: 'approval/resolved', sessionId: 's-demo', approvalId: value.approvalId, outcome: value.outcome })
        } else if (body.rpcId !== undefined) {
          pushMux({ type: 'question/resolved', sessionId: 's-demo', questionRpcId: body.rpcId, outcome: 'answered' })
        }
        msg.respond(encoder.encode(JSON.stringify({ accepted: true })))
        break
      }
      default:
        msg.respond(err(body.rpcId, 'mobile-forbidden'))
    }
  }
})()
await nc.flush()
console.log('[fake-host] serving')
