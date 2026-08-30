/** Pending-question composer, adapted from Web's ui-user-questions flow. */
import React, { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { colors, fontSize, radius, spacing } from '../theme'
import { useI18n } from '../i18n'

export interface QuestionOptionView {
  label: string
  description?: string
}

export interface QuestionItemView {
  id: string
  question: string
  header?: string
  detail?: string
  options?: QuestionOptionView[]
  multiSelect?: boolean
  intent?: { kind: 'plan-review'; approve: string }
}

export interface PendingQuestionView {
  rpcId: string
  questions: unknown[]
}

export interface QuestionAnswerPayload {
  answers: { id: string; selected: string[]; custom?: string }[]
}

interface DraftAnswer {
  selected: string[]
  custom: string
  skipped: boolean
}

function isPlanReview(items: QuestionItemView[]): items is [QuestionItemView] {
  if (items.length !== 1) return false
  const item = items[0]
  if (item?.intent?.kind !== 'plan-review' || item.detail === undefined) return false
  if (item.multiSelect === true) return false
  const options = item.options ?? []
  return options.length <= 2 && options.some(option => option.label === item.intent?.approve)
}

function initialDrafts(items: QuestionItemView[]): DraftAnswer[] {
  return items.map(() => ({ selected: [], custom: '', skipped: false }))
}

function answered(draft: DraftAnswer): boolean {
  return draft.selected.length > 0 || draft.custom.trim() !== ''
}

function optionText(label: string): { label: string; recommended: boolean } {
  const match = /^(.+?)\s*[(（]推荐[)）]$/u.exec(label.trim())
  return match === null ? { label, recommended: false } : { label: match[1], recommended: true }
}

export function QuestionCard({ pending, onSubmit, onCancel }: {
  pending: PendingQuestionView
  onSubmit: (answer: QuestionAnswerPayload) => Promise<void>
  onCancel: () => Promise<void>
}): React.JSX.Element {
  const { t } = useI18n()
  const questions = useMemo(() => (Array.isArray(pending.questions)
    ? pending.questions.filter((item): item is QuestionItemView =>
        typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>)['id'] === 'string')
    : []), [pending])
  const [drafts, setDrafts] = useState<DraftAnswer[]>(() => initialDrafts(questions))
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState<'answer' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const question = questions[index]
  const review = isPlanReview(questions) ? questions[0] : null
  const reviewApprove = review?.options?.find(option => option.label === review.intent?.approve)
  const reviewDecline = review?.options?.find(option => option.label !== review.intent?.approve)

  const updateDraft = (questionId: string, update: (draft: DraftAnswer) => DraftAnswer): void => {
    setError(null)
    setDrafts(current => current.map((draft, draftIndex) =>
      questions[draftIndex]?.id === questionId ? update(draft) : draft))
  }

  const choose = (item: QuestionItemView, label: string): void => {
    updateDraft(item.id, current => {
      if (item.multiSelect === true) {
        return {
          ...current,
          selected: current.selected.includes(label)
            ? current.selected.filter(value => value !== label)
            : [...current.selected, label],
          skipped: false,
        }
      }
      return { selected: [label], custom: '', skipped: false }
    })
    if (item.multiSelect !== true && index < questions.length - 1) setIndex(index + 1)
  }

  const submitDrafts = async (values: DraftAnswer[]): Promise<void> => {
    const missing = values.findIndex(value => !answered(value) && !value.skipped)
    if (missing >= 0) {
      setIndex(missing)
      setError(t('question.needAnswer'))
      return
    }
    setBusy('answer')
    setError(null)
    try {
      await onSubmit({
        answers: questions.map((item, itemIndex) => {
          const value = values[itemIndex]
          if (value === undefined || value.skipped) return { id: item.id, selected: [] }
          const custom = value.custom.trim()
          return {
            id: item.id,
            selected: custom === '' || item.multiSelect === true ? value.selected : [],
            ...(custom === '' ? {} : { custom }),
          }
        }),
      })
    } catch (cause) {
      setBusy(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const continueFlow = async (): Promise<void> => {
    if (question === undefined) return
    const draft = drafts[index]
    if (draft === undefined || !answered(draft)) {
      setError(t('question.needChoice'))
      return
    }
    if (index < questions.length - 1) {
      setIndex(index + 1)
      setError(null)
      return
    }
    await submitDrafts(drafts)
  }

  const skipQuestion = async (): Promise<void> => {
    if (question === undefined) return
    const next = drafts.map((draft, draftIndex) =>
      draftIndex === index ? { selected: [], custom: '', skipped: true } : draft)
    setDrafts(next)
    setError(null)
    if (index < questions.length - 1) {
      setIndex(index + 1)
      return
    }
    await submitDrafts(next)
  }

  const cancel = async (): Promise<void> => {
    setBusy('cancel')
    setError(null)
    try {
      await onCancel()
    } catch (cause) {
      setBusy(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  if (questions.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.questionText}>{t('question.noDisplay')}</Text>
        <TouchableOpacity style={styles.secondaryButton} disabled={busy !== null} onPress={() => void cancel()}>
          <Text style={styles.secondaryText}>{t('common.close')}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (review !== null && reviewApprove !== undefined) {
    const decide = async (label: string): Promise<void> => {
      setBusy('answer')
      setError(null)
      try {
        await onSubmit({ answers: [{ id: review.id, selected: [label] }] })
      } catch (cause) {
        setBusy(null)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    return (
      <View style={styles.planCard}>
        <View style={styles.planStrip}>
          <View style={styles.planDot} />
          <Text style={styles.planStripText}>{t('question.planReview')}</Text>
        </View>
        <ScrollView style={styles.planBody} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          <Text style={styles.questionText}>{review.question}</Text>
          <Markdown style={markdownStyles}>{review.detail ?? ''}</Markdown>
        </ScrollView>
        {error !== null && <Text style={styles.error}>{error}</Text>}
        <View style={styles.row}>
          <TouchableOpacity style={styles.secondaryButton} disabled={busy !== null} onPress={() => void cancel()}>
            <Text style={styles.secondaryText}>{t('question.discuss')}</Text>
          </TouchableOpacity>
          {reviewDecline !== undefined && (
            <TouchableOpacity style={styles.secondaryButton} disabled={busy !== null} onPress={() => void decide(reviewDecline.label)}>
              <Text style={styles.secondaryText}>{t('question.decline')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.primaryButton, busy !== null && styles.disabled]} disabled={busy !== null} onPress={() => void decide(reviewApprove.label)}>
            <Text style={styles.primaryText}>{t('question.approve')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  if (question === undefined) return <View />
  const draft = drafts[index] ?? { selected: [], custom: '', skipped: true }
  const hasOptions = (question.options?.length ?? 0) > 0
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          {question.header !== undefined && <Text style={styles.eyebrow}>{question.header}</Text>}
          <Text style={styles.questionText}>{question.question}</Text>
          <Text style={styles.progress}>{index + 1} / {questions.length}</Text>
        </View>
        <TouchableOpacity disabled={busy !== null} onPress={() => void cancel()}>
          <Text style={styles.close}>{t('common.close')}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.body} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        {question.detail !== undefined && question.detail !== '' && (
          <Markdown style={markdownStyles}>{question.detail}</Markdown>
        )}
        {(question.options ?? []).map(option => {
          const selected = draft.selected.includes(option.label)
          const display = optionText(option.label)
          return (
            <TouchableOpacity
              key={option.label}
              style={[styles.option, selected && styles.optionActive]}
              disabled={busy !== null}
              onPress={() => choose(question, option.label)}
            >
              <View style={[styles.marker, question.multiSelect === true && styles.checkbox]}>
                {selected && <Text style={styles.markerText}>✓</Text>}
              </View>
              <View style={styles.optionCopy}>
                <View style={styles.optionLine}>
                  <Text style={styles.optionLabel}>{display.label}</Text>
                  {display.recommended && <Text style={styles.badge}>{t('question.recommended')}</Text>}
                </View>
                {option.description !== undefined && <Text style={styles.optionDescription}>{option.description}</Text>}
              </View>
            </TouchableOpacity>
          )
        })}
        {hasOptions ? (
          <View style={[styles.customRow, draft.custom !== '' && styles.customActive]}>
            <TextInput
              style={styles.customInput}
              value={draft.custom}
              editable={busy === null}
              placeholder={t('question.customPlaceholder')}
              placeholderTextColor={colors.textDim}
              onChangeText={value => updateDraft(question.id, current => ({
                ...current,
                selected: question.multiSelect === true ? current.selected : [],
                custom: value,
                skipped: false,
              }))}
              multiline
            />
          </View>
        ) : (
          <TextInput
            style={styles.customInput}
            value={draft.custom}
            editable={busy === null}
            placeholder={t('question.answerPlaceholder')}
            placeholderTextColor={colors.textDim}
            onChangeText={value => updateDraft(question.id, current => ({
              ...current,
              selected: question.multiSelect === true ? current.selected : [],
              custom: value,
              skipped: false,
            }))}
            multiline
          />
        )}
      </ScrollView>
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.secondaryButton, index === 0 && styles.disabled]}
          disabled={index === 0 || busy !== null}
          onPress={() => setIndex(index - 1)}
        >
          <Text style={styles.secondaryText}>{t('question.previous')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} disabled={busy !== null} onPress={() => void skipQuestion()}>
          <Text style={styles.secondaryText}>{t('question.skip')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, (!answered(draft) || busy !== null) && styles.disabled]}
          disabled={!answered(draft) || busy !== null}
          onPress={() => void continueFlow()}
        >
          <Text style={styles.primaryText}>{index === questions.length - 1 ? t('question.submit') : t('question.next')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.card,
    padding: spacing(3),
    gap: spacing(3),
  },
  planCard: {
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  planStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    backgroundColor: colors.bgBubbleUser,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
  },
  planDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning },
  planStripText: { color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
  planBody: { maxHeight: 220, padding: spacing(3), gap: spacing(2) },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(3) },
  headerText: { flex: 1 },
  eyebrow: { color: colors.textDim, fontSize: fontSize.tiny, marginBottom: spacing(1) },
  questionText: { color: colors.text, fontSize: fontSize.body, fontWeight: '600' },
  progress: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: spacing(1) },
  close: { color: colors.accent, fontSize: fontSize.small },
  body: { maxHeight: 280 },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: spacing(3),
    marginBottom: spacing(2),
    gap: spacing(3),
  },
  optionActive: { borderColor: colors.accent, backgroundColor: colors.bgBubbleUser },
  marker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: { borderRadius: 3 },
  markerText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  optionCopy: { flex: 1 },
  optionLine: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  optionLabel: { color: colors.text, fontSize: fontSize.small },
  badge: {
    color: colors.accent,
    fontSize: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: spacing(1.5),
  },
  optionDescription: { color: colors.textDim, fontSize: fontSize.tiny, marginTop: spacing(1) },
  customRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
  },
  customActive: { borderColor: colors.accent },
  customInput: {
    color: colors.text,
    fontSize: fontSize.small,
    minHeight: 44,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    textAlignVertical: 'top',
  },
  error: { color: colors.danger, fontSize: fontSize.small },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(2) },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(2), padding: spacing(3) },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.card,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2),
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2),
  },
  primaryText: { color: '#fff', fontSize: fontSize.small, fontWeight: '600' },
  secondaryText: { color: colors.textDim, fontSize: fontSize.small },
  disabled: { opacity: 0.5 },
})

const markdownStyles = StyleSheet.create({
  body: { color: colors.text, fontSize: fontSize.small, lineHeight: 20 },
  strong: { color: colors.text, fontWeight: '700' },
  link: { color: colors.accent },
  heading1: { color: colors.text, fontSize: fontSize.body, fontWeight: '700' },
  heading2: { color: colors.text, fontSize: fontSize.small, fontWeight: '700' },
  heading3: { color: colors.text, fontSize: fontSize.small, fontWeight: '600' },
})
