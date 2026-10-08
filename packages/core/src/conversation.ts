/**
 * Derives the renderable conversation from a session's event log. Defensive
 * by design: event payloads cross a shimmed type boundary, so every field is
 * narrowed at runtime. Live `assistant/chunk` buffers surface as `stream`
 * items and drop out the moment the durable `assistant/message` for their
 * step lands (the message is the authority; chunks are replay fidelity).
 */
import type { ToolCallView, ToolResultView } from '@dsh-mobile/protocol'
import type { SessionState } from './session-store.ts'
import { isUnclaimedSurfaceEvent } from './unknown-event.ts'

export type ConversationItem =
  | { kind: 'user'; key: string; seq: number; time: number; text: string; images: ConversationImage[] }
  | {
      kind: 'assistant'
      key: string
      seq: number
      time: number
      /** The turn this step ran in; absent when the log did not say. */
      turn?: number
      /** The step within the turn, 1-based. The trajectory's step groups key on it. */
      step?: number
      /** Durable assistant-message identity; absent on synthetic items. */
      messageId?: string
      text: string
      reasoning: string
      interrupted: boolean
      producedFiles: string[]
      /**
       * The step's own token accounting, straight off `assistant/message`.
       * Absent when the host recorded none — the turn's usage pill then has
       * nothing to report and stays off rather than showing zeros.
       */
      usage?: StepTokenUsage
      /**
       * Wall clock of the step's own `step/start`, when the log carried one.
       * The trajectory's 「时间」 column is this to the message time.
       */
      startedAt?: number
    }
  | { kind: 'compaction'; key: string; seq: number; time: number; summary: string; compactionId: string }
  | {
      kind: 'tool'
      key: string
      seq: number
      time: number
      /** The turn this call ran in; absent when the log did not say. */
      turn?: number
      /** The step within the turn that dispatched it. */
      step?: number
      callId: string
      name: string
      args: string
      status: 'running' | 'done' | 'error'
      resultPreview: string
      resultText: string
      resultImages: ConversationImage[]
      callView: ToolCallView | null
      resultView: ToolResultView | null
      subCalls: ToolSubCall[]
      /** When the dispatch landed, and when its result did: the row's duration. */
      startedAt?: number
      endedAt?: number
      /** The call-time model-visible schema, read from the request header. */
      schema?: unknown
    }
  | {
      kind: 'stream'
      key: string
      seq: number
      time: number
      turn?: number
      step?: number
      text: string
      reasoning: string
      /** Wall clock of the step's own `step/start`, when the log carried one. */
      startedAt?: number
    }
  /**
   * A tool the model has announced but not yet dispatched. The host streams the
   * tool-call name in an `assistant/chunk` before the durable `tool/call` lands;
   * the web renders that gap as its "preparing" row, and so does this client.
   * Transient: superseded by the `tool/call` for the same callId.
   */
  | {
      kind: 'preparing'
      key: string
      seq: number
      time: number
      turn?: number
      step?: number
      callId: string
      name: string
      /**
       * Bytes of argument text streamed so far. The web's preparing row for a
       * file mutation reports them as `正在准备内容 NKB`, which is the only
       * sign of progress a long `write` gives before it is dispatched.
       */
      argsLength: number
    }
  /**
   * Turn boundaries. Not rendered: they carry the exact start time and the end
   * reason a turn's process header reports ("用时 3 分 12 秒" / "已停止").
   */
  | { kind: 'turn-start'; key: string; seq: number; time: number; turn: number }
  | { kind: 'turn-end'; key: string; seq: number; time: number; turn: number; reason: string }
  /**
   * Conversation content with no renderer: an append-origin surface event this
   * client does not know. Dropping it would make a plugin's (or a newer dsh's)
   * visible content silently invisible, so it becomes a disclosure row instead.
   * See `isUnclaimedSurfaceEvent` for the rule and its exclusions.
   */
  | { kind: 'unknown'; key: string; seq: number; time: number; eventType: string; data: unknown }
  /**
   * The rendered system prompt, or one of its updates.
   *
   * The harness logs it as `system/message` on the model-visible surface, and
   * the transcript deliberately hides it ({@link isUnclaimedSurfaceEvent}).
   * The trajectory does not: knowing what the model was actually told is the
   * reason to open a trajectory at all, so it becomes its own record.
   */
  | {
      kind: 'system'
      key: string
      seq: number
      time: number
      text: string
      /** The first system prompt of the session, as opposed to a later rewrite. */
      initial: boolean
      /** The producer's own description of the rewrite, when it wrote one. */
      sourceKind?: string
    }
  /**
   * A message injected *for* the model rather than written by the reader —
   * a skill catalogue, a reminder, a plugin's context. It rides
   * `user/message` with a non-user source or `developer/message`, and the
   * transcript drops both; the trajectory lists them so the model's context is
   * readable rather than implied.
   */
  | {
      kind: 'context'
      key: string
      seq: number
      time: number
      text: string
      /** e.g. `plugin`, `goal`, `skill` — what produced this injection. */
      sourceKind?: string
    }
  /**
   * Files the model declared as deliverables (`present` tool). The host records
   * them as a durable `deliverables/presented` event carrying the path and the
   * model's own one-line description, which is what the web renders as a card
   * per delivered file.
   */
  | { kind: 'delivery'; key: string; seq: number; time: number; files: DeliveredFile[] }

