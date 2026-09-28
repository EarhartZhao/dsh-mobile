/**
 * The "unknown surface event" rule: what a client shows for conversation
 * content it has no renderer for.
 *
 * The web transcript has a fallback node for exactly one class of surprise — an
 * append-origin event on the **model-visible surface** that no registered node
 * claimed. It renders the event type and its raw data behind a disclosure
 * instead of dropping it, so a plugin (or a newer dsh) that adds visible
 * conversation content is never silently invisible.
 *
 * The rule below keys on the host's `surfaceOp` marker alone, not on a list of
 * surface event types. That is deliberate. The host refuses to write
 * `surfaceOp` on a type that cannot join the surface, and requires it on every
 * type that can ("is not surface-eligible and cannot carry surfaceOp" /
 * "surface-eligible and requires a surfaceOp marker"), so an event carrying
 * `surfaceOp: 'append'` states its own eligibility. A stale client therefore
 * needs no matching table to notice a sixth message-producing type a newer dsh
 * introduced — the whole point of a fallback.
 *
 * Two deliberate exclusions keep the safety net from becoming noise:
 *
 * 1. **Only the surface.** Every non-surface event type is log-only by design
 *    (`step`/`turn` boundaries, attempt records, tool dispatch bookkeeping, …)
 *    and carries no marker, so those never qualify. Showing them would bury the
 *    transcript under internal bookkeeping — the web does not render them
 *    either.
 * 2. **Only append origin.** A replacement copy shadows a surface range for the
 *    model; the human transcript follows the append-origin event it replaced,
 *    which the reader has already seen.
 *
 * `system/message` and `developer/message` are surface events the harness emits
 * for its own bookkeeping (the rendered system prompt, developer instructions).
 * The web projects them into hidden nodes, so a competent client states that
 * explicitly here rather than through a blanket "it is not in my switch"
 * accident.
 */

/** Surface events the harness emits for the model, never for the transcript. */
const HIDDEN_SURFACE_TYPES: ReadonlySet<string> = new Set([
  'system/message',
  'developer/message',
])

/**
 * Whether one event is conversation content this client cannot render and
 * should therefore disclose instead of dropping.
 *
 * @param type - the event's type from the log.
 * @param surfaceOp - the event's surface marker; a replacement copy is excluded.
 * @returns true when the caller should emit a fallback row for this event.
 */
export function isUnclaimedSurfaceEvent(type: unknown, surfaceOp: unknown): boolean {
  if (typeof type !== 'string') return false
  if (surfaceOp !== 'append') return false
  return !HIDDEN_SURFACE_TYPES.has(type)
}

/** One-line JSON for the collapsed row: compacted, capped, never multi-line. */
export function compactJson(value: unknown, limit = 200): string {
  return truncate(compact(stringify(value)), limit)
}

/** Indented JSON for the expanded body, capped so a huge payload cannot stall. */
export function prettyJson(value: unknown, limit = 4000): string {
  return truncate(stringify(value, 2), limit)
}

function stringify(value: unknown, indent?: number): string {
  if (typeof value === 'string') return value
  try {
    const text = JSON.stringify(value, null, indent) ?? String(value)
    return text === 'undefined' ? String(value) : text
  } catch {
    // A cyclic or getter-throwing payload must not break the transcript.
    return String(value)
  }
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}
