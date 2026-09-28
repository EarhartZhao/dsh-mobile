import { describe, expect, it } from 'vitest'
import {
  normalizeDetail,
  reasoningDetail,
  reasoningPreview,
  summarizeActivity,
  toolActivity,
  toolCallDetail,
  type ActivityCall,
} from '../src/activity.ts'

function call(overrides: Partial<ActivityCall> & { callId: string; name: string }): ActivityCall {
  return {
    args: '',
    running: false,
    preparing: false,
    time: 0,
    subCalls: [],
    ...overrides,
  }
}

describe('toolActivity', () => {
  it('classifies by the recorded name with the web\'s exact table', () => {
    expect(toolActivity('read')).toBe('read')
    expect(toolActivity('read_image')).toBe('readImage')
    expect(toolActivity('grep')).toBe('search')
    expect(toolActivity('glob')).toBe('search')
    expect(toolActivity('write')).toBe('write')
    expect(toolActivity('edit')).toBe('edit')
    expect(toolActivity('apply_patch')).toBe('edit')
    expect(toolActivity('bash')).toBe('commands')
    expect(toolActivity('exec_command')).toBe('commands')
    expect(toolActivity('write_stdin')).toBe('commands')
    expect(toolActivity('terminal_inspect')).toBe('search')
    expect(toolActivity('run_code')).toBe('code')
    expect(toolActivity('web_search')).toBe('webSearch')
    expect(toolActivity('web_fetch')).toBe('webFetch')
    expect(toolActivity('subagent_codex')).toBe('subagents')
    expect(toolActivity('todo_write')).toBe('plan')
    expect(toolActivity('request_user_input')).toBe('questions')
    // Unknown and mis-cased names fall through to the generic category; the
    // web never folds case or strips a namespace.
    expect(toolActivity('Read')).toBe('tools')
    expect(toolActivity('functions.read')).toBe('tools')
    expect(toolActivity('mcp.read')).toBe('tools')
    expect(toolActivity('browser_inspect')).toBe('search')
    expect(toolActivity('job_output')).toBe('tools')
  })
})

describe('toolCallDetail', () => {
  it('takes the first usable field in the shared priority order', () => {
    expect(toolCallDetail('exec_command', JSON.stringify({ cmd: 'pnpm test', description: 'Run focused tests' })))
      .toBe('Run focused tests')
    expect(toolCallDetail('exec_command', JSON.stringify({ cmd: 'pnpm test' }))).toBe('pnpm test')
    expect(toolCallDetail('read', JSON.stringify({ file_path: 'src/app.ts', path: 'fallback.ts' }))).toBe('src/app.ts')
    expect(toolCallDetail('grep', JSON.stringify({ pattern: 'TODO', path: 'src' }))).toBe('TODO')
    expect(toolCallDetail('web_search', JSON.stringify({ queries: ['React hooks', 'external store'] })))
      .toBe('React hooks, external store')
    expect(toolCallDetail('web_fetch', JSON.stringify({ url: 'https://example.com' }))).toBe('https://example.com')
    // `questions` holds objects: the first nonempty question wins and headers
    // are ignored.
    expect(toolCallDetail('request_user_input', JSON.stringify({
      questions: [{ header: 'Scope', question: 'Which package?' }, { question: 'Which mode?' }],
    }))).toBe('Which package?')
  })

  it('falls back to the tool name rather than guessing at unusable arguments', () => {
    expect(toolCallDetail('run_code', JSON.stringify({ code: 'print(1)' }))).toBe('run_code')
    expect(toolCallDetail('web_search', JSON.stringify({ queries: [{ query: 'React' }] }))).toBe('web_search')
    expect(toolCallDetail('apply_patch', '*** Begin Patch')).toBe('apply_patch')
    expect(toolCallDetail('read', '{"file_path":')).toBe('read')
    expect(toolCallDetail('read', JSON.stringify({ description: ' ', command: 42, path: 'src/app.ts' }))).toBe('src/app.ts')
    expect(toolCallDetail('read', 'null')).toBe('read')
  })
})

