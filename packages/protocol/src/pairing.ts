/**
 * Pairing + reconnect-hook RPCs. Both are plugin-owned methods (they never
 * reach the host ApiProxy): `pair` redeems a one-time code into a device
 * token, `hello` nudges the plugin to re-publish pending answerable frames
 * after the app resubscribes. Envelopes are the same ClientRequest /
 * ServerResponse full forms as every other call.
 */

import { serverResponseSchema } from './vendor/api/rpc.schema.ts'
import { svcSubject, TOKEN_HEADER } from './subjects.ts'
import type { NatsConnLike, NatsHeadersFactory } from './nats-types.ts'

/** QR payload shown on the dsh host's settings card (docs/01-auth-pairing.md). */
export interface PairingQrPayload {
  hub: string
  user: string
  pass: string
  instance: string
  caFp: string
  code: string
}

export interface PairedDevice {
  token: string
  deviceId: string
  expiresAt: string
}

export class PairingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PairingError'
  }
}

function mintRpcId(): string {
  return crypto.randomUUID()
}

async function callPlugin(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  method: 'pair' | 'hello' | 'mobile.info' | 'mobile.inventory',
  payload: unknown,
  token: string | undefined,
  timeoutMs: number,
): Promise<unknown> {
  const headers = headersFactory()
  if (token !== undefined) headers.set(TOKEN_HEADER, token)
  const envelope = { type: 'client-request', rpcId: mintRpcId(), method, payload }
  const reply = await conn.request(
    svcSubject(instanceId, method),
    JSON.stringify(envelope),
    { timeout: timeoutMs, headers },
  )
  const full = serverResponseSchema.parse(JSON.parse(new TextDecoder().decode(reply.data)))
  if (!full.result.ok) {
    throw new PairingError(full.result.error.message)
  }
  return full.result.value
}

/**
 * Redeem a pairing code. The only call allowed without a device token
 * (docs/01). Failures come back as a uniform `mobile-pair-failed`.
 */
export async function redeemPairingCode(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  code: string,
  deviceName: string,
  timeoutMs = 10_000,
): Promise<PairedDevice> {
  const value = await callPlugin(conn, headersFactory, instanceId, 'pair', { code, deviceName }, undefined, timeoutMs)
  return value as PairedDevice
}

/**
 * Reconnect hook: after the app resubscribes to the evt subjects, ask the
 * plugin to re-publish the current pending approval/question set.
 */
export async function sendHello(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  token: string,
  timeoutMs = 10_000,
): Promise<void> {
  await callPlugin(conn, headersFactory, instanceId, 'hello', {}, token, timeoutMs)
}

/** Self-description returned by dsh-mobile-plugin v0.1 and newer. */
export interface MobilePluginInfo {
  pluginVersion: string
  mobileApi: number
  features: string[]
}

/** Read-only Loader entry projection served by mobile.inventory on plugin 0.2+. */
export interface MobileInventoryEntry {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
}

export interface MobileInventorySnapshot {
  entries: MobileInventoryEntry[]
}

/**
 * Reads the plugin's compatibility manifest. Older plugins do not answer
 * `mobile.info`; callers treat that failure as "unknown / too old" rather
 * than trying to infer the plugin version from host.describe.
 */
export async function fetchMobileInfo(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  token: string,
  timeoutMs = 5_000,
): Promise<MobilePluginInfo | null> {
  try {
    const value = await callPlugin(conn, headersFactory, instanceId, 'mobile.info', {}, token, timeoutMs)
    if (typeof value !== 'object' || value === null) return null
    const candidate = value as Partial<MobilePluginInfo>
    if (typeof candidate.pluginVersion !== 'string' || candidate.pluginVersion === '') return null
    if (typeof candidate.mobileApi !== 'number' || !Number.isInteger(candidate.mobileApi)) return null
    if (!Array.isArray(candidate.features) || !candidate.features.every(item => typeof item === 'string')) return null
    return {
      pluginVersion: candidate.pluginVersion,
      mobileApi: candidate.mobileApi,
      features: candidate.features,
    }
  } catch {
    return null
  }
}

/** Reads the optional read-only plugin inventory added by plugin 0.2+. */
export async function fetchMobileInventory(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  token: string,
  timeoutMs = 5_000,
): Promise<MobileInventorySnapshot | null> {
  try {
    const value = await callPlugin(conn, headersFactory, instanceId, 'mobile.inventory', {}, token, timeoutMs)
    if (typeof value !== 'object' || value === null || !Array.isArray((value as { entries?: unknown }).entries)) return null
    return value as MobileInventorySnapshot
  } catch {
    return null
  }
}
