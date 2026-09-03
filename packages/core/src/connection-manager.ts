/**
 * Connection lifecycle: connect → describe handshake → baseline refetch →
 * subscribe both event streams → hello (pending-frame replay) → online.
 * Reconnect follows the documented generation semantics (docs/02): any
 * transport bounce aborts the stream loops, and the next connected state
 * re-runs the full baseline — frames are fire-and-forget, baselines are
 * authoritative.
 */
import {
  NatsApiClient,
  sendHello,
  fetchMobileInfo,
  fetchMobileHealth,
  fetchMobileInventory,
  type HostFrame,
  type MuxFrame,
  type NatsConnLike,
  type NatsHeadersFactory,
  type RpcId,
  type MobileInventorySnapshot,
  type MobileHealthSnapshot,
} from '@dsh-mobile/protocol'
import { Emitter } from './emitter.ts'
import { SessionStore } from './session-store.ts'
import { checkMobileCompatibility, type CompatibilityResult } from './compatibility.ts'

export type ConnectionState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'stopped' | 'incompatible'
export type ConnectionFailureKind = 'bridge-unavailable' | 'authentication' | 'tls' | 'network' | 'protocol' | 'unknown'

/** Classifies transport/RPC text without coupling the core package to UI copy. */
export function classifyConnectionFailure(message: string): ConnectionFailureKind {
  const text = message.toLowerCase()
  if (text.includes('mobile-unauthenticated') || text.includes('authorization') || text.includes('authentication')) return 'authentication'
  if (text.includes('certificate') || text.includes('tls') || text.includes('ssl')) return 'tls'
  if (text.includes('no responders') || text.includes('503') || text.includes('timeout')) return 'bridge-unavailable'
  if (text.includes('mobile-info-invalid') || text.includes('mobile-health-invalid') || text.includes('parse') || text.includes('json') || text.includes('zod')) return 'protocol'
  if (text.includes('network') || text.includes('socket') || text.includes('connection refused') || text.includes('dns')) return 'network'
  return 'unknown'
}

/** Optional status stream both nats flavors expose (`conn.status()`). */
interface StatusfulConn extends NatsConnLike {
  status(): AsyncIterable<{ type: string }>
}

function hasStatus(conn: NatsConnLike): conn is StatusfulConn {
  return typeof (conn as StatusfulConn).status === 'function'
}

type ManagerEvents = {
  state: { state: ConnectionState }
  hostInfo: { info: unknown }
  compatibility: { result: import('./compatibility.ts').CompatibilityResult }
  error: { message: string, kind: ConnectionFailureKind }
  health: { snapshot: MobileHealthSnapshot | null, latencyMs: number | null, error: string | null }
}

export interface ConnectionManagerOptions {
  /** Establishes the NATS transport (nats.ws connect in the app, nats in tests). */
  connect: () => Promise<NatsConnLike>
  headers: NatsHeadersFactory
  instanceId: string
  getToken: () => string | undefined
  store?: SessionStore
}

export class ConnectionManager extends Emitter<ManagerEvents> {
  readonly store: SessionStore
  state: ConnectionState = 'idle'
  client: NatsApiClient | null = null
  hostInfo: unknown = null
  compatibility: CompatibilityResult | null = null
  health: MobileHealthSnapshot | null = null
  healthLatencyMs: number | null = null
  healthError: string | null = null
  lastOnlineAt: string | null = null

