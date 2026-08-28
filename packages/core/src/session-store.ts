/**
 * Authoritative client-side view of the host's session state. Snapshots are
 * replace-not-merge (queue/jobs/list), projections are higher-seq-wins, and
 * the event log is append-only with seq dedupe — the same semantics the
 * browser client follows (docs/02 "事件流消费要点"). The store is a pure
 * reducer: no I/O, no timers, no react-native — UI layers subscribe and
 * throttle their own renders.
 */

import type {
  HistoryEntry,
  HostFrame,
  JobView,
  MuxFrame,
  QueuedInboxItem,
  RpcId,
  SessionProjectionsBlock,
  SessionSummary,
  WorkspaceView,
} from '@dsh-mobile/protocol'
import { Emitter } from './emitter.ts'

export interface PendingApproval {
  approvalId: string
  /** The server-request's rpcId — respond echoes it, never mints a new one. */
  rpcId: RpcId
  toolName: string
  reason?: string | undefined
}

export interface PendingQuestion {
  rpcId: RpcId
  questions: unknown[]
}

export interface SessionState {
  sessionId: string
  /** Append-only log, seq-ascending; baseline page plus live appends. */
  events: HistoryEntry[]
  /** Watermark: highest committed seq seen (baseline or live). -1 when empty. */
  lastSeq: number
  /** Generic projection value store (titles ride the `title` key). */
  projections: Record<string, unknown>
  projectionSeqs: Record<string, number>
  /** Whole-snapshot replacements. */
  queue: QueuedInboxItem[]
  jobs: JobView[]
  pendingApprovals: Map<string, PendingApproval>
  pendingQuestions: Map<string, PendingQuestion>
  running: boolean
}

type StoreEvents = {
  changed: { sessionId?: string | undefined }
  workspacesChanged: undefined
  error: { message: string }
}

function emptySession(sessionId: string): SessionState {
  return {
    sessionId,
    events: [],
    lastSeq: -1,
    projections: {},
    projectionSeqs: {},
    queue: [],
    jobs: [],
    pendingApprovals: new Map(),
    pendingQuestions: new Map(),
    running: false,
  }
}

export class SessionStore extends Emitter<StoreEvents> {
  readonly sessions = new Map<string, SessionState>()
  summaries: SessionSummary[] = []
  workspaces: WorkspaceView[] = []
  archivedSessionIds: string[] = []

  /** Reconnect baseline: replace list/workspace/archived state wholesale. */
  applyBaseline(input: {
    summaries: SessionSummary[]
    workspaces: WorkspaceView[]
    archivedSessionIds?: string[]
  }): void {
    this.summaries = input.summaries
    this.workspaces = input.workspaces
    if (input.archivedSessionIds !== undefined) this.archivedSessionIds = input.archivedSessionIds
    for (const summary of input.summaries) {
      this.session(summary.sessionId).running = summary.running
    }
    this.emit('changed', { sessionId: undefined })
    this.emit('workspacesChanged', undefined)
  }

  /** History page merge (tail page first). Returns the merged log length. */
  applyHistory(sessionId: string, entries: HistoryEntry[], projections?: SessionProjectionsBlock): number {
    const session = this.session(sessionId)
    const known = new Set(session.events.map(e => eventSeq(e)).filter((s): s is number => s !== undefined))
    for (const entry of entries) {
      const seq = eventSeq(entry)
      if (seq !== undefined && known.has(seq)) continue
      if (seq !== undefined) known.add(seq)
      session.events.push(entry)
    }
    session.events.sort((a, b) => (eventSeq(a) ?? -1) - (eventSeq(b) ?? -1))
    const last = session.events.at(-1)
    const lastSeq = last === undefined ? -1 : (eventSeq(last) ?? session.lastSeq)
    if (lastSeq > session.lastSeq) session.lastSeq = lastSeq
    if (projections !== undefined) {
      for (const [key, value] of Object.entries(projections.values)) {
        session.projections[key] = value
        session.projectionSeqs[key] = projections.asOfSeq
      }
    }
    this.emit('changed', { sessionId })
    return session.events.length
  }

