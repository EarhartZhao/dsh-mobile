/**
 * Reading one unary reply off the mobile wire.
 *
 * The envelope is frozen, and so is its failure vocabulary: a closed,
 * code-discriminated union. A plugin older than 0.2.37 forwards the Host's own
 * namespaced failures verbatim (`session/agent-busy`,
 * `gateway/lookup-not-found`), which that union cannot describe — and a strict
 * parse of the whole envelope then fails on the code alone, so the caller
 * reports the zod issue dump and the Host's own message never reaches the
 * screen.
 *
 * So the envelope is read structurally first, with the schema still validating
 * everything it was written to validate: a known code is a known code, a
 * business value is whatever the caller's own second parse accepts, and an
 * unknown code travels as {@link MobileRemoteError} with its message intact.
 */
import { serverResponseSchema } from './vendor/api/rpc.schema.ts'

/**
 * One Remote failure, carrying the code the Host sent even when this build's
 * frozen vocabulary has never heard of it.
 */
export class MobileRemoteError extends Error {
  /** Failure code as it arrived on the wire. */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MobileRemoteError'
    this.code = code
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Read one reply body into its business value.
 * @param data - the reply payload as it arrived.
 * @returns the `result.value` slot of a successful response.
 * @throws {MobileRemoteError} when the Host refused the call, named or not.
 */
export function readMobileResponse(data: Uint8Array): unknown {
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(data))
  } catch {
    throw new MobileRemoteError('internal', 'the reply was not JSON')
  }

  const parsed = serverResponseSchema.safeParse(raw)
  if (parsed.success) {
    const result = parsed.data.result
    if (!result.ok) throw new MobileRemoteError(result.error.code, result.error.message)
    return result.value
  }

  // Not a shape the frozen schema knows. The envelope fields below are still
  // the ones the carrier promises, so a reply that has them is readable even
  // when its code is one this build was never told about.
  const envelope = record(raw)
  const result = envelope === null ? null : record(envelope.result)
  if (envelope?.type === 'server-response' && result !== null) {
    if (result.ok === true) return result.value
    if (result.ok === false) {
      const error = record(result.error)
      const code = typeof error?.code === 'string' ? error.code : 'internal'
      const message = typeof error?.message === 'string' ? error.message : ''
      throw new MobileRemoteError(code, message === '' ? code : message)
    }
  }
  throw new MobileRemoteError('internal', 'the reply was not a server response')
}
