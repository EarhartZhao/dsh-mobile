import {
  durationLabel, formatTokenCount, runDurationLabel, stepActivityLabel, toolDisplayName,
  toolResultSummary, toolRowSummary, toolRowVariant, toolTitleIsGeneric,
} from './ui-labels'
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
  'chat.duration.days': '{days}天',
  'chat.duration.daysHours': '{days}天{hours}小时',
  'chat.duration.months': '约{months}个月',
  'chat.duration.monthsDays': '约{months}个月{days}天',
  'chat.duration.years': '约{years}年',
  'chat.duration.yearsMonths': '约{years}年{months}个月',
  'chat.duration.exactDays': '{days}天{hours}小时{minutes}分{seconds}秒',
  'tool.title.read': '读取',
  'tool.title.bash': '运行命令',
  'tool.title.write': '写入',
  'tool.title.search': '搜索',
  'tool.title.generic': '工具调用',
  'tool.title.grep': '搜索文件内容',
  'tool.title.pwsh': '运行命令',
  'tool.title.listAgents': '查看子智能体',
  'tools.agentsCount': '{count} 个智能体',
  'tools.jobsCount': '{count} 个后台任务',
  'tools.terminalsCount': '{count} 个终端',
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
  it('titles a row the way the web does: the tool\u2019s own name, else its variant', () => {
    // `toolTitleKey` in the web's `tool-call-model.ts`: a tool that names its own
    // act keeps it, and everything else reads as its family's title.
    expect(toolDisplayName('grep', t)).toBe('搜索文件内容')
    expect(toolDisplayName('list_agents', t)).toBe('查看子智能体')
    expect(toolDisplayName('read', t)).toBe('读取')
    expect(toolDisplayName('pwsh', t)).toBe('运行命令')
  })

  it('gives a tool this build has never heard of the generic vocabulary', () => {
    // The web shows `工具调用 · <wire name>` rather than nothing at all.
    expect(toolDisplayName('some_plugin_tool', t)).toBe('工具调用')
    expect(toolTitleIsGeneric('some_plugin_tool')).toBe(true)
    expect(toolTitleIsGeneric('list_agents')).toBe(false)
  })
})

describe('toolRowSummary', () => {
  it('derives the summary from the call\u2019s arguments, the web\u2019s own rule', () => {
    // `deriveSummary`: the variant's preferred key first, a search's `queries`
    // array ahead of everything, and any string argument as the last resort.
    expect(toolRowSummary('bash', '{"description":"Fetch the plan"}')).toBe('Fetch the plan')
    expect(toolRowSummary('bash', '{"command":"ls -la"}')).toBe('ls -la')
    expect(toolRowSummary('write', '{"path":"/tmp/report.md","content":"x"}')).toBe('/tmp/report.md')
    expect(toolRowSummary('web_search', '{"queries":["a","b"]}')).toBe('a, b')
    expect(toolRowSummary('read', '{"unknown":"value"}')).toBe('value')
  })

  it('keeps the first line of a partially streamed argument payload', () => {
    expect(toolRowSummary('bash', '{"command":"echo hi"\n')).toBe('{"command":"echo hi"')
    expect(toolRowSummary('bash', '')).toBe('')
  })
})

describe('toolResultSummary', () => {
  it('counts the entity-list tools from their own line format', () => {
    const agents = 'a1 [running] — 重庆区县经济数据\na2 [idle] — 服务业农业能源细分'
    expect(toolResultSummary('list_agents', agents, t)).toBe('2 个智能体')
    expect(toolResultSummary('list_agents', '(no subagents)', t)).toBe('0 个智能体')
    expect(toolResultSummary('job_list', 'j1 [running] command — build', t)).toBe('1 个后台任务')
    // The host's own line format, verbatim: `pty-2 (done) [shell] exited …`.
    const terminals = 'pty-1 [shell] running\npty-2 (done) [shell] exited code=2 signal=null pid=9'
    expect(toolResultSummary('terminal_list', terminals, t)).toBe('2 个终端')
  })

  it('yields to the argument summary for anything else', () => {
    // A shape this build cannot count must not claim a count.
    expect(toolResultSummary('list_agents', 'some prose', t)).toBeUndefined()
    expect(toolResultSummary('read', 'a1 [running] — x', t)).toBeUndefined()
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

describe('formatTokenCount', () => {
  it('follows the web\u2019s compact shape, one decimal only until 100K', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(882_000)).toBe('882K')
    expect(formatTokenCount(1_400_000)).toBe('1.4M')
    expect(formatTokenCount(12_500)).toBe('12.5K')
    expect(formatTokenCount(150_000)).toBe('150K')
  })
})

describe('durationLabel', () => {
  it('decreases its precision at larger scales, as the web does', () => {
    expect(durationLabel(4_000, t)).toBe('4秒')
    expect(durationLabel(151_000, t)).toBe('2分31秒')
    expect(durationLabel(3_725_000, t)).toBe('1小时02分05秒')
    expect(durationLabel(90_000_000, t)).toBe('1天1小时')
    expect(durationLabel(181_440_000, t)).toBe('2天2小时')
  })
})
