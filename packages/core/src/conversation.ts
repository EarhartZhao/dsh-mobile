/**
 * Derives the renderable conversation from a session's event log. Defensive
 * by design: event payloads cross a shimmed type boundary, so every field is
 * narrowed at runtime. Live `assistant/chunk` buffers surface as `stream`
 * items and drop out the moment the durable `assistant/message` for their
 * step lands (the message is the authority; chunks are replay fidelity).
 */
import type { ToolCallView, ToolResultView } from '@dsh-mobile/protocol'
import type { SessionState } from './session-store.ts'

export type ConversationItem =
  | { kind: 'user'; key: string; seq: number; text: string; images: ConversationImage[] }
  | {
      kind: 'assistant'
      key: string
      seq: number
      text: string
      reasoning: string
      interrupted: boolean
      producedFiles: string[]
    }
  | { kind: 'compaction'; key: string; seq: number; summary: string; compactionId: string }
  | {
      kind: 'tool'
      key: string
      seq: number
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
    }
  | { kind: 'stream'; key: string; seq: number; text: string; reasoning: string }

export type ConversationImage =
  | { kind: 'data'; uri: string; name?: string | undefined }
  | { kind: 'attachment'; attachmentId: string; name?: string | undefined }

interface ChunkBuffer {
  seq: number
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
  status: 'running' | 'done' | 'error'
  resultPreview: string
  resultText: string
  resultImages: ConversationImage[]
  subCalls: ToolSubCall[]
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

export function deriveConversation(session: SessionState): ConversationItem[] {
  const items: ConversationItem[] = []
  const live = new Map<string, ChunkBuffer>()
  const finalizedSteps = new Set<string>()
  const tools = new Map<string, ConversationItem & { kind: 'tool' }>()
  const toolTurns = new Map<string, number>()
  const produced = new Map<number, { seq: number; path: string }[]>()
  const toolParents = new Map<string, string>()

  for (const entry of session.events) {
    const event = entry.event
    if (!isObj(event)) continue
    const seq = typeof event['seq'] === 'number' ? event['seq'] : 0
    const data: unknown = event['data']
    switch (event['type']) {
      case 'user/message': {
        // Only human-authored prompts render as bubbles. The harness also
        // logs injected context (skill catalogs, reminders, …) as
        // user/message with a non-user source kind; those are model-facing,
        // not conversation UI. Absent source = keep (defensive).
        // Wire shape: data is the message itself ({content, source, role, id}).
        if (isObj(data)) {
          const source = isObj(data['source']) ? data['source']
            : isObj(data['message']) && isObj((data['message'] as Record<string, unknown>)['source'])
              ? (data['message'] as Record<string, unknown>)['source']
              : undefined
          if (isObj(source) && typeof source['kind'] === 'string' && source['kind'] !== 'user') break
        }
        const content = isObj(data) ? extractContent(data['message'] ?? data) : undefined
        items.push({ kind: 'user', key: `u${seq}`, seq, text: blocksToText(content), images: blocksToImages(content) })
        break
      }
      case 'assistant/message': {
        if (!isObj(data)) break
        const turn = typeof data['turn'] === 'number' ? data['turn'] : -1
        const step = typeof data['step'] === 'number' ? data['step'] : -1
        finalizedSteps.add(`${turn}:${step}`)
        live.delete(`${turn}:${step}`)
        const message = data['message']
        const content = isObj(message) ? message['content'] : undefined
        const turnFiles = (produced.get(turn) ?? []).filter(file => file.seq <= seq).map(file => file.path)
        const seenFiles = new Set<string>()
        const producedFiles = turnFiles.filter(path => {
          if (seenFiles.has(path)) return false
          seenFiles.add(path)
          return true
        })
        items.push({
          kind: 'assistant',
          key: `a${seq}`,
          seq,
          text: blocksToText(content),
          reasoning: blocksToReasoning(content),
          interrupted: data['interrupted'] === true,
          producedFiles,
        })
        break
      }
      case 'tool/call': {
        if (!isObj(data)) break
        const callId = typeof data['callId'] === 'string' ? data['callId'] : `c${seq}`
        const turn = typeof data['turn'] === 'number' ? data['turn'] : -1
        const view = toolEventView(entry)
        const item: ConversationItem & { kind: 'tool' } = {
          kind: 'tool',
          key: `t${seq}`,
          seq,
          callId,
          name: typeof data['name'] === 'string' ? data['name'] : 'tool',
          args: typeof data['arguments'] === 'string' ? data['arguments'] : '',
          status: 'running',
          resultPreview: '',
          resultText: '',
          resultImages: [],
          callView: view.call,
          resultView: null,
          subCalls: [],
        }
        tools.set(callId, item)
        if (turn >= 0) toolTurns.set(callId, turn)
        items.push(item)
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
        let buffer = live.get(id)
        if (buffer === undefined) {
          buffer = { seq, turn, step, text: '', reasoning: '' }
          live.set(id, buffer)
        }
        if (chunk['type'] === 'text-delta' && typeof chunk['text'] === 'string') buffer.text += chunk['text']
        if (chunk['type'] === 'reasoning-delta' && typeof chunk['text'] === 'string') buffer.reasoning += chunk['text']
        break
      }
      case 'turn/end': {
        // A cancelled turn may never finalize: its live buffer stays as the
        // delivered prefix (the host emits an interrupted assistant/message
        // when any content streamed, which clears the buffer itself).
        break
      }
      case 'tool/code-dispatch-start':
      case 'tool/code-dispatch': {
        if (!isObj(data)) break
        const parentCallId = typeof data['parentCallId'] === 'string' ? data['parentCallId'] : undefined
        const subCallId = typeof data['subCallId'] === 'string' ? data['subCallId'] : undefined
        if (parentCallId === undefined || subCallId === undefined || parentCallId === subCallId) break
        const isStart = event['type'] === 'tool/code-dispatch-start'
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
        if (event['type'] === 'tool/code-dispatch-start') {
          if (at >= 0) break
          toolParents.set(subCallId, parentCallId)
          parent.subCalls = [...siblings, {
            callId: subCallId, name, args, seq, status: 'running',
            resultPreview: '', resultText: '', resultImages: [], subCalls: [],
          }]
          break
        }
        const isError = data['isError'] === true
        const resultText = truncate(blocksToText(data['content']), 5000)
        const resultImages = blocksToImages(data['content'])
        const existing = at === -1 ? undefined : siblings[at]
        const child: ToolSubCall = existing === undefined
          ? { callId: subCallId, name, args, seq, status: isError ? 'error' : 'done', resultPreview: truncate(resultText, 300), resultText, resultImages, subCalls: [] }
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
        items.push({ kind: 'compaction', key: `compaction-${seq}`, seq, summary, compactionId })
        break
      }
      default:
        break // turn/step markers, todos, usage… not rendered in v1
    }
  }

  for (const buffer of live.values()) {
    if (finalizedSteps.has(`${buffer.turn}:${buffer.step}`)) continue
    items.push({ kind: 'stream', key: `s${buffer.turn}:${buffer.step}`, seq: buffer.seq, text: buffer.text, reasoning: buffer.reasoning })
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
