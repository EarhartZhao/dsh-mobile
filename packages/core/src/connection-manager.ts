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

/**
 * Host frames that can change the list baseline: which chats exist, which
 * workspace owns them, their order, and which are archived.
 *
 * The store patches all of these in place, which keeps a live list moving. What
 * it cannot patch is *membership*: the workspace view owns `sessionIds`, and a
 * `host/session-added` carries no workspace at all. So a chat created from the
 * desktop lands under 未分组 on the phone until something re-pulls the
 * authoritative baseline. These frames are therefore treated as invalidation
 * signals too, not only as state to merge.
 */
const BASELINE_INVALIDATING_FRAMES: ReadonlySet<string> = new Set([
  'host/session-added',
  'host/session-removed',
  'host/workspace-changed',
  'host/workspace-removed',
  'host/workspace-order-changed',
  'host/archived-sessions-changed',
])

/** Debounce window for the baseline re-pull: one burst (create + file + sort) is one round trip. */
const BASELINE_REFRESH_MS = 400

/**
 * Default age after which a baseline is considered stale. Frames are
 * fire-and-forget and the phone is often backgrounded, so "the reader is looking
 * at the list again" is a better staleness signal than any frame.
 */
export const BASELINE_STALE_MS = 30_000

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
  /**
   * Bridge liveness probe period in milliseconds; 0 disables it. The phone
   * keeps one connection to the NATS Hub, so a bridge restart never shows up as
   * a transport event: only this probe notices the new generation.
   */
  bridgeProbeMs?: number
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
  private retryTask: Promise<void> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  /** Pending debounced baseline re-pull; see {@link BASELINE_INVALIDATING_FRAMES}. */
  private baselineTimer: ReturnType<typeof setTimeout> | null = null
  /** A list-changing frame arrived while offline, so the next establish re-pulls. */
  private baselineDirty = false
  /** When the last authoritative list/workspace baseline landed. */
  private baselineAt: number | null = null
  /** Bridge process start time observed by the last health answer. */
  private bridgeStartedAt: string | null = null

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
      this.startHeartbeat()
    } catch (error) {
      this.setState('reconnecting')
      this.emitError(error)
      this.scheduleRetry(() => this.ensureRetryEstablish(this.generation))
    }
  }

  async stop(): Promise<void> {
    this.generation++
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.baselineTimer !== null) {
      clearTimeout(this.baselineTimer)
      this.baselineTimer = null
    }
    this.baselineDirty = false
    this.streamAbort?.abort()
    this.streamAbort = null
    this.stopHeartbeat()
    this.retryTask = null
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
      this.baselineAt = Date.now()
    }
  }

  /**
   * Refresh the list baseline when the caller has reason to think it is stale —
   * the list appearing, or the app returning to the foreground.
   *
   * Frames are fire-and-forget: a change made by another client while the phone
   * was backgrounded, or during a reconnect gap, leaves no trace here. Re-pulling
   * when the reader is about to look is what makes the list trustworthy again,
   * and the age guard keeps screen switching from re-pulling every time.
   *
   * @param maxAgeMs - how long a landed baseline is trusted (default {@link BASELINE_STALE_MS}).
   */
  async refreshBaselineIfStale(maxAgeMs: number = BASELINE_STALE_MS): Promise<void> {
    if (this.baselineAt !== null && Date.now() - this.baselineAt < maxAgeMs) return
    await this.refreshBaseline()
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
      this.bridgeStartedAt = this.health?.startedAt ?? null
    } else {
      this.health = null
      this.healthLatencyMs = null
      this.healthError = null
      this.bridgeStartedAt = null
    }

    const describe = await client.host.describe({})
    if (!describe.result.ok) throw new Error(`host.describe failed: ${describe.result.error.message}`)
    this.hostInfo = describe.result.value
    this.emit('hostInfo', { info: describe.result.value })

    this.streamAbort?.abort()
    const abort = new AbortController()
    this.streamAbort = abort
    const generation = this.generation
    this.store.resetLiveSnapshots()
    // Subscriptions must be registered before hello, or the replayed pending
    // frames publish into the void. onOpen fires post-flush (docs/02 lifecycle).
    const muxOpen = this.trackOpen()
    const hostOpen = this.trackOpen()
    this.pump(
      client.events.mux({}, abort.signal, muxOpen.resolve),
      frame => this.store.applyMuxFrame(frame.rpcId, frame.payload),
      abort.signal,
      generation,
    )
    this.pump(
      client.events.host({}, abort.signal, hostOpen.resolve),
      frame => this.applyHostFrame(frame.payload),
      abort.signal,
      generation,
    )

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
      this.baselineAt = Date.now()
    }

    await Promise.all([muxOpen.waited, hostOpen.waited])
    await sendHello(this.conn!, this.options.headers, this.options.instanceId, token)
    this.lastOnlineAt = new Date().toISOString()
    this.setState('online')
    // A list-changing frame can land while the baseline above is in flight (it
    // was fetched before that frame); re-pull once now that we can.
    if (this.baselineDirty) {
      this.baselineDirty = false
      this.scheduleBaselineRefresh()
    }
  }

  /**
   * Apply one host-domain frame, then treat the list-changing ones as an
   * invalidation signal for the baseline as well as state to merge.
   *
   * Patching keeps a live list moving, but it cannot express session
   * *membership*: the workspace view owns `sessionIds` and a `host/session-added`
   * names no workspace, so a chat created on the desktop would sit under 未分组
   * on the phone. Re-pulling the authoritative baseline is both the correct fix
   * for that and the cheap one to reason about when a frame was lost.
   */
  private applyHostFrame(frame: HostFrame): void {
    this.store.applyHostFrame(frame)
    if (BASELINE_INVALIDATING_FRAMES.has(frame.type)) this.scheduleBaselineRefresh()
  }

  /** Debounced re-pull; skipped while offline with the dirty flag left set. */
  private scheduleBaselineRefresh(): void {
    if (this.baselineTimer !== null) return
    this.baselineTimer = setTimeout(() => {
      this.baselineTimer = null
      if (this.state !== 'online') {
        this.baselineDirty = true
        return
      }
      void this.refreshBaseline().catch(() => undefined)
    }, BASELINE_REFRESH_MS)
  }

  /** Start the bridge liveness probe once the first establish pass succeeded. */
  private startHeartbeat(): void {
    const period = this.options.bridgeProbeMs ?? 30_000
    if (period <= 0 || this.heartbeat !== null) return
    this.heartbeat = setInterval(() => { void this.probeBridgeGeneration() }, period)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === null) return
    clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  /**
   * Notice a bridge restart the transport never reports.
   *
   * The phone holds one connection to the NATS Hub, and the bridge is just
   * another client of it: restarting the bridge on the host leaves that
   * connection up, so nothing else here observes the new generation. Every
   * piece of live state the App holds — approvals, questions, running flags,
   * job rosters — then belongs to frames that no longer exist, which is how a
   * held approval card turns into a button that does nothing. The bridge's own
   * `startedAt` is the generation identity, and the establish pass is what
   * rebuilds every derived snapshot.
   */
  private async probeBridgeGeneration(): Promise<void> {
    const period = this.options.bridgeProbeMs ?? 30_000
    if (period <= 0 || this.state !== 'online' || this.conn === null) return
    if (this.compatibility?.features.includes('health-check') !== true) return
    const token = this.options.getToken()
    if (token === undefined) return
    const generation = this.generation
    const snapshot = await fetchMobileHealth(this.conn, this.options.headers, this.options.instanceId, token)
      .catch(() => null)
    if (snapshot === null || this.generation !== generation || this.state !== 'online') return
    this.health = snapshot
    if (this.bridgeStartedAt === null) {
      this.bridgeStartedAt = snapshot.startedAt
      return
    }
    if (snapshot.startedAt === this.bridgeStartedAt) return
    this.bridgeStartedAt = snapshot.startedAt
    this.setState('reconnecting')
    this.ensureRetryEstablish(generation)
  }

  private trackOpen(): { waited: Promise<void>; resolve: () => void } {
    let resolve!: () => void
    const waited = new Promise<void>(r => { resolve = r })
    return { waited, resolve }
  }

  private pump<F extends MuxFrame | HostFrame>(
    stream: AsyncIterable<{ rpcId: RpcId; payload: F }>,
    apply: (frame: { rpcId: RpcId; payload: F }) => void,
    signal: AbortSignal,
    generation: number,
  ): void {
    void (async () => {
      try {
        for await (const frame of stream) apply(frame)
      } catch (error) {
        if (signal.aborted || this.generation !== generation) return
        this.setState('reconnecting')
        this.emitError(error)
        this.ensureRetryEstablish(generation)
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
          this.ensureRetryEstablish(generation)
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

  private ensureRetryEstablish(generation: number): void {
    if (this.retryTask !== null) return
    const task = this.retryEstablish(generation)
    this.retryTask = task
    void task.finally(() => {
      if (this.retryTask === task) this.retryTask = null
    })
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
