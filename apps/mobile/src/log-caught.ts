/**
 * Caught values are printed as text, never handed to `console` as objects.
 *
 * React Native's LogBox formats every console argument for its in-app overlay.
 * A value the formatter chokes on throws *out of* the formatter, which is
 * itself a warning, which is formatted again: one bad log call becomes an
 * unbounded warning stream that spends the entire JS thread and freezes the
 * App behind it. Flattening at the call site keeps the diagnostic usable and
 * the failure bounded.
 */
export function describeCaught(cause: unknown): string {
  if (cause instanceof Error) return cause.stack ?? `${cause.name}: ${cause.message}`
  if (typeof cause === 'string') return cause
  try {
    return JSON.stringify(cause) ?? String(cause)
  } catch {
    return String(cause)
  }
}

/** `console.warn` for a caught value, with the value flattened to a string. */
export function warnCaught(prefix: string, cause: unknown): void {
  console.warn(`${prefix} ${describeCaught(cause)}`)
}