export interface DeliveredFile {
  path: string
  description?: string
}

/**
 * One step's billed prompt and output buckets.
 *
 * Field names mirror the host's `tokenUsage` projection so the log fold and the
 * authoritative projection describe the same quantities with the same words.
 */
export interface StepTokenUsage {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens?: number
}

export type ConversationImage =
  | { kind: 'data'; uri: string; name?: string | undefined }
  | { kind: 'attachment'; attachmentId: string; name?: string | undefined }

interface ChunkBuffer {
  seq: number
  /** Time of the newest chunk, so a live row can report how long it has run. */
  time: number
  turn: number
  step: number
  text: string
  reasoning: string
}

export interface ToolSubCall {
  callId: string
  name: string
  args: string
  seq: number
  /** Dispatch time, so a nested call can own the live activity line. */
  time: number
  status: 'running' | 'done' | 'error'
  resultPreview: string
  resultText: string
  resultImages: ConversationImage[]
  subCalls: ToolSubCall[]
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The prompt-side and output buckets of one `assistant/message`.
 *
 * The event carries the provider's own names: `inputTokens` counts the prompt
 * tokens that were *not* served from cache, next to `outputTokens` and the two
 * cache buckets. The harness's token-meter projection renames that first one
 * `uncachedInputTokens`, so both spellings are accepted — the same screen may
 * read a live event or a replayed projection sample, and reading only the
 * projection's alias silently dropped every pill on the phone.
 *
 * A usage block without its two mandatory figures is not accounting this client
 * can report, so it reads as "no measurement" rather than as zeros — the same
 * rule the session stats fold applies.
 */
function stepUsage(data: Record<string, unknown>): StepTokenUsage | null {
  const usage = data['usage']
  if (!isObj(usage)) return null
  const uncachedInputTokens = usage['inputTokens'] ?? usage['uncachedInputTokens']
  const outputTokens = usage['outputTokens']
  if (typeof uncachedInputTokens !== 'number' || typeof outputTokens !== 'number') return null
  const reasoningTokens = usage['reasoningTokens']
  return {
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens: typeof usage['cacheReadTokens'] === 'number' ? usage['cacheReadTokens'] : 0,
    cacheWriteTokens: typeof usage['cacheWriteTokens'] === 'number' ? usage['cacheWriteTokens'] : 0,
    ...(typeof reasoningTokens === 'number' ? { reasoningTokens } : {}),
  }
}

/** Content is `string | ContentBlock[]`; unknown block types are skipped, never fatal. */
export function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (isObj(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
      parts.push(block['text'])
    }
  }
  return parts.join('')
}

function blocksToReasoning(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (isObj(block) && block['type'] === 'reasoning' && typeof block['text'] === 'string') {
      parts.push(block['text'])
    }
  }
  return parts.join('')
}

