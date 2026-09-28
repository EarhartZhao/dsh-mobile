import { describe, expect, it } from 'vitest'
import {
  KNOWN_QUESTION_INTENTS,
  salvageQuestionFrame,
  unknownQuestionIntentKind,
  unknownQuestionIntentKinds,
} from '@dsh-mobile/protocol'

function questionFrame(intent: unknown): unknown {
  return {
    type: 'question/requested',
    sessionId: 's-1',
    questions: [{
      id: 'scope',
      question: 'Which surface should the refactor target?',
      header: 'Scope',
      options: [{ label: 'A', description: 'first' }, { label: 'B' }],
      ...(intent === undefined ? {} : { intent }),
    }],
  }
}

describe('salvageQuestionFrame', () => {
  it('re-reads a question frame the frozen schema would reject', () => {
    // The vendor schema models `intent` as a strict one-arm tagged union, so an
    // unknown tag rejects the whole frame and the user never sees the question.
    const salvaged = salvageQuestionFrame(questionFrame({ kind: 'diff-review', paths: ['a.ts'] }))

    expect(salvaged).toMatchObject({
      type: 'question/requested',
      sessionId: 's-1',
      questions: [{ id: 'scope', intent: { kind: 'diff-review', paths: ['a.ts'] } }],
    })
  })

  it('keeps the plan-review shape and a question without any intent', () => {
    expect(salvageQuestionFrame(questionFrame({ kind: 'plan-review', approve: 'Approve' })))
      .toMatchObject({ questions: [{ intent: { kind: 'plan-review', approve: 'Approve' } }] })
    expect(salvageQuestionFrame(questionFrame(undefined)))
      .toMatchObject({ questions: [{ id: 'scope' }] })
  })

  it('declines anything that is not a usable question request', () => {
    // A payload that is broken for other reasons must keep reporting the
    // original rejection rather than being accepted by the wide reader.
    expect(salvageQuestionFrame({ type: 'approval/requested', sessionId: 's-1' })).toBeUndefined()
    expect(salvageQuestionFrame({ type: 'question/requested', sessionId: 's-1', questions: [] })).toBeUndefined()
    expect(salvageQuestionFrame({ type: 'question/requested', sessionId: 's-1', questions: [{ question: 'no id' }] }))
      .toBeUndefined()
    expect(salvageQuestionFrame('not a frame')).toBeUndefined()
    expect(salvageQuestionFrame(null)).toBeUndefined()
  })
})

describe('question intent vocabulary', () => {
  it('names only the intents this client renders specially', () => {
    expect([...KNOWN_QUESTION_INTENTS]).toEqual(['plan-review'])
    expect(unknownQuestionIntentKind({ intent: { kind: 'plan-review', approve: 'x' } })).toBeUndefined()
    expect(unknownQuestionIntentKind({ intent: { kind: 'diff-review' } })).toBe('diff-review')
    expect(unknownQuestionIntentKind({})).toBeUndefined()
    expect(unknownQuestionIntentKind({ intent: { kind: '' } })).toBeUndefined()
    expect(unknownQuestionIntentKind(null)).toBeUndefined()
  })

  it('lists the unrendered kinds of one frame once each, in item order', () => {
    const frame = salvageQuestionFrame({
      type: 'question/requested',
      sessionId: 's-1',
      questions: [
        { id: 'a', question: 'A', intent: { kind: 'plan-review', approve: 'x' } },
        { id: 'b', question: 'B', intent: { kind: 'diff-review' } },
        { id: 'c', question: 'C', intent: { kind: 'diff-review' } },
        { id: 'd', question: 'D' },
      ],
    })

    expect(unknownQuestionIntentKinds(frame)).toEqual(['diff-review'])
    expect(unknownQuestionIntentKinds({ type: 'question/requested' })).toEqual([])
  })
})
