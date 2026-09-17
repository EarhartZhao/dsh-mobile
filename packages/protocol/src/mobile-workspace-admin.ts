/**
 * Mobile-only Workspace administration face.
 *
 * The frozen mobile wire predates `workspace/unarchiveSession` (added in dsh
 * 0.1.6), so restoring an archived Session needs its own method here. The bridge
 * whitelists it as `workspace-unarchive`; hosts without that mapping answer
 * `mobile-forbidden`, which is why callers gate the affordance on the feature.
 */
import { callMobileRemote } from './mobile-commands.ts'
import type { NatsConnLike, NatsHeadersFactory } from './nats-types.ts'

/** Complete archive set after one restore, mirroring `WorkspaceArchiveValue`. */
export interface MobileArchiveValue {
  archivedSessionIds: string[]
}

export interface MobileWorkspaceAdmin {
  /** Restore one archived Session to the visible Workspace grouping. */
  unarchiveSession(payload: { sessionId: string }): Promise<MobileArchiveValue>
}

export function createMobileWorkspaceAdmin(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  getToken: () => string | undefined,
): MobileWorkspaceAdmin {
  return {
    async unarchiveSession(payload) {
      const token = getToken()
      if (token === undefined) throw new Error('connection not ready')
      return callMobileRemote<MobileArchiveValue>(
        conn, headersFactory, instanceId, 'workspace.unarchiveSession', payload, token, 20_000,
      )
    },
  }
}