/** User-visible image blocks; attachment refs resolve lazily in the UI layer. */
function blocksToImages(content: unknown): ConversationImage[] {
  if (!Array.isArray(content)) return []
  const images: ConversationImage[] = []
  for (const block of content) {
    if (!isObj(block) || block['type'] !== 'image') continue
    const attachment = isObj(block['attachment']) ? block['attachment'] : undefined
    const attachmentId = typeof attachment?.['attachmentId'] === 'string' ? attachment['attachmentId'] : undefined
    const mediaType = typeof block['mediaType'] === 'string' ? block['mediaType'] : 'image/png'
    const name = typeof block['name'] === 'string'
      ? block['name']
      : typeof attachment?.['name'] === 'string' ? attachment.name : undefined
    if (attachmentId !== undefined) images.push({ kind: 'attachment', attachmentId, name })
    else if (typeof block['data'] === 'string') images.push({ kind: 'data', uri: `data:${mediaType};base64,${block['data']}`, name })
  }
  return images
}

function toolResultBlocks(content: unknown, callId: string | undefined): unknown {
  if (!Array.isArray(content)) return content
  const result = content.find(block => isObj(block)
    && block['type'] === 'tool-result'
    && (callId === undefined || block['toolCallId'] === callId))
  return isObj(result) ? result['content'] : content
}

/** Tool view render intent: diff and edit cards report the paths they produced. */
function producedPaths(view: unknown): string[] {
  if (!isObj(view)) return []
  const card = view['card']
  if (card !== 'diff' && !(card === 'generic' && view['kind'] === 'edit')) return []
  if (!Array.isArray(view['locations'])) return []
  return view['locations']
    .filter(isObj)
    .map(location => location['path'])
    .filter((path): path is string => typeof path === 'string')
}

function toolEventView(entry: HistoryEntryLike): { call: ToolCallView | null; result: ToolResultView | null } {
  const view = entry.view
  if (view === undefined || view === null) return { call: null, result: null }
  if (view['for'] === 'call') return { call: view['view'] as ToolCallView, result: null }
  if (view['for'] === 'result') return { call: null, result: view['view'] as ToolResultView }
  return { call: null, result: null }
}

function stringifyArguments(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) ?? '' } catch { return '' }
}

/**
 * Files one `present` call declares, read from its model-produced arguments.
 * A call whose arguments do not parse, or that carries no usable file, simply
 * contributes nothing: the transcript then shows the tool row alone.
 */
function presentedFiles(argsRaw: string): DeliveredFile[] {
  let args: unknown
  try {
    args = JSON.parse(argsRaw)
  } catch {
    return []
  }
  if (!isObj(args) || !Array.isArray(args['files'])) return []
  const files: DeliveredFile[] = []
  for (const candidate of args['files']) {
    if (!isObj(candidate) || typeof candidate['path'] !== 'string' || candidate['path'] === '') continue
    const description = typeof candidate['description'] === 'string' && candidate['description'] !== ''
      ? candidate['description']
      : undefined
    files.push({ path: candidate['path'], ...(description === undefined ? {} : { description }) })
  }
  return files
}

/**
 * dsh 0.1.5 renamed the durable PTC dispatch events
 * (`tool/code-dispatch*` → `tool/ptc-dispatch*`) and rewrites stored sessions
 * through the v2→v3 migration, while older hosts still emit the legacy names.
 * Fold both vocabularies onto the one the reducer below understands so
 * migrated and freshly recorded sessions render the same sub-call tree.
 */
function normalizeEventType(type: unknown): unknown {
  if (type === 'tool/ptc-dispatch-start') return 'tool/code-dispatch-start'
  if (type === 'tool/ptc-dispatch') return 'tool/code-dispatch'
  return type
}

/**
 * Sort anchor for live stream items. Durable Session seqs are small (a long
 * Session is tens of thousands of events), so any value above them keeps a
 * running turn's transient content behind the log it belongs to.
 */
const LIVE_TAIL_SEQ = 1_000_000_000

/**
 * What the caller knows about the Session beyond its log.
 *
 * The transcript's live surface — a streaming bubble, an announced-but-
 * undispatched call, the "深度求索中" clock — is a claim that the model is
 * working right now, and the log alone cannot always settle that claim: the
 * live event stream can drop mid-turn, leaving chunk buffers whose closing
 * `assistant/message` never arrived. The Host's own run state is what settles
 * it, so a caller that has heard from the Host passes it in.
 */
