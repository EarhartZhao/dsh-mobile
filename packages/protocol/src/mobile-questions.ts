/**
 * Question frames, read wide.
 *
 * The frozen vendor schema validates a question item's `intent` as a strict
 * tagged union with exactly one arm (`plan-review`) and says why in its own
 * comment: "a tagged union on the wire, so an unknown tag is a rejected frame
 * rather than a silently generic render". That is the right rule for the *host*
 * — it must never let a client guess at an intent it does not understand.
 *
 * It is the wrong shape for a *client*, though. Rejecting the frame means the
 * user gets no card at all and no explanation: the turn is waiting on a question
 * that will never appear, and the only symptom is a session that looks stuck.
 * A client's honest options are "render what I understand" or "say what I don't",
 * never "show nothing".
 *
 * So this module is the tolerant re-read for that one payload shape, used as a
 * fallback when the frozen schema rejects a frame. `intent` stays a loose
 * `{ kind: string }`, every other field keeps the vendor shape, and the intent
 * vocabulary this client actually renders lives in {@link KNOWN_QUESTION_INTENTS}
 * — adding an arm there plus its card is what makes a new intent first-class,
 * and until then it degrades to the generic question card with a visible note.
 */

import { z } from 'zod'
import type { MuxFrame } from './vendor/api/index.ts'

/** One question option; unknown fields survive so a newer host keeps them. */
const mobileQuestionOptionSchema = z.looseObject({
  label: z.string(),
  description: z.string().optional(),
})

/** A question item as the host sends it, with `intent` deliberately unvalidated. */
export const mobileQuestionItemSchema = z.looseObject({
  id: z.string(),
  question: z.string(),
  header: z.string().optional(),
  detail: z.string().optional(),
  options: z.array(mobileQuestionOptionSchema).optional(),
  multiSelect: z.boolean().optional(),
  intent: z.looseObject({ kind: z.string() }).optional(),
})

/** The `question/requested` frame's own fields, unchanged from the vendor shape. */
export const mobileQuestionRequestSchema = z.object({
  type: z.literal('question/requested'),
  sessionId: z.string().min(1),
  questions: z.array(mobileQuestionItemSchema).min(1),
})

/** Intent kinds this client renders with a dedicated card. */
export const KNOWN_QUESTION_INTENTS: ReadonlySet<string> = new Set(['plan-review'])

/**
 * Re-read one rejected payload as a question frame.
 *
 * @param payload - the frame payload the frozen schema refused.
 * @returns the frame when the payload is a usable question request, else undefined
 *   so the caller keeps reporting the original rejection.
 */
export function salvageQuestionFrame(payload: unknown): MuxFrame | undefined {
  const parsed = mobileQuestionRequestSchema.safeParse(payload)
  // The vendor type declares the strict intent union; this read is deliberately
  // wider, so the cast is the seam. Every field the App's question card uses is
  // validated above.
  return parsed.success ? parsed.data as unknown as MuxFrame : undefined
}

/**
 * The intent kind one question item carries, when this client has no dedicated
 * card for it.
 *
 * @param item - one entry of a question frame's `questions`.
 * @returns the unrecognized kind, or undefined for a known or absent intent.
 */
export function unknownQuestionIntentKind(item: unknown): string | undefined {
  if (typeof item !== 'object' || item === null) return undefined
  const intent: unknown = Reflect.get(item, 'intent')
  if (typeof intent !== 'object' || intent === null) return undefined
  const kind: unknown = Reflect.get(intent, 'kind')
  if (typeof kind !== 'string' || kind === '') return undefined
  return KNOWN_QUESTION_INTENTS.has(kind) ? undefined : kind
}

/**
 * Every unrecognized intent kind in one question frame, in item order and
 * deduplicated — what the transport logs when it keeps a frame the frozen schema
 * would have dropped.
 *
 * @param frame - a parsed question frame.
 * @returns the unrecognized kinds; empty when the frame is fully understood.
 */
export function unknownQuestionIntentKinds(frame: unknown): string[] {
  if (typeof frame !== 'object' || frame === null) return []
  const questions: unknown = Reflect.get(frame, 'questions')
  if (!Array.isArray(questions)) return []
  const kinds: string[] = []
  for (const item of questions) {
    const kind = unknownQuestionIntentKind(item)
    if (kind !== undefined && !kinds.includes(kind)) kinds.push(kind)
  }
  return kinds
}
