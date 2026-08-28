/**
 * Derives the renderable conversation from a session's event log. Defensive
 * by design: event payloads cross a shimmed type boundary, so every field is
 * narrowed at runtime. Live `assistant/chunk` buffers surface as `stream`
 * items and drop out the moment the durable `assistant/message` for their
 * step lands (the message is the authority; chunks are replay fidelity).
 */
import type { SessionState } from './session-store.ts'

export type ConversationItem =
  | { kind: 'user'; key: string; seq: number; text: string }
  | { kind: 'assistant'; key: string; seq: number; text: string; reasoning: string; interrupted: boolean }
  | { kind: 'tool'; key: string; seq: number; callId: string; name: string; args: string; status: 'running' | 'done' | 'error'; resultPreview: string }
  | { kind: 'stream'; key: string; seq: number; text: string; reasoning: string }

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

export function deriveConversation(session: SessionState): ConversationItem[] {
  const items: ConversationItem[] = []
  const live = new Map<string, ChunkBuffer>()
  const finalizedSteps = new Set<string>()
  const tools = new Map<string, ConversationItem & { kind: 'tool' }>()

  for (const { event } of session.events) {
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
        const text = isObj(data) ? blocksToText(extractContent(data['message'] ?? data)) : ''
        items.push({ kind: 'user', key: `u${seq}`, seq, text })
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
        items.push({
          kind: 'assistant',
          key: `a${seq}`,
          seq,
          text: blocksToText(content),
          reasoning: blocksToReasoning(content),
          interrupted: data['interrupted'] === true,
        })
        break
      }
      case 'tool/call': {
        if (!isObj(data)) break
        const callId = typeof data['callId'] === 'string' ? data['callId'] : `c${seq}`
        const item: ConversationItem & { kind: 'tool' } = {
          kind: 'tool',
          key: `t${seq}`,
          seq,
          callId,
          name: typeof data['name'] === 'string' ? data['name'] : 'tool',
          args: typeof data['arguments'] === 'string' ? data['arguments'] : '',
          status: 'running',
          resultPreview: '',
        }
        tools.set(callId, item)
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
          target.resultPreview = truncate(blocksToText(content), 300)
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