  private conn: NatsConnLike | null = null
  private generation = 0
  private streamAbort: AbortController | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: ConnectionManagerOptions) {
    super()
    this.store = options.store ?? new SessionStore()
  }

  async start(): Promise<void> {
    if (this.state === 'online' || this.state === 'connecting') return
    this.setState('connecting')
    try {
      this.conn = await this.options.connect()
    } catch (error) {
      this.setState('reconnecting')
      this.emitError(error)
      this.scheduleRetry(() => { void this.start().catch(() => undefined) })
      return
    }
    this.client = new NatsApiClient({
      conn: this.conn,
      instanceId: this.options.instanceId,
      getToken: this.options.getToken,
      headers: this.options.headers,
    })
    if (hasStatus(this.conn)) void this.watchStatus(this.conn, ++this.generation)
    try {
      await this.establish()
    } catch (error) {
      this.setState('reconnecting')
      this.emitError(error)
      this.scheduleRetry(() => { void this.retryEstablish(this.generation) })
    }
  }

  async stop(): Promise<void> {
    this.generation++
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.streamAbort?.abort()
    this.streamAbort = null
    const conn = this.conn
    this.conn = null
    this.client = null
    this.setState('stopped')
    if (conn !== null) await conn.close().catch(() => undefined)
  }

  /** Refreshes list/workspace metadata after mutations that don't emit a mergeable session event. */
  async refreshBaseline(): Promise<void> {
    const client = this.client
    if (client === null || this.state !== 'online') return
    const [workspaces, sessions] = await Promise.all([
      client.workspace.list({}),
      client.sessions.list({}),
    ])
    if (workspaces.result.ok && sessions.result.ok) {
      this.store.applyBaseline({
        workspaces: workspaces.result.value.items,
        archivedSessionIds: workspaces.result.value.archivedSessionIds,
        summaries: sessions.result.value.items,
      })
    }
  }

  /** Loads the optional plugin inventory when the connected bridge advertises it. */
  async loadInventory(): Promise<MobileInventorySnapshot | null> {
    if (this.conn === null || this.state !== 'online') return null
    const token = this.options.getToken()
    if (token === undefined) return null
    return fetchMobileInventory(this.conn, this.options.headers, this.options.instanceId, token)
  }

  /** Runs the authenticated bridge health check and records its latency. */
  async probeHealth(): Promise<MobileHealthSnapshot | null> {
    if (this.conn === null) throw new Error('connection not ready')
    const token = this.options.getToken()
    if (token === undefined) throw new Error('mobile-unauthenticated')
    const started = Date.now()
    try {
      const snapshot = await fetchMobileHealth(this.conn, this.options.headers, this.options.instanceId, token)
      this.health = snapshot
      this.healthLatencyMs = Date.now() - started
      this.healthError = null
      this.emit('health', { snapshot, latencyMs: this.healthLatencyMs, error: null })
      return snapshot
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.health = null
      this.healthLatencyMs = null
      this.healthError = message
      this.emit('health', { snapshot: null, latencyMs: null, error: message })
      this.emitError(error)
      throw error
    }
  }

  /**
   * One full "become online" pass; also the reconnect-baseline path. Order
   * matters: baselines land before hello so replayed pending frames update
   * fresh state, and subscriptions exist before hello asks for the replay.
   */
  private async establish(): Promise<void> {
    const client = this.client
    const token = this.options.getToken()
    if (client === null || token === undefined) throw new Error('connection not ready')

    const mobileInfo = await fetchMobileInfo(this.conn!, this.options.headers, this.options.instanceId, token)
    this.compatibility = checkMobileCompatibility(mobileInfo)
    this.emit('compatibility', { result: this.compatibility })
    if (this.compatibility.status !== 'compatible') {
      this.setState('incompatible')
      return
    }

    if (this.compatibility.features.includes('health-check')) {
      await this.probeHealth().catch(() => undefined)
    } else {
      this.health = null
      this.healthLatencyMs = null
      this.healthError = null
    }

    const describe = await client.host.describe({})
    if (!describe.result.ok) throw new Error(`host.describe failed: ${describe.result.error.message}`)
    this.hostInfo = describe.result.value
    this.emit('hostInfo', { info: describe.result.value })

    this.streamAbort?.abort()
    const abort = new AbortController()
    this.streamAbort = abort
    const generation = this.generation
    // Subscriptions must be registered before hello, or the replayed pending
    // frames publish into the void. onOpen fires post-flush (docs/02 lifecycle).
    const muxOpen = this.trackOpen()
    const hostOpen = this.trackOpen()
    this.pump(client.events.mux({}, abort.signal, muxOpen.resolve), frame => this.store.applyMuxFrame(frame.rpcId, frame.payload))
    this.pump(client.events.host({}, abort.signal, hostOpen.resolve), frame => this.store.applyHostFrame(frame.payload))

    const [workspaces, sessions] = await Promise.all([
      client.workspace.list({}),
      client.sessions.list({}),
    ])
    if (this.generation !== generation) return // superseded mid-baseline
    if (workspaces.result.ok && sessions.result.ok) {
      this.store.applyBaseline({
        workspaces: workspaces.result.value.items,
        archivedSessionIds: workspaces.result.value.archivedSessionIds,
        summaries: sessions.result.value.items,
      })
    }

    await Promise.all([muxOpen.waited, hostOpen.waited])
    await sendHello(this.conn!, this.options.headers, this.options.instanceId, token)
    this.lastOnlineAt = new Date().toISOString()
    this.setState('online')
  }

  private trackOpen(): { waited: Promise<void>; resolve: () => void } {
    let resolve!: () => void
    const waited = new Promise<void>(r => { resolve = r })
    return { waited, resolve }
  }

  private pump<F extends MuxFrame | HostFrame>(
    stream: AsyncIterable<{ rpcId: RpcId; payload: F }>,
    apply: (frame: { rpcId: RpcId; payload: F }) => void,
  ): void {
    void (async () => {
      try {
        for await (const frame of stream) apply(frame)
      } catch (error) {
        if (this.streamAbort?.signal.aborted === true) return
        this.emitError(error)
      }
    })()
  }

  /** nats auto-reconnects internally; we react to its status transitions. */
  private async watchStatus(conn: StatusfulConn, generation: number): Promise<void> {
    try {
      for await (const status of conn.status()) {
        if (this.generation !== generation || this.conn !== conn) return
        if (status.type === 'disconnect' || status.type === 'staleConnection') {
          this.setState('reconnecting')
        } else if (status.type === 'reconnect') {
          this.setState('connecting')
          // The server side may still be settling (responders not yet
          // re-subscribed); retry the establish pass with backoff.
          void this.retryEstablish(generation)
        }
      }
    } catch {
      // status iterator ends when the connection closes; stop() owns that path
    }
  }

  /** Establish with bounded exponential backoff; abandoned on stop()/new generation. */
  private async retryEstablish(generation: number): Promise<void> {
    let delay = 1000
    while (this.generation === generation && this.conn !== null && this.state !== 'stopped') {
      try {
        await this.establish()
        return
      } catch (error) {
        this.setState('reconnecting')
        this.emitError(error)
        await sleep(delay)
        delay = Math.min(delay * 2, 15_000)
      }
    }
  }

  private scheduleRetry(run: () => void, delayMs = 2000): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.state === 'stopped') return
      run()
    }, delayMs)
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    this.emit('state', { state })
  }

  private emitError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.emit('error', { message, kind: classifyConnectionFailure(message) })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