describe('normalizeDetail', () => {
  it('collapses whitespace and caps the detail at the web\'s 160 characters', () => {
    expect(normalizeDetail('  run   focused\n tests ')).toBe('run focused tests')
    const long = 'a'.repeat(200)
    const capped = normalizeDetail(long)
    expect(capped).toHaveLength(160)
    expect(capped.endsWith('…')).toBe(true)
  })
})

describe('reasoningPreview', () => {
  it('previews the first line of the newest paragraph', () => {
    expect(reasoningPreview('first line\nrest of the thought')).toBe('first line')
    expect(reasoningPreview('older paragraph\n\nnewest line\nmore')).toBe('newest line')
    // An unfinished single line still previews: on a phone the row is the only
    // place a live thought appears.
    expect(reasoningPreview('streaming so far')).toBe('streaming so far')
    expect(reasoningPreview('**bold** start\nrest')).toBe('bold start')
    expect(reasoningPreview('   ')).toBe('')
  })
})

describe('reasoningDetail', () => {
  it('uses the newest nonempty paragraph with emphasis stripped', () => {
    expect(reasoningDetail('one\n\ntwo words')).toBe('two words')
    expect(reasoningDetail('**inspect** the   tree')).toBe('inspect the tree')
    expect(reasoningDetail('\n\n')).toBe('')
  })
})

describe('summarizeActivity', () => {
  it('ranks categories by distinct call count and keeps first appearance on ties', () => {
    const summary = summarizeActivity([
      call({ callId: 'a', name: 'bash' }),
      call({ callId: 'b', name: 'read' }),
      call({ callId: 'c', name: 'read' }),
    ], [])
    expect(summary.counts).toEqual([{ kind: 'read', count: 2 }, { kind: 'commands', count: 1 }])
  })

  it('counts a parent and its children separately and skips repeated call ids', () => {
    const summary = summarizeActivity([
      call({
        callId: 'root',
        name: 'run_code',
        subCalls: [
          call({ callId: 'leaf-read', name: 'read' }),
          call({ callId: 'leaf-bash', name: 'bash' }),
          // A repeated id — root or nested — counts once.
          call({ callId: 'leaf-read', name: 'read' }),
        ],
      }),
    ], [])
    expect(summary.counts.map(entry => entry.kind).sort()).toEqual(['code', 'commands', 'read'])
  })

  it('names the newest running call and falls back to the newest running thought', () => {
    const running = summarizeActivity([
      call({ callId: 'a', name: 'bash', args: '{"command":"pnpm test"}', running: true, time: 10 }),
      call({ callId: 'b', name: 'read', args: '{"file_path":"src/app.ts"}', running: true, time: 20 }),
    ], ['thinking'])
    expect(running.running).toBe('read')
    expect(running.runningDetail).toBe('src/app.ts')

    // A settled newer call hands the header back to the older running one.
    const older = summarizeActivity([
      call({ callId: 'a', name: 'bash', args: '{"command":"pnpm test"}', running: true, time: 10 }),
      call({ callId: 'b', name: 'read', args: '{"file_path":"src/app.ts"}', running: false, time: 20 }),
    ], [])
    expect(older.running).toBe('commands')
    expect(older.runningDetail).toBe('pnpm test')

    // Nothing in flight: the live detail is the newest nonempty thought.
    const idle = summarizeActivity([], ['earlier thought', '**working** through it'])
    expect(idle.running).toBeUndefined()
    expect(idle.runningDetail).toBe('working through it')
  })

  it('marks a preparing call and shows its name only for the generic category', () => {
    const generic = summarizeActivity([
      call({ callId: 'a', name: 'list_mcp_resources', running: true, preparing: true, time: 5 }),
    ], [])
    expect(generic.preparing).toBe(true)
    expect(generic.running).toBe('tools')
    expect(generic.runningDetail).toBe('list_mcp_resources')

    const specific = summarizeActivity([
      call({ callId: 'a', name: 'read', args: '{"file_path":"src/app.ts"}', running: true, preparing: true, time: 5 }),
    ], [])
    expect(specific.preparing).toBe(true)
    expect(specific.runningDetail).toBe('')
  })
})
