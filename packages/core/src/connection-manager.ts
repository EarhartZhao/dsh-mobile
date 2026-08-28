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
  type HostFrame,
  type MuxFrame,
  type NatsConnLike,
  type NatsHeadersFactory,
  type RpcId,
} from '@dsh-mobile/protocol'
import { Emitter } from './emitter.ts'
import { SessionStore } from './session-store.ts'

export type ConnectionState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'stopped'

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
  error: { message: string }
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
      this.emit('error', { message: error instanceof Error ? error.message : String(error) })
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
      this.emit('error', { message: error instanceof Error ? error.message : String(error) })
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

  /**
   * One full "become online" pass; also the reconnect-baseline path. Order
   * matters: baselines land before hello so replayed pending frames update
   * fresh state, and subscriptions exist before hello asks for the replay.
   */
  private async establish(): Promise<void> {
    const client = this.client
    const token = this.options.getToken()
    if (client === null || token === undefined) throw new Error('connection not ready')

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
        this.emit('error', { message: error instanceof Error ? error.message : String(error) })
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
        this.emit('error', { message: error instanceof Error ? error.message : String(error) })
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
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
