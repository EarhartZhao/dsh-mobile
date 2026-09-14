/**
 * Development builds keep nats.ws protocol tracing on (`debug: __DEV__`) so
 * bridge problems are diagnosable, but that trace prints every wire frame —
 * including the `x-dsh-token` device-token header — straight to the console via
 * its own `console.info`, with no logger hook to intercept.
 *
 * This module wraps the console once, in development only, and rewrites that
 * one header out of every string argument. Release builds never enable the
 * trace, so they never need (or run) this.
 */

const TOKEN_HEADER = /(x-dsh-token:\s*)\S+/g

function redact(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(TOKEN_HEADER, '$1<redacted>') : value
}

/** Idempotent: importing twice must not stack wrappers. */
export function installConsoleRedaction(): void {
  if (__DEV__ !== true) return
  const marker = '__dshConsoleRedacted'
  const consoleWithMarker = console as typeof console & { [marker]?: boolean }
  if (consoleWithMarker[marker] === true) return
  consoleWithMarker[marker] = true
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]): void => { original(...args.map(redact)) }
  }
}
