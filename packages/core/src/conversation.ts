/**
 * Derives the renderable conversation from a session's event log. Defensive
 * by design: event payloads cross a shimmed type boundary, so every field is
 * narrowed at runtime. Live `assistant/chunk` buffers surface as `stream`
 * items and drop out the moment the durable `assistant/message` for their
 * step lands (the message is the authority; chunks are replay fidelity).
 */
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
  | { kind: 'tool'; key: string; seq: number; callId: string; name: string; args: string; status: 'running' | 'done' | 'error'; resultPreview: string; resultText: string }
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
    const name = typeof block['name'] === 'string' ? block['name'] : undefined
    if (attachmentId !== undefined) images.push({ kind: 'attachment', attachmentId, name })
    else if (typeof block['data'] === 'string') images.push({ kind: 'data', uri: `data:${mediaType};base64,${block['data']}`, name })
  }
  return images
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

export function deriveConversation(session: SessionState): ConversationItem[] {
  const items: ConversationItem[] = []
  const live = new Map<string, ChunkBuffer>()
  const finalizedSteps = new Set<string>()
  const tools = new Map<string, ConversationItem & { kind: 'tool' }>()
  const toolTurns = new Map<string, number>()
  const produced = new Map<number, { seq: number; path: string }[]>()

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
        }
        tools.set(callId, item)
        if (turn >= 0) toolTurns.set(callId, turn)
        items.push(item)
        break
      }
      case 'tool/result': {
        if (!isObj(data)) break
        const message = data['message']
        const callId = isObj(message) && typeof message['toolCallId'] === 'string'
          ? message['toolCallId']
          : undefined
        const target = callId === undefined ? undefined : tools.get(callId)
        if (target !== undefined) {
          target.status = isObj(data['error']) ? 'error' : 'done'
          const content = isObj(message) ? message['content'] : undefined
          const text = blocksToText(content)
          target.resultPreview = truncate(text, 300)
          target.resultText = truncate(text, 5000)
          const resultView = typeof entry.view === 'object' && entry.view !== null && isObj((entry.view as Record<string, unknown>)['view'])
            ? (entry.view as Record<string, unknown>)['view']
            : undefined
          const turn = callId === undefined ? undefined : toolTurns.get(callId)
          if (target.status !== 'error' && turn !== undefined) {
            const files = produced.get(turn) ?? []
            files.push(...producedPaths(resultView).map(path => ({ seq, path })))
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
