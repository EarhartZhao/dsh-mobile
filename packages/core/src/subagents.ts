/**
 * The session header's subagent switcher rows.
 *
 * The Web renders one control beside a conversation's title — `N 个子智能体`,
 * or `N 个子智能体，正在运行` while any of them works — and opens a list of the
 * direct children underneath it, each row carrying its label, what it is doing,
 * and how much it has spent. Tapping a row switches to that child.
 *
 * Every fact that list needs already rides this client's own stores: the
 * parent's durable `subagentCatalog` projection names the children and their
 * modes, the `session/list` baseline says which are running and whether they
 * have children of their own, and each child's own `subagentTiming` and
 * `tokenUsage` projections carry its accumulated active time and spend. Nothing
 * here invents a metric it cannot read: a child whose projections this client
 * has never seen renders its identity alone, exactly as the Web's catalog does
 * while a projection is still loading.
 */
import type { SessionSummary } from '@dsh-mobile/protocol'
import type { SessionState } from './session-store.ts'

/** How a child was started, as far as this client can prove. */
export type SubagentMode = 'one-shot' | 'continuable' | 'unknown'

/** What one child is doing at this cut. */
export type SubagentActivity = 'running' | 'inactive'

/** One row of the header switcher, ready to render. */
export interface SubagentRow {
  id: string
  /** Durable creation label; the id is the fallback, as in the Web's catalog. */
  label: string
  mode: SubagentMode
  activity: SubagentActivity
  /**
   * The child's last turn closed normally. Only meaningful while inactive: a
   * running child has no closed turn to report.
   */
  completed: boolean
  /** Whether a direct descendant of this child exists, so the row can disclose. */
  hasChildren: boolean
  /** The child's own conversation title, when this client has read it. */
  title?: string
  /** Total tokens across the four disjoint usage buckets. */
  tokens?: number
  /** Active milliseconds: settled turns plus the open one, cut at `now`. */
  activeMs?: number
}

/** The parent's durable catalog row, narrowed from the projection's own JSON. */
interface CatalogEntry {
  id: string
  mode: SubagentMode
  label?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numberOf(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined
  const found = value[key]
  return typeof found === 'number' && Number.isFinite(found) && found >= 0 ? found : undefined
}

/**
 * The parent's `subagentCatalog` projection as rows.
 *
 * A row without a usable id is dropped rather than rendered as a blank entry:
 * the projection is folded from durable events, and a malformed one must not
 * become a row the reader cannot address.
 * @param value - the projection value, of unknown provenance in the store.
 * @returns the parent's direct children, in catalog order.
 */
function catalogEntries(value: unknown): CatalogEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => {
    if (!isRecord(row) || typeof row['id'] !== 'string' || row['id'] === '') return []
    const mode = row['mode'] === 'continuable'
      ? 'continuable' as const
      : row['mode'] === 'one-shot' ? 'one-shot' as const : 'unknown' as const
    return [{
      id: row['id'],
      mode,
      ...(typeof row['label'] === 'string' && row['label'] !== '' ? { label: row['label'] } : {}),
    }]
  })
}

/** Sum the four disjoint durable provider-usage buckets, as the Web does. */
function tokenTotal(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined
  const buckets = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
    .map(key => numberOf(value, key))
  if (buckets.some(bucket => bucket === undefined)) return undefined
  return buckets.reduce<number>((total, bucket) => total + (bucket ?? 0), 0)
}

/**
 * Exact whole-second active duration for one child.
 *
 * A settled child's accumulated milliseconds are the answer; a child in an open
 * turn adds the interval that turn has been running for, measured to `now` while
 * it runs and to the projection's own last fold time once it stops — the Web's
 * rule, which keeps a stopped child's clock from growing after it stopped.
 * @param value - the child's `subagentTiming` projection.
 * @param activity - whether the child is running at this cut.
 * @param now - this render's clock.
 * @returns active milliseconds, or undefined with no timing projection.
 */
function activeMs(value: unknown, activity: SubagentActivity, now: number): number | undefined {
  const settledMs = numberOf(value, 'settledMs')
  if (settledMs === undefined) return undefined
  const active = isRecord(value) ? value['active'] : undefined
  const since = numberOf(active, 'since')
  if (since === undefined) return settledMs
  const through = numberOf(active, 'through')
  const end = activity === 'running' ? now : through ?? since
  return settledMs + Math.max(0, end - since)
}

