/** Mobile-only per-message feedback face.
 *
 * dsh 0.1.5 exposes `messageFeedback/list|put|delete` as a versioned
 * compare-and-set store over the Session log: like/dislike is a durable
 * business fact, not a local UI state. The host answers with a business result
 * (`{ok:true|false}`) rather than a Remote error, so callers inspect the union
 * instead of catching.
 */
import { callMobileRemote } from './mobile-commands.ts'
import type { NatsConnLike, NatsHeadersFactory } from './nats-types.ts'

export type MobileFeedbackRating = 'positive' | 'negative'

/** One current rating of one assistant message. */
export interface MobileFeedbackItem {
  messageId: string
  rating: MobileFeedbackRating
  note?: string
  category?: string
  /** Equality-only token; every material change replaces it. */
  version: string
  createdAt: number
  updatedAt: number
}

/** Business failures the host reports instead of throwing. */
export interface MobileFeedbackError {
  code: 'session-not-found' | 'target-not-found' | 'version-conflict' | 'note-blank' | 'note-too-large'
  /** Authoritative item after a version conflict; null when there is none. */
  current?: MobileFeedbackItem | null
  sessionId?: string
  messageId?: string
  maxBytes?: number
  actualBytes?: number
}

export type MobileFeedbackResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MobileFeedbackError }

export interface MobileMessageFeedback {
  list(payload: { sessionId: string }): Promise<MobileFeedbackResult<{ items: MobileFeedbackItem[] }>>
  /** `ifVersion: null` requires that no rating exists yet. */
  put(payload: {
    sessionId: string
    messageId: string
    rating: MobileFeedbackRating
    note?: string
    category?: string
    ifVersion: string | null
  }): Promise<MobileFeedbackResult<MobileFeedbackItem>>
  delete(payload: {
    sessionId: string
    messageId: string
    ifVersion: string
  }): Promise<MobileFeedbackResult<{ absent: true }>>
}

export function createMobileMessageFeedback(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  getToken: () => string | undefined,
): MobileMessageFeedback {
  const call = async <T>(method: string, payload: unknown): Promise<T> => {
    const token = getToken()
    if (token === undefined) throw new Error('connection not ready')
    return callMobileRemote<T>(conn, headersFactory, instanceId, method, payload, token, 20_000)
  }
  return {
    list: payload => call('feedback.list', payload),
    put: payload => call('feedback.put', payload),
    delete: payload => call('feedback.delete', payload),
  }
}