export interface ConversationOptions {
  /**
   * Host-reported run state: `false` means nothing is in flight, so the
   * transient buffers are stale leftovers and are not rendered at all.
   * `undefined` keeps the client's own reading of the log, which is what a
   * Session the Host has never reported on gets.
   */
  running?: boolean | undefined
}

export function deriveConversation(session: SessionState, options: ConversationOptions = {}): ConversationItem[] {
  const items: ConversationItem[] = []
  const live = new Map<string, ChunkBuffer>()
  /**
   * Announced-but-undispatched tool calls, keyed by callId. A `tool/call` for
   * the same id supersedes the entry, and a closing turn drops whatever is left:
   * a cancelled stream must not leave a phantom "preparing" row on screen.
   */
  const preparing = new Map<string, { seq: number; time: number; turn: number; step: number; callId: string; name: string; argsLength: number }>()
  const finalizedSteps = new Set<string>()
  const tools = new Map<string, ConversationItem & { kind: 'tool' }>()
  const toolTurns = new Map<string, number>()
  const produced = new Map<number, { seq: number; path: string }[]>()
  const toolParents = new Map<string, string>()
  /** Paths already delivered this log, so both delivery sources dedupe onto one card. */
  const delivered = new Map<string, number>()
  /**
   * When each step opened, keyed `turn:step`.
   *
   * `assistant/message` records when the answer landed but not when the model
   * was asked, so without this a trajectory row can only report a message's
   * clock, never how long the step took. `step/start` is the missing end.
   */
  const stepStarts = new Map<string, number>()
  /**
   * The tool catalogue the newest `request/header` advertised, by tool name.
   *
   * The header is the only record of the schema the model was shown at call
   * time, so a call row reads its schema from whatever header preceded it —
   * the same lookup the Web's trajectory performs.
   */
  const toolSchemas = new Map<string, unknown>()
  /** Whether the rendered system prompt has already been recorded. */
  let sawSystemPrompt = false

  for (const entry of session.events) {
    const event = entry.event
    if (!isObj(event)) continue
    const seq = typeof event['seq'] === 'number' ? event['seq'] : 0
    const time = typeof event['time'] === 'number' && Number.isFinite(event['time']) ? event['time'] : 0
    const data: unknown = event['data']
    const type = normalizeEventType(event['type'])
    switch (type) {
      case 'user/message': {
        // Only human-authored prompts render as bubbles. The harness also
        // logs injected context (skill catalogs, reminders, …) as
        // user/message with a non-user source kind; those are model-facing,
        // not conversation UI, and the transcript drops them. They still
        // belong to the trajectory — the model's context is exactly what a
        // reader opens a trajectory to inspect — so they become a context
        // record rather than disappearing. Absent source = keep (defensive).
        // Wire shape: data is the message itself ({content, source, role, id}).
        const content = isObj(data) ? extractContent(data['message'] ?? data) : undefined
        if (isObj(data)) {
          const source = isObj(data['source']) ? data['source']
            : isObj(data['message']) && isObj((data['message'] as Record<string, unknown>)['source'])
              ? (data['message'] as Record<string, unknown>)['source']
              : undefined
          const sourceKind = isObj(source) && typeof source['kind'] === 'string' ? source['kind'] : undefined
          if (sourceKind !== undefined && sourceKind !== 'user') {
            items.push({
              kind: 'context',
              key: `c${seq}`,
              seq,
              time,
              text: blocksToText(content),
              ...(sourceKind === '' ? {} : { sourceKind }),
            })
            break
          }
        }
        items.push({ kind: 'user', key: `u${seq}`, seq, time, text: blocksToText(content), images: blocksToImages(content) })
        break
      }
      case 'developer/message': {
        // Developer instructions reach the model the same way an injected
        // context message does, and the transcript hides both for the same
        // reason. The trajectory keeps them, labelled by their source.
        const message = isObj(data) ? data['message'] ?? data : undefined
        const source = isObj(message) && isObj(message['source']) ? message['source'] : undefined
        const sourceKind = isObj(source) && typeof source['kind'] === 'string' ? source['kind'] : undefined
        items.push({
          kind: 'context',
          key: `c${seq}`,
          seq,
          time,
          text: blocksToText(extractContent(message)),
          ...(sourceKind === undefined || sourceKind === '' ? {} : { sourceKind }),
        })
        break
      }
      case 'system/message': {
        // The rendered system prompt. The transcript hides it; the trajectory
        // is where a reader goes to see what the model was actually told.
        const message = isObj(data) ? data['message'] ?? data : undefined
        const source = isObj(message) && isObj(message['source']) ? message['source'] : undefined
        const sourceKind = isObj(source) && typeof source['kind'] === 'string' ? source['kind'] : undefined
        const text = blocksToText(extractContent(message))
        items.push({
          kind: 'system',
          key: `sys${seq}`,
          seq,
          time,
          text,
          initial: !sawSystemPrompt,
          ...(sourceKind === undefined || sourceKind === '' ? {} : { sourceKind }),
        })
        sawSystemPrompt = true
        break
      }
      case 'step/start': {
        // Bookkeeping the transcript never shows, but the one record of when a
        // step's clock started — which is what a trajectory row's duration needs.
        if (isObj(data)
          && typeof data['turn'] === 'number'
          && typeof data['step'] === 'number') {
          stepStarts.set(`${data['turn']}:${data['step']}`, time)
        }
        break
      }
      case 'request/header': {
        // The tool catalogue the request advertised. Read here so a later
        // `tool/call` can carry the schema the model was shown at call time.
        const header = isObj(data) && isObj(data['header']) ? data['header'] : undefined
        const catalog = header !== undefined && Array.isArray(header['tools']) ? header['tools'] : undefined
        if (catalog !== undefined) {
          toolSchemas.clear()
          for (const candidate of catalog) {
            if (!isObj(candidate) || typeof candidate['name'] !== 'string') continue
            toolSchemas.set(candidate['name'], candidate)
          }
        }
        break
      }
      case 'assistant/message': {
        if (!isObj(data)) break
        const turn = typeof data['turn'] === 'number' ? data['turn'] : -1
        const step = typeof data['step'] === 'number' ? data['step'] : -1
        finalizedSteps.add(`${turn}:${step}`)
        live.delete(`${turn}:${step}`)
        const startedAt = stepStarts.get(`${turn}:${step}`)
        const message = data['message']
        const content = isObj(message) ? message['content'] : undefined
        const messageId = isObj(message) && typeof message['id'] === 'string' ? message['id'] : undefined
        const turnFiles = (produced.get(turn) ?? []).filter(file => file.seq <= seq).map(file => file.path)
        const seenFiles = new Set<string>()
        const producedFiles = turnFiles.filter(path => {
          if (seenFiles.has(path)) return false
          seenFiles.add(path)
          return true
        })
        // The step's own billing, read here because this is the event that
        // carries it; the turn's usage pill sums these across the turn.
        const usage = stepUsage(data)
        items.push({
          kind: 'assistant',
          key: `a${seq}`,
          seq,
          time,
          ...(turn >= 0 ? { turn } : {}),
          ...(step >= 0 ? { step } : {}),
          ...(messageId === undefined ? {} : { messageId }),
          text: blocksToText(content),
          reasoning: blocksToReasoning(content),
          interrupted: data['interrupted'] === true,
          producedFiles,
          ...(usage === null ? {} : { usage }),
          ...(startedAt === undefined ? {} : { startedAt }),
        })
        break
      }
      case 'tool/call': {
        if (!isObj(data)) break
        const callId = typeof data['callId'] === 'string' ? data['callId'] : `c${seq}`
        const turn = typeof data['turn'] === 'number' ? data['turn'] : -1
        const step = typeof data['step'] === 'number' ? data['step'] : -1
        const name = typeof data['name'] === 'string' ? data['name'] : 'tool'
        const schema = toolSchemas.get(name)
        const view = toolEventView(entry)
        const item: ConversationItem & { kind: 'tool' } = {
          kind: 'tool',
          key: `t${seq}`,
          seq,
          time,
          ...(turn >= 0 ? { turn } : {}),
          ...(step >= 0 ? { step } : {}),
          callId,
          name,
          args: typeof data['arguments'] === 'string' ? data['arguments'] : '',
          status: 'running',
          resultPreview: '',
          resultText: '',
          resultImages: [],
          callView: view.call,
          resultView: null,
          subCalls: [],
          startedAt: time,
          ...(schema === undefined ? {} : { schema }),
        }
        // The durable call supersedes the transient preparing row it completes.
        preparing.delete(callId)
        tools.set(callId, item)
        if (turn >= 0) toolTurns.set(callId, turn)
        items.push(item)
        /**
         * `present` declares the turn's deliverables, and the browser reads them
         * from the call's own arguments. The durable `deliverables/presented`
         * event is the same fact recorded later, so both sources feed one card
         * per path — whichever arrives first wins.
         */
        if (typeof data['name'] === 'string' && data['name'] === 'present') {
          const files = presentedFiles(typeof data['arguments'] === 'string' ? data['arguments'] : '')
          const fresh = files.filter(file => !delivered.has(file.path))
          for (const file of fresh) delivered.set(file.path, seq)
          if (fresh.length > 0) items.push({ kind: 'delivery', key: `d${seq}`, seq: seq + 0.5, time, files: fresh })
        }
        break
      }
      case 'tool/result': {
        if (!isObj(data)) break
        const message = data['message']
        const messageContent = isObj(message) ? message['content'] : undefined
        const messageSource = isObj(message) && isObj(message['source']) ? message['source'] : undefined
        const nestedResult = Array.isArray(messageContent)
          ? messageContent.find(block => isObj(block) && block['type'] === 'tool-result')
          : undefined
        const callId = isObj(message) && typeof message['toolCallId'] === 'string'
          ? message['toolCallId']
          : typeof messageSource?.['callId'] === 'string'
            ? messageSource.callId
            : isObj(nestedResult) && typeof nestedResult['toolCallId'] === 'string'
              ? nestedResult.toolCallId
              : undefined
        const target = callId === undefined ? undefined : tools.get(callId)
        if (target !== undefined) {
          target.status = isObj(data['error']) ? 'error' : 'done'
          // The result's own clock closes the row's duration.
          target.endedAt = time
          const content = toolResultBlocks(messageContent, callId)
          const text = blocksToText(content)
          target.resultPreview = truncate(text, 300)
          target.resultText = truncate(text, 5000)
          target.resultImages = blocksToImages(content)
          const view = toolEventView(entry)
          if (view.call !== null && target.callView === null) target.callView = view.call
          target.resultView = view.result
          const turn = callId === undefined ? undefined : toolTurns.get(callId)
          if (target.status !== 'error' && turn !== undefined) {
            const files = produced.get(turn) ?? []
            files.push(...producedPaths(view.result).map(path => ({ seq, path })))
            produced.set(turn, files)
          }
        }
        break
      }
      case 'assistant/chunk': {
        if (!isObj(data)) break
        const turn = typeof data['turn'] === 'number' ? data['turn'] : -1
        const step = typeof data['step'] === 'number' ? data['step'] : -1
        const id = `${turn}:${step}`
        const chunk = data['chunk']
        if (!isObj(chunk)) break
        // A named tool-call delta is the model announcing a call it has not
        // made yet. The web turns that gap into a "preparing" row so a long
        // argument stream does not look like a stalled turn.
        if (chunk['type'] === 'tool-call-delta') {
          const callId = typeof chunk['id'] === 'string' || typeof chunk['id'] === 'number' ? String(chunk['id']) : ''
          const name = typeof chunk['name'] === 'string' ? chunk['name'] : ''
          const delta = typeof chunk['argumentsDelta'] === 'string' ? chunk['argumentsDelta'] : ''
          const announced = callId === '' ? undefined : preparing.get(callId)
          if (callId !== '' && !tools.has(callId)) {
            // The first delta names the call; the rest only stream its
            // arguments, so a later delta adds to the row rather than dropping.
            if (announced === undefined) {
              if (name !== '') {
                preparing.set(callId, { seq, time, turn, step, callId, name, argsLength: delta.length })
              }
            } else if (delta !== '') {
              announced.argsLength += delta.length
            }
          }
          break
        }
        let buffer = live.get(id)
        if (buffer === undefined) {
          buffer = { seq, time, turn, step, text: '', reasoning: '' }
          live.set(id, buffer)
        }
        if (time > buffer.time) buffer.time = time
        if (chunk['type'] === 'text-delta' && typeof chunk['text'] === 'string') buffer.text += chunk['text']
        if (chunk['type'] === 'reasoning-delta' && typeof chunk['text'] === 'string') buffer.reasoning += chunk['text']
        break
      }
      case 'assistant/stream-end': {
        if (!isObj(data)) break
        const turn = typeof data['turn'] === 'number' ? data['turn'] : -1
        const step = typeof data['step'] === 'number' ? data['step'] : -1
        live.delete(`${turn}:${step}`)
        break
      }
      case 'turn/end': {
        // A cancelled turn may never finalize: its live buffer stays as the
        // delivered prefix (the host emits an interrupted assistant/message
        // when any content streamed, which clears the buffer itself).
        const turn = isObj(data) && typeof data['turn'] === 'number' ? data['turn'] : -1
        for (const [callId, entry] of preparing) {
          if (entry.turn === turn) preparing.delete(callId)
        }
        items.push({
          kind: 'turn-end',
          key: `te${turn}:${seq}`,
          seq,
          time,
          turn,
          reason: isObj(data) && isObj(data['reason']) && typeof data['reason']['kind'] === 'string'
            ? data['reason']['kind']
            : 'completed',
        })
        break
      }
      case 'turn/start': {
        const turn = isObj(data) && typeof data['turn'] === 'number' ? data['turn'] : -1
        if (turn >= 0) items.push({ kind: 'turn-start', key: `ts${turn}`, seq, time, turn })
        break
      }
      case 'tool/code-dispatch-start':
      case 'tool/code-dispatch': {
        if (!isObj(data)) break
        const parentCallId = typeof data['parentCallId'] === 'string' ? data['parentCallId'] : undefined
        const subCallId = typeof data['subCallId'] === 'string' ? data['subCallId'] : undefined
        if (parentCallId === undefined || subCallId === undefined || parentCallId === subCallId) break
        const isStart = type === 'tool/code-dispatch-start'
        const registeredParent = toolParents.get(subCallId)
        if (isStart) {
          if (toolParents.has(subCallId) || createsCycle(toolParents, parentCallId, subCallId)) break
        } else if (registeredParent !== undefined && registeredParent !== parentCallId) {
          break
        } else if (registeredParent === undefined && createsCycle(toolParents, parentCallId, subCallId)) {
          break
        }
        const rootId = tools.has(parentCallId) ? parentCallId : ancestorId(toolParents, parentCallId)
        const root = rootId === undefined ? undefined : tools.get(rootId)
        if (root === undefined) break
        const parent = findSubCall(root, parentCallId) ?? root
        const name = typeof data['name'] === 'string' ? data['name'] : 'tool'
        const args = stringifyArguments(data['arguments'])
        const siblings = parent.subCalls
        const at = siblings.findIndex(child => child.callId === subCallId)
        if (type === 'tool/code-dispatch-start') {
          if (at >= 0) break
          toolParents.set(subCallId, parentCallId)
          parent.subCalls = [...siblings, {
            callId: subCallId, name, args, seq, time, status: 'running',
            resultPreview: '', resultText: '', resultImages: [], subCalls: [],
          }]
          break
        }
        const isError = data['isError'] === true
        const resultText = truncate(blocksToText(data['content']), 5000)
        const resultImages = blocksToImages(data['content'])
        const existing = at === -1 ? undefined : siblings[at]
        const child: ToolSubCall = existing === undefined
          ? { callId: subCallId, name, args, seq, time, status: isError ? 'error' : 'done', resultPreview: truncate(resultText, 300), resultText, resultImages, subCalls: [] }
          : { ...existing, status: isError ? 'error' : 'done', resultPreview: truncate(resultText, 300), resultText, resultImages }
        toolParents.set(subCallId, parentCallId)
        parent.subCalls = at === -1 ? [...siblings, child] : siblings.map((candidate, index) => index === at ? child : candidate)
        break
      }
      case 'compaction/summary': {
        const compactionId = isObj(data) && typeof data['compactionId'] === 'string'
          ? data['compactionId']
          : `compaction-${seq}`
        const summary = isObj(data) && typeof data['summary'] === 'string' ? data['summary'] : '上下文已压缩'
        items.push({ kind: 'compaction', key: `compaction-${seq}`, seq, time, summary, compactionId })
        break
      }
      case 'deliverables/presented': {
        // The model's own declaration of what it delivered. Durable, so a
        // reload shows the same cards; the description is the model's copy.
        if (!isObj(data) || !Array.isArray(data['files'])) break
        const files: DeliveredFile[] = []
        for (const candidate of data['files']) {
          if (!isObj(candidate) || typeof candidate['path'] !== 'string' || candidate['path'] === '') continue
          if (delivered.has(candidate['path'])) continue
          const description = typeof candidate['description'] === 'string' && candidate['description'] !== ''
            ? candidate['description']
            : undefined
          files.push({ path: candidate['path'], ...(description === undefined ? {} : { description }) })
        }
        for (const file of files) delivered.set(file.path, seq)
        if (files.length > 0) items.push({ kind: 'delivery', key: `d${seq}`, seq, time, files })
        break
      }
      default:
        // Everything else is log-only bookkeeping (turn/step markers, todos,
        // usage…) and stays invisible — except an append-origin surface event
        // this client has no renderer for, which must not disappear silently.
        if (isUnclaimedSurfaceEvent(type, event['surfaceOp'])) {
          items.push({ kind: 'unknown', key: `x${seq}`, seq, time, eventType: String(type), data })
        }
        break
    }
  }

  /**
   * Live buffers are the newest state of a running turn, and their chunks are
   * transient: they carry no seq at all. Keeping the placeholder zero they were
   * created with sorted them in front of the whole transcript, so a turn's
   * reasoning and cursor rendered above the prompt they belong to — visible
   * only in the first moments of a turn, when the log holds no durable event of
   * that turn to anchor against. They sort behind every durable item instead,
   * in creation order.
   */
  if (options.running !== false) {
    let liveOffset = 0
    for (const buffer of live.values()) {
      if (finalizedSteps.has(`${buffer.turn}:${buffer.step}`)) continue
      const startedAt = stepStarts.get(`${buffer.turn}:${buffer.step}`)
      items.push({
        kind: 'stream',
        key: `s${buffer.turn}:${buffer.step}`,
        seq: LIVE_TAIL_SEQ + liveOffset++,
        time: buffer.time,
        ...(buffer.turn >= 0 ? { turn: buffer.turn } : {}),
        ...(buffer.step >= 0 ? { step: buffer.step } : {}),
        text: buffer.text,
        reasoning: buffer.reasoning,
        ...(startedAt === undefined ? {} : { startedAt }),
      })
    }
    /** Announced calls get the same tail treatment: they are the newest thing
     *  happening, so they belong after the durable log rather than wherever their
     *  seq-less chunk happened to arrive. */
    for (const entry of preparing.values()) {
      items.push({
        kind: 'preparing',
        key: `p${entry.callId}`,
        seq: LIVE_TAIL_SEQ + liveOffset++,
        time: entry.time,
        ...(entry.turn >= 0 ? { turn: entry.turn } : {}),
        ...(entry.step >= 0 ? { step: entry.step } : {}),
        callId: entry.callId,
        name: entry.name,
        argsLength: entry.argsLength,
      })
    }
  }
  items.sort((a, b) => a.seq - b.seq)
  return items
}

function extractContent(message: unknown): unknown {
  return isObj(message) ? message['content'] : undefined
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

type HistoryEntryLike = { view?: { for?: unknown; view?: unknown } }

function createsCycle(parents: Map<string, string>, parentCallId: string, subCallId: string): boolean {
  const visited = new Set([subCallId])
  let cursor: string | undefined = parentCallId
  while (cursor !== undefined) {
    if (visited.has(cursor)) return true
    visited.add(cursor)
    cursor = parents.get(cursor)
  }
  return false
}

function ancestorId(parents: Map<string, string>, callId: string): string | undefined {
  let cursor = parents.get(callId)
  while (cursor !== undefined) {
    if (parents.has(cursor)) cursor = parents.get(cursor)
    else return cursor
  }
  return undefined
}

function findSubCall(node: ToolSubCall, callId: string): ToolSubCall | undefined {
  for (const child of node.subCalls) {
    if (child.callId === callId) return child
    const nested = findSubCall(child, callId)
    if (nested !== undefined) return nested
  }
  return undefined
}
