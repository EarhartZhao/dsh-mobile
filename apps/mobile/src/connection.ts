/** Builds the ConnectionManager against the stored pairing, on nats.ws. */
import { connect, headers } from 'nats.ws'
import { ConnectionManager } from '@dsh-mobile/core'
import type { PairingRecord } from './pairing-store'

export function createManager(pairing: PairingRecord): ConnectionManager {
  return new ConnectionManager({
    // TLS is terminated by the OS WebSocket (wss://); the private CA is
    // pinned in the app build via networkSecurityConfig (docs/01).
    connect: () => connect({ servers: pairing.hub, user: pairing.user, pass: pairing.pass, debug: __DEV__ }),
    headers,
    instanceId: pairing.instance,
    getToken: () => pairing.token,
  })
}
