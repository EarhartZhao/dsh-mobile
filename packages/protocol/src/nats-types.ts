/**
 * Minimal structural view of a NATS connection, satisfied identically by the
 * Node `nats` client and the browser/Hermes `nats.ws` client. Keeping the
 * surface local means the protocol package carries no nats dependency at
 * all — the app injects whichever client the platform bundles.
 */

export interface NatsHeadersLike {
  set(k: string, v: string): void
  get(k: string): string | undefined
}

export interface NatsMsgLike {
  subject: string
  data: Uint8Array
  headers?: NatsHeadersLike | undefined
}

export interface NatsSubLike extends AsyncIterable<NatsMsgLike> {
  unsubscribe(): void
}

export interface NatsConnLike {
  request(
    subject: string,
    data?: Uint8Array | string,
    opts?: { timeout?: number; headers?: NatsHeadersLike },
  ): Promise<NatsMsgLike>
  subscribe(subject: string): NatsSubLike
  /** Resolves once the server has processed everything issued so far (SUB registration included). */
  flush(): Promise<void>
  close(): Promise<void>
}

/** Factory for empty headers; injected so neither nats flavor is imported here. */
export type NatsHeadersFactory = () => NatsHeadersLike
