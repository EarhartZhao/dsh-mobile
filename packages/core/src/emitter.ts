/** Minimal typed emitter; no Node/react-native dependency. Event maps must
 * be `type` aliases (object literals get an implicit index signature;
 * interfaces do not). */

/**
 * Print a caught value as text.
 *
 * Handing an `Error` to `console.error` reads fine in Node, but under React
 * Native's LogBox each console call is formatted for the in-app overlay — and a
 * formatter that itself throws turns one bad listener into an unbounded stream
 * of warnings that spends the whole JS thread, freezing every subscriber
 * behind it. Flattening here keeps the diagnostic usable and the failure
 * bounded.
 */
function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

export class Emitter<Events extends Record<keyof Events, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>()

  on<K extends keyof Events>(type: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(type)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener as (payload: never) => void)
    return () => set.delete(listener as (payload: never) => void)
  }

  protected emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type)
    if (set === undefined) return
    for (const listener of [...set]) {
      try {
        ;(listener as (payload: Events[K]) => void)(payload)
      } catch (error) {
        console.error(`[dsh-mobile] listener for ${String(type)} threw: ${describeThrown(error)}`)
      }
    }
  }
}
