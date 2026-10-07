import { runDurationLabel, stepActivityLabel, toolDisplayName, toolRowVariant } from './ui-labels'
import type { TranslationKey } from './i18n'

/**
 * The composition rules are what this test pins; the copy itself lives in the
 * dictionaries. Only the keys these functions read are needed.
 */
const copy: Partial<Record<TranslationKey, string>> = {
  'chat.step.read': '正在读取文件',
  'chat.step.commands': '正在运行命令',
  'chat.step.thinking': '正在分析请求',
  'chat.step.prepare.commands': '准备运行命令',
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

describe('stepActivityLabel', () => {
  it('names the phase a call is in, for the live row only', () => {
    expect(stepActivityLabel('read', 'running', t)).toBe('正在读取文件')
    expect(stepActivityLabel('commands', 'preparing', t)).toBe('准备运行命令')
    expect(stepActivityLabel('thinking', 'running', t)).toBe('正在分析请求')
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

describe('toolRowVariant', () => {
  it('classifies a tool the way the web\u2019s own table does', () => {
    // The exact-name table ported from the web's `classifyTool`: a read-family
    // call wears the browse glyph, a shell call the api glyph, and anything
    // unrecognized the sparkle fallback.
    expect(toolRowVariant('read')).toBe('read')
    expect(toolRowVariant('read_image')).toBe('read')
    expect(toolRowVariant('web_fetch')).toBe('read')
    expect(toolRowVariant('grep')).toBe('search')
    expect(toolRowVariant('bash')).toBe('bash')
    expect(toolRowVariant('pwsh')).toBe('bash')
    expect(toolRowVariant('edit')).toBe('edit')
    expect(toolRowVariant('run_code')).toBe('code')
    expect(toolRowVariant('some_plugin_tool')).toBe('others')
  })
})
