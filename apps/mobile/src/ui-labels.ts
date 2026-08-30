/** Locale-aware labels for fixed host identifiers shown as ordinary UI text. */
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
