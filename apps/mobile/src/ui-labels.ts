/** Locale-aware labels for fixed host identifiers shown as ordinary UI text. */
import type { ToolActivity } from '@dsh-mobile/core'
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

/**
 * The shipped permission presets' product labels, ported from the Web's
 * `PRESET_LABEL_KEYS`: the host publishes machine values (`workspace-write`),
 * and the client owns the copy for the ones it ships.
 */
const permissionLabelKeys: Record<string, TranslationKey> = {
  'read-only': 'permission.readOnly',
  'workspace-write': 'permission.workspaceWrite',
  'danger-full-access': 'permission.fullAccess',
}

/** The English copy the host may publish as a preset's own name. */
const permissionDefaultNames: Record<string, string> = {
  'read-only': 'Read Only',
  'workspace-write': 'Workspace Write',
  'danger-full-access': 'Full access',
}

/**
 * Render a permission preset the way the Web does (`displayPermissionPreset`):
 * a shipped preset whose name is still its machine value resolves through the
 * dictionary, a host-configured preset that named itself keeps that name, and
 * any other kebab-case identifier reads as title case.
 */
export function permissionLabel(value: string, name: string, t: LabelTranslate): string {
  const key = permissionLabelKeys[value]
  if (key !== undefined && (name === value || name === permissionDefaultNames[value])) return t(key)
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)
    ? name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    : name
}

/**
 * The shipped agent presets' copy, ported from the Web's
 * `agent-preset-registry/display`: a preset that publishes no name is one the
 * client ships, so its label and description come from the dictionary and are
 * translated. A preset that named itself keeps its own words untranslated.
 */
const agentPresetKeys: Record<string, { name: TranslationKey; description: TranslationKey }> = {
  standard: { name: 'preset.standard.name', description: 'preset.standard.description' },
  ptc: { name: 'preset.ptc.name', description: 'preset.ptc.description' },
  minimal: { name: 'preset.minimal.name', description: 'preset.minimal.description' },
  cordis: { name: 'preset.cordis.name', description: 'preset.cordis.description' },
}

/**
 * Render one agent preset the way the Web does (`presetDisplayText`).
 * @param id - the preset's stable id, as the Session records it.
 * @param name - the name the host published, if the preset declared one.
 * @param t - active locale lookup.
 * @returns the localized name of a shipped preset, otherwise its own name or id.
 */
export function agentPresetLabel(id: string, name: string | undefined, t: LabelTranslate): string {
  const keys = name === undefined ? agentPresetKeys[id] : undefined
  return keys === undefined ? name ?? id : t(keys.name)
}

/**
 * The description that belongs with {@link agentPresetLabel}: shipped presets
 * carry their own copy, and a preset that declared one keeps it.
 */
export function agentPresetDescription(
  id: string,
  description: string | undefined,
  t: LabelTranslate,
): string | undefined {
  const keys = description === undefined ? agentPresetKeys[id] : undefined
  return keys === undefined ? description : t(keys.description)
}

/**
 * Tool-owned row titles, ported one for one from the Web's `TOOL_TITLE_KEYS`
 * (`tool-call-model.ts`): a tool that names its own act keeps that name whatever
 * family it belongs to. Everything else falls back to its variant's title, so a
 * phone row and a browser row read the same for the same call.
 */
const toolTitleKeys: Record<string, TranslationKey> = {
  pwsh: 'tool.title.pwsh',
  powershell: 'tool.title.pwsh',
  read_image: 'tool.title.readImage',
  web_fetch: 'tool.title.webFetch',
  grep: 'tool.title.grep',
  glob: 'tool.title.glob',
  web_search: 'tool.title.webSearch',
  todo_write: 'tool.title.todoWrite',
  ask_user_question: 'tool.title.askQuestion',
  create_goal: 'tool.title.createGoal',
  get_goal: 'tool.title.getGoal',
  update_goal: 'tool.title.updateGoal',
  schedule_create: 'tool.title.createSchedule',
  schedule_list: 'tool.title.listSchedules',
  schedule_delete: 'tool.title.deleteSchedule',
  schedule_update: 'tool.title.updateSchedule',
  cordis_package_inspect: 'tool.title.inspect',
  cordis_runtime_inspect: 'tool.title.inspect',
  cordis_run: 'tool.title.runCordis',
  cordis_stop: 'tool.title.stopCordis',
  cordis_undefine: 'tool.title.removeCordis',
  cordis_inspect_list: 'tool.title.inspectProviders',
  cordis_inspect_query: 'tool.title.queryRuntime',
  cordis_inspect_self: 'tool.title.inspectPlugins',
  workflow: 'tool.title.workflow',
  ralph: 'tool.title.ralph',
  session_event_read: 'tool.title.readEvent',
  session_event_search: 'tool.title.searchEvents',
  session_event_trace: 'tool.title.traceEvent',
  session_search: 'tool.title.searchSessions',
  session_trace: 'tool.title.traceSession',
  list_subagent_models: 'tool.title.listModels',
  subagent: 'tool.title.subagent',
  list_agents: 'tool.title.listAgents',
  send_message: 'tool.title.sendMessage',
  interrupt_agent: 'tool.title.interruptAgent',
  job_list: 'tool.title.listJobs',
  job_output: 'tool.title.readJob',
  job_kill: 'tool.title.killJob',
  terminal_open: 'tool.title.openTerminal',
  terminal_read: 'tool.title.readTerminal',
  terminal_list: 'tool.title.listTerminals',
  terminal_signal: 'tool.title.signalTerminal',
  terminal_close: 'tool.title.closeTerminal',
  lsp: 'tool.title.lsp',
  spawn_teammate: 'tool.title.spawnTeammate',
  team_task_create: 'tool.title.createTeamTask',
  team_task_get: 'tool.title.getTeamTask',
  team_task_update: 'tool.title.updateTeamTask',
  team_task_list: 'tool.title.listTeamTasks',
  wait_agent: 'tool.title.waitAgent',
  skill: 'tool.title.skill',
  str_replace_editor: 'tool.title.edit',
}

