import React from 'react'
import renderer, { act } from 'react-test-renderer'

// The dictionary is not what these tests pin; the interpolated key + values are.
jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) => values === undefined
      ? key
      : Object.entries(values).map(([name, value]) => `${key}:${name}=${String(value)}`).join(','),
  }),
}))
jest.mock('react-native-markdown-display', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}))

import { QuestionCard } from './QuestionCard'

/**
 * Every distinct plain string rendered anywhere in the tree. react-test-renderer
 * reports both the composite and its host element, so the raw walk yields each
 * string twice; what a reader can see is the set.
 */
function texts(tree: renderer.ReactTestRenderer): string[] {
  return [...new Set(tree.root
    .findAll(node => typeof node.props?.children === 'string')
    .map(node => node.props.children as string))]
}

/** Press the innermost pressable whose subtree contains the given label. */
function press(tree: renderer.ReactTestRenderer, label: string): void {
  const button = tree.root.findAll(node =>
    typeof node.props.onPress === 'function' &&
    node.findAllByProps({ children: label }).length > 0,
  ).at(-1)
  act(() => { button!.props.onPress() })
}

function question(intent?: unknown) {
  return {
    id: 'scope',
    question: 'Which surface should the refactor target?',
    options: [{ label: 'TrajectoryTable.tsx' }, { label: 'The ui-chat render path' }],
    ...(intent === undefined ? {} : { intent }),
  }
}

describe('QuestionCard', () => {
  it('renders an intent this build has no card for as a plain, answerable question', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined)
    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(
        <QuestionCard
          pending={{ rpcId: 'r1', questions: [question({ kind: 'diff-review', paths: ['a.ts'] })] }}
          onSubmit={onSubmit}
          onCancel={jest.fn()}
        />,
      )
    })

    // The kind is named, so a reader is told why this does not look the way the
    // host intended instead of being left to guess.
    expect(texts(tree)).toContain('question.unknownIntent:kind=diff-review')
    expect(texts(tree)).toContain('Which surface should the refactor target?')
    expect(texts(tree)).toContain('TrajectoryTable.tsx')
    // It must not borrow the plan-review controls it has no intent for.
    expect(texts(tree)).not.toContain('question.approve')

    press(tree, 'TrajectoryTable.tsx')
    press(tree, 'question.submit')
    await act(async () => { await Promise.resolve() })
    expect(onSubmit).toHaveBeenCalledWith({
      answers: [{ id: 'scope', selected: ['TrajectoryTable.tsx'] }],
    })
  })

  it('keeps the plan-review takeover for the intent it owns', () => {
    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(
        <QuestionCard
          pending={{
            rpcId: 'r2',
            questions: [{
              ...question({ kind: 'plan-review', approve: 'Approve' }),
              detail: 'the plan',
              options: [{ label: 'Approve' }, { label: 'Keep planning' }],
            }],
          }}
          onSubmit={jest.fn()}
          onCancel={jest.fn()}
        />,
      )
    })

    expect(texts(tree)).toContain('question.planReview')
    expect(texts(tree)).toContain('question.approve')
    expect(texts(tree)).not.toContain('question.unknownIntent:kind=plan-review')
  })

  it('notes one unknown intent once across a batch, and still shows every question', () => {
    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(
        <QuestionCard
          pending={{
            rpcId: 'r3',
            questions: [
              { id: 'a', question: 'First?', options: [{ label: 'A' }], intent: { kind: 'matrix-pick' } },
              { id: 'b', question: 'Second?', options: [{ label: 'B' }], intent: { kind: 'matrix-pick' } },
            ],
          }}
          onSubmit={jest.fn()}
          onCancel={jest.fn()}
        />,
      )
    })

    const notes = texts(tree).filter(text => text.startsWith('question.unknownIntent'))
    expect(notes).toEqual(['question.unknownIntent:kind=matrix-pick'])
    expect(texts(tree)).toContain('First?')
    // The batch itself is intact: the second question is still reachable.
    expect(texts(tree)).toContain('question.next')
  })
})
