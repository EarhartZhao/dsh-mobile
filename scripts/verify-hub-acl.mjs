/** One-shot ACL verification for the Hub's c-end-dsh account (docs/02 §3). */
import { connect } from 'nats'

const nc = await connect({
  servers: 'nats://115.159.57.137:4222',
  user: 'c-end-dsh',
  pass: process.env.DSH_CEND_PASS,
  timeout: 10000,
})

const errors = []
const closed = nc.closed()
void closed.catch(() => undefined)
;(async () => {
  for await (const err of nc.status()) {
    if (err.type === 'error') errors.push(String(err.data ?? err.error ?? ''))
  }
})()
nc.onerror = (e) => errors.push(e.message)

// Permission violations arrive as async -ERR; give them a moment to land.
nc.subscribe('svc.dsh.home.>')              // expect: denied
nc.publish('evt.dsh.home.acl-probe', 'x')   // expect: denied
nc.subscribe('evt.dsh.home.>')              // expect: allowed
await new Promise(r => setTimeout(r, 3000))

const text = errors.join('\n')
console.log('--- async errors ---')
console.log(text || '(none)')
console.log('sub svc.dsh.> denied:', /Permissions Violation.*subscription/i.test(text) || /subscription.*svc\.dsh/i.test(text))
console.log('pub evt.dsh.> denied:', /Permissions Violation.*publish/i.test(text) || /publish.*evt\.dsh/i.test(text))
await nc.close()
