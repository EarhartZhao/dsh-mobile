import { describe, expect, it } from 'vitest'
import { createMobileCatalog, createMobileWorkspaceAdmin, presetSelectionEnabled } from '@dsh-mobile/protocol'

function headers() {
  const values = new Map<string, string>()
  return {
    set(name: string, value: string) { values.set(name, value) },
    get(name: string) { return values.get(name) },
  }
}

function connection(reply: unknown, seen: { subject?: string; payload?: unknown; token?: string | undefined }) {
  return {
    async request(subject: string, body: string, options: { headers: { get?: (name: string) => string | undefined } }) {
      const envelope = JSON.parse(body) as { rpcId: string; payload: unknown }
      seen.subject = subject
      seen.payload = envelope.payload
      seen.token = options.headers.get?.('x-dsh-token')
      return { data: new TextEncoder().encode(JSON.stringify({
        type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: reply },
      })) }
    },
  } as never
}

describe('mobile workspace administration', () => {
  it('restores one archived session through the bridge method', async () => {
    const seen: { subject?: string; payload?: unknown; token?: string | undefined } = {}
    const value = { archivedSessionIds: ['other-1'] }
    const api = createMobileWorkspaceAdmin(connection(value, seen), headers, 'dsh-1', () => 'token-1')
    await expect(api.unarchiveSession({ sessionId: 's1' })).resolves.toEqual(value)
    expect(seen.subject).toBe('svc.dsh.dsh-1.workspace.unarchiveSession')
    expect(seen.payload).toEqual({ sessionId: 's1' })
    expect(seen.token).toBe('token-1')
  })

  it('refuses to call before the device token exists', async () => {
    const seen: { subject?: string } = {}
    const api = createMobileWorkspaceAdmin(connection({ archivedSessionIds: [] }, seen), headers, 'dsh-1', () => undefined)
    await expect(api.unarchiveSession({ sessionId: 's1' })).rejects.toThrow('connection not ready')
    expect(seen.subject).toBeUndefined()
  })
})

describe('mobile catalog (fields the frozen wire strips)', () => {
  it('keeps a skill source path the vendored schema would drop', async () => {
    const seen: { subject?: string; payload?: unknown } = {}
    const value = {
      skills: [{
        name: 'story',
        description: 'write',
        modelInvocable: true,
        path: 'E:\\Users\\u\\.agents\\skills\\story\\SKILL.md',
      }],
    }
    const api = createMobileCatalog(connection(value, seen), headers, 'dsh-1', () => 'token-1')
    await expect(api.skills({ sessionId: 's1' })).resolves.toEqual(value)
    expect(seen.subject).toBe('svc.dsh.dsh-1.skill.list')
    expect(seen.payload).toEqual({ sessionId: 's1' })
  })

  it('keeps the roster mode-selection policy', async () => {
    const seen: { subject?: string } = {}
    const value = { presets: [], authorable: false, modeSelectionEnabled: false }
    const api = createMobileCatalog(connection(value, seen), headers, 'dsh-1', () => 'token-1')
    await expect(api.agentPresets()).resolves.toEqual(value)
    expect(seen.subject).toBe('svc.dsh.dsh-1.agentPreset.list')
  })

  it('treats a host without the policy field as selection-enabled', () => {
    expect(presetSelectionEnabled({ modeSelectionEnabled: undefined })).toBe(true)
    expect(presetSelectionEnabled({})).toBe(true)
    expect(presetSelectionEnabled({ modeSelectionEnabled: false })).toBe(false)
    expect(presetSelectionEnabled({ modeSelectionEnabled: true })).toBe(true)
  })
})
