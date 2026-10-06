/** Builds the ConnectionManager against one saved profile, on nats.ws. */
import { connect, headers } from 'nats.ws'
import { ConnectionManager } from '@dsh-mobile/core'
import type { Profile } from './pairing-store'
import { activateHub } from './hub-tls'

/**
 * One manager per active profile.
 *
 * The profile is the whole connection: Hub address, leaf credentials, instance
 * namespace and device token. Switching profiles therefore means building a
 * new manager, which is what App.tsx does with this function.
 *
 * `deviceName` rides every `hello` (see ConnectionManager): the plugin's device
 * roster lists phones by the name they state, so renaming the phone here is
 * what makes the console readable.
 */
export function createManager(profile: Profile, deviceName: string): ConnectionManager {
  return new ConnectionManager({
    connect: async () => {
      // TLS is terminated by the OS WebSocket (wss://), so the certificate the
      // pairing QR carried has to be installed as the native anchor for this
      // host. The active host is global on Android (only its anchor is
      // consulted), so this belongs on every dial rather than once at boot:
      // otherwise switching to another self-hosted Hub fails its handshake
      // with no way for the user to tell why.
      await activateHub(profile.hub, profile.ca).catch((cause: unknown) => {
        console.warn('[hub-tls] anchor activation failed:', cause)
      })
      return connect({
        servers: profile.hub,
        user: profile.user,
        pass: profile.pass,
        debug: __DEV__,
      })
    },
    headers,
    instanceId: profile.instance,
    getToken: () => profile.token,
    deviceName,
    ...(profile.gatewayId === undefined ? {} : { gatewayId: profile.gatewayId }),
    ...(profile.eventKey === undefined ? {} : { eventKey: profile.eventKey }),
    ...(profile.installationId === undefined ? {} : { installationId: profile.installationId }),
  })
}
