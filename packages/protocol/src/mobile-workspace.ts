/** Mobile-only workspace file reads and live goal state.
 *
 * Both faces come from dsh 0.1.5 Remote owners — `workspaceFiles` for bounded
 * file reads and directory listings, `goals/get` for the process-local
 * activation the durable goal projection deliberately omits. The bridge
 * whitelists the mobile method names; hosts without them answer
 * `mobile-forbidden`, so callers gate on the plugin feature list.
 */
import { callMobileRemote } from './mobile-commands.ts'
import type { NatsConnLike, NatsHeadersFactory } from './nats-types.ts'

/** One direct child of a listed workspace directory. */
export interface MobileDirectoryEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

/** Direct children of one workspace directory, workspace-relative. */
export interface MobileDirectoryListing {
  /** Listed directory as a workspace path; empty for the workspace root. */
  path: string
  entries: MobileDirectoryEntry[]
  /** Whether the host's entry cap dropped children from `entries`. */
  truncated: boolean
}

/** One page of a workspace text file. */
export interface MobileFileText {
  absolutePath: string
  version: string
  bytes?: number
  offset: number
  text: string
  lines: number
  eof: boolean
}

/** One byte window of a workspace file, base64 in `data`. */
export interface MobileFileBytes {
  absolutePath: string
  version: string
  bytes?: number
  offset: number
  data: string
  eof: boolean
}

/** The live goal of one Session, including its process-local activation. */
export interface MobileGoalView {
  id: string
  revision: number
  objective: string
  phase: 'active' | 'paused' | 'blocked' | 'complete'
  /** Whether this process may automatically continue the goal. */
  activation: 'armed' | 'disarmed'
  maxGoalRounds: number
  roundsStarted: number
}

export interface MobileFiles {
  list(payload: { sessionId: string; path?: string }): Promise<MobileDirectoryListing>
  read(payload: { sessionId: string; path: string; offset?: number; limit?: number }): Promise<MobileFileText>
  bytes(payload: { sessionId: string; path: string; offset?: number; length?: number }): Promise<MobileFileBytes>
  /** Reads one path relative to another file's directory (Markdown references). */
  related(payload: { sessionId: string; path: string; relativePath: string }): Promise<MobileFileBytes>
  /**
   * Arms the host's workspace file-change stream for one Session. Changes arrive
   * later as `workspace-files/change` forwarded events; the call itself is a
   * cheap idempotent registration.
   */
  watch(payload: { sessionId: string }): Promise<{ watching: true }>
  /** Select one path in the host's file manager (Explorer / Finder). */
  reveal(payload: { sessionId: string; path: string }): Promise<{ opened: true }>
}

export interface MobileGoalState {
  /** Current goal of one Session, or null when it has none. */
  get(payload: { sessionId: string }): Promise<MobileGoalView | null>
}

export function createMobileFiles(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  getToken: () => string | undefined,
): MobileFiles {
  const call = async <T>(method: string, payload: unknown, timeoutMs: number): Promise<T> => {
    const token = getToken()
    if (token === undefined) throw new Error('connection not ready')
    return callMobileRemote<T>(conn, headersFactory, instanceId, method, payload, token, timeoutMs)
  }
  return {
    // Text pages and directory listings are bounded by the host's caps, so the
    // wire timeout only has to cover one round trip.
    list: payload => call('file.list', payload, 20_000),
    read: payload => call('file.read', payload, 20_000),
    bytes: payload => call('file.bytes', payload, 30_000),
    related: payload => call('file.related', payload, 30_000),
    watch: payload => call('file.watch', payload, 20_000),
    reveal: payload => call('file.reveal', payload, 20_000),
  }
}

export function createMobileGoalState(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  getToken: () => string | undefined,
): MobileGoalState {
  return {
    async get(payload) {
      const token = getToken()
      if (token === undefined) throw new Error('connection not ready')
      // An absent goal arrives as a missing value, not as JSON null.
      const value = await callMobileRemote<MobileGoalView | null | undefined>(
        conn, headersFactory, instanceId, 'goal.get', payload, token, 20_000,
      )
      return value ?? null
    },
  }
}
