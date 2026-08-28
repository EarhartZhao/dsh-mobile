/** Queue-dock selectors: preview text extraction for queued inbox items. */
import type { QueuedInboxItem } from '@dsh-mobile/protocol'

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Best-effort one-line preview of a queued message's text content. */
export function queuePreview(item: QueuedInboxItem): string {
  const message: unknown = item.message
  const content = isObj(message) ? message['content'] : undefined
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (isObj(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
        parts.push(block['text'])
      }
    }
    return parts.join('')
  }
  return ''
}

/** Placement label for the dock badge. */
export function placementLabel(placement: QueuedInboxItem['placement']): string {
  switch (placement) {
    case 'queued': return '排队'
    case 'steering': return '引导'
    case 'context': return '上下文'
  }
}
