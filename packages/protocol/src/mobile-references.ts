/** Mobile-only reference discovery mapped by dsh-mobile-plugin to alpha.5 Remote. */
import { callMobileRemote } from './mobile-commands.ts'
import type { NatsConnLike, NatsHeadersFactory } from './nats-types.ts'

export interface MobileFileReference {
  path: string
  kind: 'file' | 'directory'
}

export interface MobileSessionReference {
  sessionId: string
  label: string
  cwd?: string
  sameWorkspace: boolean
  createdAt: number
  mention: string
}

export function createMobileReferences(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  getToken: () => string | undefined,
): {
  files(payload: { sessionId: string; query: string }): Promise<MobileFileReference[]>
  sessions(payload: { sessionId: string; query: string }): Promise<MobileSessionReference[]>
} {
  return {
    async files(payload) {
      const token = getToken()
      if (token === undefined) throw new Error('connection not ready')
      return callMobileRemote(conn, headersFactory, instanceId, 'reference.files', payload, token, 10_000)
    },
    async sessions(payload) {
      const token = getToken()
      if (token === undefined) throw new Error('connection not ready')
      return callMobileRemote(conn, headersFactory, instanceId, 'reference.sessions', payload, token, 10_000)
    },
  }
}