/** The store surface this derivation reads; the App passes its own store. */
export interface SubagentCatalogSource {
  /** Every Session row the Host has listed. */
  summaries: readonly SessionSummary[]
  /** Session states by id; absent for a Session this client has never seen. */
  sessions: ReadonlyMap<string, SessionState>
}

/**
 * The rows the header switcher shows for one parent Session.
 * @param source - the client's session store.
 * @param parentSessionId - the conversation whose direct children are listed.
 * @param now - this render's clock, for a running child's open interval.
 * @returns one row per direct child, in durable catalog order.
 */
export function subagentRows(
  source: SubagentCatalogSource,
  parentSessionId: string,
  now: number,
): SubagentRow[] {
  const parent = source.sessions.get(parentSessionId)
  const entries = catalogEntries(parent?.projections['subagentCatalog'])
  if (entries.length === 0) return []
  // One pass over the list for both facts a child needs from it: its own row
  // (liveness) and whether it is some other Session's parent (`hasChildren`).
  const byId = new Map<string, SessionSummary>(
    source.summaries.map(summary => [String(summary.sessionId), summary]),
  )
  const parents = new Set(source.summaries.flatMap(summary =>
    summary.parentSessionId === undefined ? [] : [String(summary.parentSessionId)]))
  return entries.map((entry) => {
    const summary = byId.get(entry.id)
    const child = source.sessions.get(entry.id)
    const running = summary?.running === true || child?.running === true
    const activity: SubagentActivity = running ? 'running' : 'inactive'
    const timing = child?.projections['subagentTiming']
    const timingState = isRecord(timing) ? timing : undefined
    const title = child?.projections['title']
    const tokens = tokenTotal(child?.projections['tokenUsage'])
    const duration = activeMs(timing, activity, now)
    return {
      id: entry.id,
      label: entry.label ?? entry.id,
      mode: entry.mode,
      activity,
      completed: activity === 'inactive' && timingState?.['lastTurnCompleted'] === true,
      hasChildren: parents.has(entry.id),
      ...(typeof title === 'string' && title.trim() !== '' ? { title } : {}),
      ...(tokens === undefined ? {} : { tokens }),
      ...(duration === undefined ? {} : { activeMs: duration }),
    }
  })
}

/**
 * The switcher's own trigger text key for a row set: the running form while any
 * child works, the plain count otherwise — the Web picks between exactly these
 * four strings.
 * @param rows - the rows the control would show.
 * @returns whether the trigger names running children and the count it prints.
 */
export function subagentCount(rows: readonly SubagentRow[]): { count: number, running: number } {
  return {
    count: rows.length,
    running: rows.filter(row => row.activity === 'running').length,
  }
}

/** The durable parent/child address one subagent conversation is read through. */
export interface SubagentAddress {
  parentSessionId: string
  childSessionId: string
  mode: 'one-shot' | 'continuable'
}

/**
 * Address one subagent conversation by its durable parent.
 *
 * A subagent Session is not addressable as a Session: the Host refuses that
 * with "subagent Sessions require their durable parent address", so a reader
 * that followed one out of the header switcher has to name both the parent and
 * the child's creation mode before it can read — or continue — that
 * transcript at all. Both facts are durable and already local: the Session list
 * carries the parent, and the parent's own `subagentCatalog` projection carries
 * the mode. A child whose catalog this client has never read yields nothing
 * rather than a guessed mode, because the mode is part of the address and the
 * wrong one is refused rather than ignored.
 * @param source - the client's session store.
 * @param childSessionId - the subagent conversation to address.
 * @returns the address, or null when this client cannot name parent and mode.
 */
export function subagentAddress(
  source: SubagentCatalogSource,
  childSessionId: string,
): SubagentAddress | null {
  if (childSessionId === '') return null
  const parentSessionId = source.summaries
    .find(row => String(row.sessionId) === childSessionId)?.parentSessionId
  if (typeof parentSessionId !== 'string' || parentSessionId === '') return null
  const entry = catalogEntries(source.sessions.get(parentSessionId)?.projections['subagentCatalog'])
    .find(row => row.id === childSessionId)
  if (entry === undefined || entry.mode === 'unknown') return null
  return { parentSessionId, childSessionId, mode: entry.mode }
}
