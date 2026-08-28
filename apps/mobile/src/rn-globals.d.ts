/**
 * Hermes runtime globals the vendored contract layer + NATS carrier rely on,
 * which react-native's own type set does not declare. Each entry matches the
 * actual runtime:
 * - TextDecoder/TextEncoder: NOT built into Hermes — polyfilled by
 *   fastestsmallesttextencoderdecoder, imported first in index.js (nats.ws
 *   instantiates TextDecoder at module scope, so import order is load-bearing).
 * - crypto.randomUUID: provided by react-native-get-random-values (index.js).
 * - queueMicrotask: Hermes built-in.
 * - Response.body / URL-typed fetch: only exercised by the vendored SSE path
 *   (readSse), which the NATS carrier overrides and never calls — the types
 *   exist to keep the vendored sources compiling under one program.
 */
declare class TextDecoder {
  decode(input?: Uint8Array | ArrayBuffer, options?: { stream?: boolean }): string
}

declare class TextEncoder {
  encode(input?: string): Uint8Array
}

interface Crypto {
  randomUUID(): string
  getRandomValues<T extends ArrayBufferView>(array: T): T
}

declare var crypto: Crypto

declare function queueMicrotask(callback: () => void): void

type BodyInit = string | ArrayBuffer | Uint8Array | Blob

interface Response {
  readonly body: ReadableStream<Uint8Array> | null
}

declare function fetch(input: URL, init?: RequestInit): Promise<Response>
