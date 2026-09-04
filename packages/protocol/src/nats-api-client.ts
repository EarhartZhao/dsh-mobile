/**
 * NATS carrier for the vendored harness contract: AbstractApiClient keeps
 * every protocol invariant (rpcId minting, envelope wrap/unwrap, zod parse),
 * this subclass only moves bytes — unary calls become request-reply on
 * `svc.dsh.{instance}.{method}`, streams become pub/sub subscriptions on
 * `evt.dsh.{instance}.mux|host`. Wire bytes are identical to the browser
 * carrier (docs/02-protocol.md).
 */

import type { z } from 'zod'
import { AbstractApiClient, type IApiClient } from './vendor/fetch/client.ts'
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from './vendor/api/index.ts'
import { serverRequestSchema } from './vendor/api/rpc.schema.ts'
import { hostFrameSchema, muxFrameSchema } from './vendor/api/events.schema.ts'
import { evtSubject, svcSubject, TOKEN_HEADER } from './subjects.ts'
import type { NatsConnLike, NatsHeadersFactory } from './nats-types.ts'
import { createMobileCommands } from './mobile-commands.ts'
import { createMobileReferences } from './mobile-references.ts'

export interface NatsApiClientOptions {
  conn: NatsConnLike
  instanceId: string
  /** Device token lookup (called per request; a revoked token fails on the plugin side). */
  getToken: () => string | undefined
  /** headers() factory from the injected nats flavor. */
  headers: NatsHeadersFactory
  timeoutMs?: number
}

export class NatsApiClient extends AbstractApiClient {
  private readonly conn: NatsConnLike
  private readonly instanceId: string
  private readonly getToken: () => string | undefined
  private readonly headersFactory: NatsHeadersFactory
  readonly commands: ReturnType<typeof createMobileCommands>
  readonly references: ReturnType<typeof createMobileReferences>

  constructor(options: NatsApiClientOptions) {
    super(options.timeoutMs)
    this.conn = options.conn
    this.instanceId = options.instanceId
    this.getToken = options.getToken
    this.headersFactory = options.headers
    this.commands = createMobileCommands(options.conn, options.headers, options.instanceId, options.getToken)
    this.references = createMobileReferences(options.conn, options.headers, options.instanceId, options.getToken)
  }

  /**
   * Unary leg: URL path to subject mapping. The vendored base mints
   * `/api/<method>` and `/api/respond` paths on a fake authority; here they
   * become NATS subjects. Reply bytes arrive as the ServerResponse envelope
   * verbatim, so the returned Response body needs no transformation.
   */
  protected async doFetch(input: URL, init?: RequestInit): Promise<Response> {
    const path = input.pathname
    const method = path === '/api/respond' ? 'respond' : path.replace(/^\/api\//, '')
    if (method === path) throw new Error(`unmappable path for NATS carrier: ${path}`)
    const headers = this.headersFactory()
    const token = this.getToken()
    if (token !== undefined) headers.set(TOKEN_HEADER, token)
    const reply = await this.withAbort(init?.signal ?? undefined, () =>
      this.conn.request(svcSubject(this.instanceId, method), init?.body as string | undefined, {
        // The base class's merged signal (timeout + caller abort) is the
        // authoritative deadline; this nats-side timeout is a backstop only.
        timeout: this.timeoutMs + 10_000,
        headers,
      }),
    )
    // Hand the Response a *string*: RN's whatwg-fetch decodes Uint8Array
    // bodies byte-wise as Latin-1 (mojibake on CJK payloads), while strings
    // pass through untouched. The envelope is always UTF-8 JSON.
    return new Response(new TextDecoder().decode(reply.data), { status: 200 })
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readSubject(evtSubject(this.instanceId, 'mux'), signal, muxFrameSchema, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readSubject(evtSubject(this.instanceId, 'host'), signal, hostFrameSchema, onOpen)
  }

  /**
   * Stream leg: each pub/sub message is a ServerRequest envelope whose
   * payload is the frame — byte-identical to the browser SSE carrier, minus
   * the `data:` framing. Malformed frames are dropped, not fatal (same
   * discipline as the vendored readSse).
   */
  private async *readSubject<F extends MuxFrame | HostFrame>(
    subject: string,
    signal: AbortSignal,
    frameSchema: z.ZodType<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const sub = this.conn.subscribe(subject)
    const onAbort = (): void => sub.unsubscribe()
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      await this.conn.flush() // SUB registered before we report open
      if (signal.aborted) return
      onOpen?.()
      for await (const msg of sub) {
        let full: ServerRequest
        let frame: F
        try {
          full = serverRequestSchema.parse(JSON.parse(new TextDecoder().decode(msg.data)))
          frame = frameSchema.parse(full.payload)
        } catch (error) {
          console.error(`[dsh-mobile] dropping malformed frame on ${subject}:`, error)
          continue
        }
        this.onEnvelope(full)
        yield { rpcId: full.rpcId, payload: frame }
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      sub.unsubscribe()
    }
  }

  /** Rejects with the signal's reason when the caller aborts mid-request. */
  private async withAbort<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    if (signal === undefined) return run()
    if (signal.aborted) throw abortReason(signal)
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(abortReason(signal))
      signal.addEventListener('abort', onAbort, { once: true })
      run().then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    })
  }
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new Error(reason)
  return new Error('This operation was aborted')
}

export type { IApiClient }
