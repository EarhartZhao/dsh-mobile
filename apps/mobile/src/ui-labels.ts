/** Chinese labels for fixed host identifiers shown as ordinary UI text. */
const commonLabels: Record<string, string> = {
  default: '默认',
  low: '低',
  medium: '中',
  high: '高',
  max: '最高',
}

export function commonLabel(value: string): string {
  return commonLabels[value.toLowerCase()] ?? value
}

const toolLabels: Record<string, string> = {
  bash: '命令行',
  pwsh: 'PowerShell',
  powershell: 'PowerShell',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  glob: '查找文件',
  grep: '搜索内容',
  web_search: '网络搜索',
  skill: '技能',
  subagent: '子代理',
  todo_write: '更新计划',
  str_replace_editor: '文件编辑器',
}

export function toolDisplayName(name: string): string {
  return toolLabels[name.toLowerCase()] ?? name
}

const jobKindLabels: Record<string, string> = {
  command: '命令',
  process: '进程',
  script: '脚本',
  terminal: '终端',
  task: '任务',
}

export function jobKindLabel(kind: string): string {
  return jobKindLabels[kind.toLowerCase()] ?? kind
}
