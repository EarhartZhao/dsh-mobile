/** Mobile-only reference discovery mapped by dsh-mobile-plugin to the current Remote. */
import { callMobileRemote } from './mobile-commands.ts'
import type { NatsConnLike, NatsHeadersFactory } from './nats-types.ts'

export interface MobileFileReference {
  path: string
  kind: 'file' | 'directory'
}

export interface MobileSessionReference {
  sessionId: string
  /** Session title, or the session id when no projection holds a title. */
  label: string
  /**
   * Presentation title a current host resolves for the row: a subagent's own
   * label wins over the session title. Added in dsh 0.1.6-alpha.2, so an older
   * host leaves it absent and the row falls back to `label`.
   */
  displayTitle?: string
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
