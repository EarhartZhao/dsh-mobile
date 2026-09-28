import { runDurationLabel, stepActivityLabel, stepSummaryTitle, toolDisplayName } from './ui-labels'
import type { ProcessActivitySummary, ToolActivity } from '@dsh-mobile/core'
import type { TranslationKey } from './i18n'

/**
 * The composition rules are what this test pins; the copy itself lives in the
 * dictionaries. Only the keys these functions read are needed.
 */
const copy: Partial<Record<TranslationKey, string>> = {
  'chat.step.done.thinking': '已完成分析',
  'chat.step.done.read': '已读取文件',
  'chat.step.done.commands': '执行了命令',
  'chat.step.done.search': '已搜索代码',
  'chat.step.done.edit': '修改了文件',
  'chat.step.read': '正在读取文件',
  'chat.step.commands': '正在运行命令',
  'chat.step.thinking': '正在分析请求',
  'chat.step.prepare.commands': '准备运行命令',
  'chat.step.joinTwo': '{first}并{second}',
  'chat.step.comma': '，',
  'chat.step.sharedPrefix': '已',
  'chat.step.more': '{title}等',
  'chat.duration.seconds': '{seconds}秒',
  'chat.duration.minutes': '{minutes}分{seconds}秒',
  'chat.duration.hours': '{hours}小时{minutes}分{seconds}秒',
}

function t(key: TranslationKey, values?: Record<string, string | number>): string {
  const template = copy[key] ?? key
  if (values === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match)
}

function summary(...kinds: ToolActivity[]): ProcessActivitySummary {
  const counts = new Map<ToolActivity, number>()
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  return { counts: [...counts].map(([kind, count]) => ({ kind, count })), runningDetail: '', preparing: false }
}

describe('stepActivityLabel', () => {
  it('names the phase the call is in', () => {
    expect(stepActivityLabel('read', 'running', t)).toBe('正在读取文件')
    expect(stepActivityLabel('commands', 'preparing', t)).toBe('准备运行命令')
    expect(stepActivityLabel('read', 'done', t)).toBe('已读取文件')
    expect(stepActivityLabel('thinking', 'running', t)).toBe('正在分析请求')
    expect(stepActivityLabel('thinking', 'done', t)).toBe('已完成分析')
  })
})

describe('stepSummaryTitle', () => {
  it('uses the completed-analysis label when nothing was called', () => {
    expect(stepSummaryTitle(summary(), t)).toBe('已完成分析')
  })

  it('omits counts, names up to three categories, and drops the shared 已 in a pair', () => {
    expect(stepSummaryTitle(summary('read'), t)).toBe('已读取文件')
    // Both labels start with 已, so the second one loses it: the web's rule.
    expect(stepSummaryTitle(summary('read', 'commands'), t)).toBe('已读取文件并执行了命令')
    expect(stepSummaryTitle(summary('read', 'commands', 'search'), t))
      .toBe('已读取文件，执行了命令，已搜索代码')
    expect(stepSummaryTitle(summary('read', 'commands', 'search', 'edit'), t))
      .toBe('已读取文件，执行了命令，已搜索代码等')
  })
})

describe('runDurationLabel', () => {
  it('follows the web duration shapes', () => {
    expect(runDurationLabel(4_000, t)).toBe('4秒')
    expect(runDurationLabel(65_000, t)).toBe('1分05秒')
    expect(runDurationLabel(3_725_000, t)).toBe('1小时02分05秒')
  })
})

describe('toolDisplayName', () => {
  it('falls back to the wire name for a tool with no localized label', () => {
    expect(toolDisplayName('some_plugin_tool', t)).toBe('some_plugin_tool')
  })
})