  applyMuxFrame(rpcId: RpcId, frame: MuxFrame): void {
    switch (frame.type) {
      case 'session/event': {
        const session = this.session(frame.sessionId)
        const seq = eventSeq(frame.event)
        if (seq !== undefined && seq <= session.lastSeq) return // replay / duplicate
        session.events.push({ event: frame.event, ...(frame.view === undefined ? {} : { view: frame.view }) })
        if (seq !== undefined) session.lastSeq = seq
        break
      }
      case 'session/subscribed': {
        const session = this.session(frame.sessionId)
        if (frame.lastSeq > session.lastSeq) session.lastSeq = frame.lastSeq
        break
      }
      case 'session/projection': {
        const session = this.session(frame.sessionId)
        const known = session.projectionSeqs[frame.key]
        if (known !== undefined && known >= frame.seq) return // higher-seq-wins
        session.projections[frame.key] = frame.value
        session.projectionSeqs[frame.key] = frame.seq
        break
      }
      case 'session/queue':
        this.session(frame.sessionId).queue = frame.items
        break
      case 'session/jobs':
        this.session(frame.sessionId).jobs = frame.jobs
        break
      case 'approval/requested':
        this.session(frame.sessionId).pendingApprovals.set(frame.approvalId, {
          approvalId: frame.approvalId,
          rpcId,
          toolName: frame.toolName,
          reason: frame.reason,
        })
        break
      case 'approval/resolved':
        this.session(frame.sessionId).pendingApprovals.delete(frame.approvalId)
        break
      case 'question/requested':
        this.session(frame.sessionId).pendingQuestions.set(rpcId, { rpcId, questions: frame.questions })
        break
      case 'question/resolved':
        this.session(frame.sessionId).pendingQuestions.delete(frame.questionRpcId)
        break
      case 'stream/error':
        this.emit('error', { message: frame.error.message })
        return
    }
    this.emit('changed', { sessionId: 'sessionId' in frame ? frame.sessionId : undefined })
  }

  applyHostFrame(frame: HostFrame): void {
    switch (frame.type) {
      case 'host/session-added': {
        const session = this.session(frame.sessionId)
        session.running = false
        break
      }
      case 'host/session-removed':
        this.sessions.delete(frame.sessionId)
        this.summaries = this.summaries.filter(s => s.sessionId !== frame.sessionId)
        break
      case 'host/session-status': {
        this.session(frame.sessionId).running = frame.running
        const summary = this.summaries.find(s => s.sessionId === frame.sessionId)
        if (summary !== undefined) summary.running = frame.running
        break
      }
      case 'host/agent-error':
        this.emit('error', { message: frame.message })
        break
      case 'host/workspace-changed': {
        const idx = this.workspaces.findIndex(w => w.workspaceId === frame.workspace.workspaceId)
        if (idx === -1) this.workspaces.push(frame.workspace)
        else this.workspaces[idx] = frame.workspace
        this.emit('workspacesChanged', undefined)
        break
      }
      case 'host/workspace-removed':
        this.workspaces = this.workspaces.filter(w => w.workspaceId !== frame.workspaceId)
        this.emit('workspacesChanged', undefined)
        break
      case 'host/archived-sessions-changed':
        this.archivedSessionIds = frame.archivedSessionIds
        break
      default:
        break // workspace-order-changed / remote-event etc.: list refresh concern, not store state
    }
    this.emit('changed', { sessionId: 'sessionId' in frame ? frame.sessionId : undefined })
  }

  /** Title lookup: live projection first, then nothing (list rows fall back to summaries). */
  title(sessionId: string): string | undefined {
    const value = this.session(sessionId).projections['title']
    return typeof value === 'string' ? value : undefined
  }

  private session(sessionId: string): SessionState {
    let existing = this.sessions.get(sessionId)
    if (existing === undefined) {
      existing = emptySession(sessionId)
      this.sessions.set(sessionId, existing)
    }
    return existing
  }
}

type HasSeq = { seq?: number } | { event: { seq?: number } }

function eventSeq(entry: HasSeq): number | undefined {
  if ('event' in entry) return typeof entry.event.seq === 'number' ? entry.event.seq : undefined
  return typeof entry.seq === 'number' ? entry.seq : undefined
}