/** Variant titles, the Web's `VARIANT_TITLE_KEYS`. */
const variantTitleKeys: Record<ToolRowVariant, TranslationKey> = {
  search: 'tool.title.search',
  read: 'tool.title.read',
  bash: 'tool.title.bash',
  write: 'tool.title.write',
  edit: 'tool.title.edit',
  code: 'tool.title.code',
  others: 'tool.title.generic',
}

/** The generic row prefixes its own wire tool name (the Web's `tool.title.generic`). */
export function toolTitleIsGeneric(name: string): boolean {
  return toolTitleKeys[name] === undefined && toolRowVariant(name) === 'others'
}

/**
 * The localized title of one tool row: the tool's own name when it has one, else
 * its variant's, else the wire name for a tool this build has never heard of.
 */
export function toolDisplayName(name: string, t: LabelTranslate): string {
  const toolKey = toolTitleKeys[name]
  if (toolKey !== undefined) return t(toolKey)
  const variantKey = variantTitleKeys[toolRowVariant(name)]
  return variantKey === undefined ? name : t(variantKey)
}

/** One-line summary argument keys per variant (the Web's `SUMMARY_KEYS`). */
const summaryKeys: Record<ToolRowVariant, readonly string[]> = {
  bash: ['description', 'command'],
  read: ['path', 'file_path', 'url'],
  search: ['query', 'pattern', 'url'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  code: ['description'],
  others: [],
}

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The one-line summary a tool row shows beside its title, derived from the
 * call's own arguments exactly as the Web does (`deriveSummary`): a search's
 * `queries` array wins, then the variant's preferred keys, then any non-empty
 * string argument, and finally the raw argument text's first line. Unparseable
 * arguments (a truncated stream) fall back to that raw first line.
 * @param name - the wire tool name, which selects the variant.
 * @param args - the call's raw argument JSON.
 * @returns the summary text, empty when there is nothing to show.
 */
export function toolRowSummary(name: string, args: string): string {
  if (args === '') return ''
  const variant = toolRowVariant(name)
  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch {
    return firstLine(args)
  }
  if (!isRecordValue(parsed)) return firstLine(args)
  if (variant === 'search' && Array.isArray(parsed.queries)) {
    const queries = parsed.queries.filter(
      (query): query is string => typeof query === 'string' && query !== '',
    )
    if (queries.length > 0) return queries.map(firstLine).join(', ')
  }
  for (const key of summaryKeys[variant]) {
    const value = parsed[key]
    if (typeof value === 'string' && value !== '') return firstLine(value)
  }
  for (const value of Object.values(parsed)) {
    if (typeof value === 'string' && value !== '') return firstLine(value)
  }
  return firstLine(args)
}

/**
 * A token count in the Web's compact shape (`formatTokens` in
 * `SubagentHeaderLineage.tsx`): one decimal under 100K, whole numbers above,
 * where the decimal is dropped only once rounding to a whole number is honest
 * enough to read.
 * @param value - total tokens.
 * @returns the display text without the `tok` suffix.
 */
export function formatTokenCount(value: number): string {
  const scaled = (next: number): string =>
    next >= 100 ? String(Math.round(next)) : String(Math.round(next * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

/**
 * The entity-list tools whose row summary the Web derives from the *result*
 * rather than the arguments: `control-details-model.ts` parses the tool's own
 * line format (or a JSON array) and titles the row `N 个智能体` / `N 个后台任务`
 * / `N 个终端`. A result in any other shape is not that family and yields to
 * the ordinary argument-derived summary.
 */
const entityListTools: Record<string, {
  /** Marker line meaning "the list is empty". */
  empty: string
  /** One entity per line; every line must match for the count to be trusted. */
  line: RegExp
  key: TranslationKey
}> = {
  list_agents: {
    empty: '(no subagents)',
    line: /^(\S+) \[([^\]]+)\](?: parent=(\S+) depth=(\d+))?(?: — (.*))?$/u,
    key: 'tools.agentsCount',
  },
  job_list: {
    empty: '(no background jobs)',
    line: /^(\S+) \[([^\]]+)\] (\S+) — (.*)$/u,
    key: 'tools.jobsCount',
  },
  terminal_list: {
    empty: '(no terminal sessions)',
    line: /^(\S+)(?: \((.*?)\))? \[([^\]]+)\] (running|exited code=(\S+) signal=(\S+))(?: pid=(\d+))?$/u,
    key: 'tools.terminalsCount',
  },
}

/**
 * The summary an entity-list tool shows instead of its arguments.
 * @param name - the wire tool name.
 * @param resultText - the tool's flattened result text.
 * @param t - translator.
 * @returns the localized count, or undefined when this result is not a list
 *   this build can count (an unknown tool, or a shape it does not recognize).
 */
export function toolResultSummary(
  name: string,
  resultText: string,
  t: LabelTranslate,
): string | undefined {
  const family = entityListTools[name]
  if (family === undefined) return undefined
  const text = resultText.trim()
  if (text === family.empty) return t(family.key, { count: 0 })
  if (text === '') return undefined
  const lines = text.split('\n').map(line => line.trimEnd()).filter(line => line !== '')
  if (lines.length === 0 || !lines.every(line => family.line.test(line))) return undefined
  return t(family.key, { count: lines.length })
}

/** The web's tool-row variant: the family that decides a row's leading glyph. */
export type ToolRowVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others'

/**
 * Known tool name → row variant, ported verbatim from the web's `classifyTool`
 * (`tool-call-model.ts`): exact names, no case folding, no argument inference.
 */
const toolVariants: Record<string, ToolRowVariant> = {
  bash: 'bash',
  pwsh: 'bash',
  read: 'read',
  read_image: 'read',
  web_fetch: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  write: 'write',
  edit: 'edit',
  run_code: 'code',
  cordis_package_inspect: 'read',
  cordis_runtime_inspect: 'read',
  cordis_run: 'others',
  cordis_stop: 'others',
  cordis_undefine: 'others',
}

/**
 * Classify a wire tool name into its row variant.
 * @param name - the recorded tool name.
 * @returns the matching variant, `others` when unknown.
 */
export function toolRowVariant(name: string): ToolRowVariant {
  return toolVariants[name] ?? 'others'
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

/**
 * The label for the work happening right now: a running or announced step. A
 * settled turn's own row carries only the web's toggle text (elapsed time, or
 * why it stopped), so there is no completed-tense vocabulary here anymore — the
 * categories a turn worked through are what its disclosure contains, not a
 * title of their own.
 */
export function stepActivityLabel(
  activity: ToolActivity | 'thinking',
  phase: 'running' | 'preparing',
  t: LabelTranslate,
): string {
  if (activity === 'thinking') return t('chat.step.thinking')
  return phase === 'preparing' ? t(stepPreparing[activity]) : t(stepRunning[activity])
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

interface DurationParts {
  seconds: number
  minutes: number
  hours: number
  days: number
  totalMinutes: number
  totalHours: number
}

function splitDuration(ms: number): DurationParts {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  return {
    seconds: totalSeconds % 60,
    minutes: totalMinutes % 60,
    hours: totalHours % 24,
    days: Math.floor(totalHours / 24),
    totalMinutes,
    totalHours,
  }
}

/**
 * A duration with the Web's own decreasing precision at larger scales
 * (`formatDuration` in `SubagentHeaderLineage.tsx`): the same measurement reads
 * identically in both clients, down to the padded minutes and seconds an hour
 * shape carries.
 * @param ms - measured milliseconds.
 * @param t - translator.
 * @returns the compact display text.
 */
export function durationLabel(ms: number, t: LabelTranslate): string {
  const { seconds, minutes, hours, days, totalMinutes, totalHours } = splitDuration(ms)
  if (days >= 365) {
    const years = Math.floor(days / 365)
    const months = Math.floor((days % 365) / 30)
    return months === 0
      ? t('chat.duration.years', { years })
      : t('chat.duration.yearsMonths', { years, months })
  }
  if (days >= 30) {
    const months = Math.floor(days / 30)
    const remainingDays = days % 30
    return remainingDays === 0
      ? t('chat.duration.months', { months })
      : t('chat.duration.monthsDays', { months, days: remainingDays })
  }
  if (days > 0) {
    return hours === 0
      ? t('chat.duration.days', { days })
      : t('chat.duration.daysHours', { days, hours })
  }
  if (totalHours > 0) {
    return t('chat.duration.hours', {
      hours: totalHours,
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  if (totalMinutes > 0) {
    return t('chat.duration.minutes', {
      minutes: totalMinutes,
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  return t('chat.duration.seconds', { seconds })
}

/** The exact-seconds form a hover or an accessibility label uses past one day. */
export function exactDurationLabel(ms: number, t: LabelTranslate): string {
  const { seconds, minutes, hours, days } = splitDuration(ms)
  return days === 0
    ? durationLabel(ms, t)
    : t('chat.duration.exactDays', {
      days,
      hours: String(hours).padStart(2, '0'),
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
}
