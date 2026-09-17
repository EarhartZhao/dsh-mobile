/**
 * Mobile-only catalog face for skills and agent presets.
 *
 * The vendored client parses these responses with frozen zod schemas, and zod
 * strips keys a schema does not declare — so fields current hosts added after
 * the snapshot (a skill's `path`, an agent-preset roster's
 * `modeSelectionEnabled`) never reach the app through `client.skills` or
 * `client.agentPresets`. Reading them through the mobile layer keeps the wide
 * response parse, which is the whole point of these modules.
 *
 * Optional fields keep the pre-addition behavior for older hosts.
 */
import { callMobileRemote } from './mobile-commands.ts'
import type { NatsConnLike, NatsHeadersFactory } from './nats-types.ts'

/** One skill the host exposes to the Session's composer. */
export interface MobileSkillEntry {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
  /** Absolute SKILL.md path when the host's provider supplies one. */
  path?: string
}

/** One selectable agent preset. */
export interface MobileAgentPresetEntry {
  id: string
  trust: 'system' | 'user'
  isDefault: boolean
  name?: string
  description?: string
  broken?: string
}

/** The preset roster plus the host's selection policy. */
export interface MobileAgentPresetRoster {
  presets: MobileAgentPresetEntry[]
  authorable: boolean
  /** Absent on hosts older than dsh 0.1.6, where selection was always visible. */
  modeSelectionEnabled?: boolean
}

export interface MobileCatalog {
  skills(payload: { sessionId: string }): Promise<{ skills: MobileSkillEntry[] }>
  agentPresets(): Promise<MobileAgentPresetRoster>
}

/**
 * Whether visible mode selection governs new sessions. A host that never sent
 * the field behaved as enabled, so absence keeps that behavior.
 */
export function presetSelectionEnabled(roster: { modeSelectionEnabled?: boolean | undefined }): boolean {
  return roster.modeSelectionEnabled ?? true
}

export function createMobileCatalog(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  getToken: () => string | undefined,
): MobileCatalog {
  const call = async <T>(method: string, payload: unknown): Promise<T> => {
    const token = getToken()
    if (token === undefined) throw new Error('connection not ready')
    return callMobileRemote<T>(conn, headersFactory, instanceId, method, payload, token, 20_000)
  }
  return {
    skills: payload => call('skill.list', payload),
    agentPresets: () => call('agentPreset.list', {}),
  }
}
