/** Locale-aware labels for fixed host identifiers shown as ordinary UI text. */
import type { ProcessActivitySummary, ToolActivity } from '@dsh-mobile/core'
import type { TranslationKey } from './i18n'

export type LabelTranslate = (key: TranslationKey, values?: Record<string, string | number>) => string

const commonLabels: Record<string, TranslationKey> = {
  default: 'label.default',
  low: 'label.low',
  medium: 'label.medium',
  high: 'label.high',
  max: 'label.max',
}

export function commonLabel(value: string, t: LabelTranslate): string {
  const key = commonLabels[value.toLowerCase()]
  return key === undefined ? value : t(key)
}

const toolLabels: Record<string, TranslationKey> = {
  bash: 'tool.bash',
  pwsh: 'tool.powershell',
  powershell: 'tool.powershell',
  read: 'tool.read',
  write: 'tool.write',
  edit: 'tool.edit',
  glob: 'tool.glob',
  grep: 'tool.grep',
  web_search: 'tool.webSearch',
  skill: 'tool.skill',
  subagent: 'tool.subagent',
  todo_write: 'tool.todoWrite',
  str_replace_editor: 'tool.strReplaceEditor',
}

export function toolDisplayName(name: string, t: LabelTranslate): string {
  const key = toolLabels[name.toLowerCase()]
  return key === undefined ? name : t(key)
}

const jobKindLabels: Record<string, TranslationKey> = {
  command: 'jobKind.command',
  process: 'jobKind.process',
  script: 'jobKind.script',
  terminal: 'jobKind.terminal',
  task: 'jobKind.task',
}

export function jobKindLabel(kind: string, t: LabelTranslate): string {
  const key = jobKindLabels[kind.toLowerCase()]
  return key === undefined ? kind : t(key)
}

const stepRunning: Record<ToolActivity, TranslationKey> = {
  read: 'chat.step.read',
  readImage: 'chat.step.readImage',
  search: 'chat.step.search',
  write: 'chat.step.write',
  edit: 'chat.step.edit',
  commands: 'chat.step.commands',
  code: 'chat.step.code',
  webSearch: 'chat.step.webSearch',
  webFetch: 'chat.step.webFetch',
  subagents: 'chat.step.subagents',
  plan: 'chat.step.plan',
  questions: 'chat.step.questions',
  tools: 'chat.step.tools',
}

const stepPreparing: Record<ToolActivity, TranslationKey> = {
  read: 'chat.step.prepare.read',
  readImage: 'chat.step.prepare.readImage',
  search: 'chat.step.prepare.search',
  write: 'chat.step.prepare.write',
  edit: 'chat.step.prepare.edit',
  commands: 'chat.step.prepare.commands',
  code: 'chat.step.prepare.code',
  webSearch: 'chat.step.prepare.webSearch',
  webFetch: 'chat.step.prepare.webFetch',
  subagents: 'chat.step.prepare.subagents',
  plan: 'chat.step.prepare.plan',
  questions: 'chat.step.prepare.questions',
  tools: 'chat.step.prepare.tools',
}

const stepDone: Record<ToolActivity, TranslationKey> = {
  read: 'chat.step.done.read',
  readImage: 'chat.step.done.readImage',
  search: 'chat.step.done.search',
  write: 'chat.step.done.write',
  edit: 'chat.step.done.edit',
  commands: 'chat.step.done.commands',
  code: 'chat.step.done.code',
  webSearch: 'chat.step.done.webSearch',
  webFetch: 'chat.step.done.webFetch',
  subagents: 'chat.step.done.subagents',
  plan: 'chat.step.done.plan',
  questions: 'chat.step.done.questions',
  tools: 'chat.step.done.tools',
}

/** The label for the work happening right now, in whichever phase it is. */
export function stepActivityLabel(
  activity: ToolActivity | 'thinking',
  phase: 'running' | 'preparing' | 'done',
  t: LabelTranslate,
): string {
  if (activity === 'thinking') {
    return phase === 'done' ? t('chat.step.done.thinking') : t('chat.step.thinking')
  }
  if (phase === 'preparing') return t(stepPreparing[activity])
  if (phase === 'done') return t(stepDone[activity])
  return t(stepRunning[activity])
}

/**
 * A settled turn's title: its top three categories, joined the way the web
 * joins them. Counts are deliberately absent — the row is a summary of kinds of
 * work, and a turn that only thought reads as "已完成分析".
 */
export function stepSummaryTitle(summary: ProcessActivitySummary, t: LabelTranslate): string {
  const labels = summary.counts.slice(0, 3).map(({ kind }) => stepActivityLabel(kind, 'done', t))
  const first = labels[0]
  if (first === undefined) return t('chat.step.done.thinking')
  const second = labels[1]
  if (second === undefined) return first
  // English lowercases a continuation label; Chinese instead drops the shared
  // leading 已 when both labels start with it (the web's own rule).
  const continuation = (label: string): string => label.charAt(0).toLowerCase() + label.slice(1)
  if (labels.length === 2) {
    const prefix = t('chat.step.sharedPrefix')
    const shared = prefix !== '' && first.startsWith(prefix) && second.startsWith(prefix)
    return t('chat.step.joinTwo', { first, second: continuation(shared ? second.slice(prefix.length) : second) })
  }
  const title = [first, ...labels.slice(1).map(continuation)].join(t('chat.step.comma'))
  return summary.counts.length > 3 ? t('chat.step.more', { title }) : title
}

/** Elapsed time, in the web's own duration shapes. */
export function runDurationLabel(ms: number, t: LabelTranslate): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  if (hours > 0) return t('chat.duration.hours', { hours, minutes: String(minutes).padStart(2, '0'), seconds: String(seconds).padStart(2, '0') })
  return minutes > 0
    ? t('chat.duration.minutes', { minutes, seconds: String(seconds).padStart(2, '0') })
    : t('chat.duration.seconds', { seconds })
}
