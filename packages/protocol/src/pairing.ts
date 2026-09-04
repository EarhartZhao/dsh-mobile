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
  method: 'pair' | 'hello' | 'mobile.info' | 'mobile.health' | 'mobile.inventory',
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
 * (docs/01). Invalid/expired codes return `mobile-pair-failed`; a full device
 * roster returns `mobile-device-limit` so the App can direct the user to
 * revoke an old device instead of regenerating another valid code.
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

/** Authenticated operational snapshot served by plugin 0.2+ health-check bridges. */
export interface MobileHealthSnapshot {
  status: 'ok'
  connection: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  devices: number
  pluginVersion: string
  mobileApi: number
  features: string[]
  buildId: string
  loadedFrom: string
  instanceId: string
  startedAt: string | null
  uptimeMs: number
  lastConnectedAt: string | null
  lastReconnectAt: string | null
  lastError: string | null
}

/**
 * Reads the plugin's compatibility manifest. Older bridges explicitly reject
 * `mobile.info`; callers treat that response as "unknown / too old" rather
 * than trying to infer the plugin version from host.describe. Transport and
 * authentication failures remain connection failures so an offline bridge is
 * never reported as an unknown plugin version.
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
    if (typeof value !== 'object' || value === null) throw new PairingError('mobile-info-invalid')
    const candidate = value as Partial<MobilePluginInfo>
    if (typeof candidate.pluginVersion !== 'string' || candidate.pluginVersion === '') throw new PairingError('mobile-info-invalid')
    if (typeof candidate.mobileApi !== 'number' || !Number.isInteger(candidate.mobileApi)) throw new PairingError('mobile-info-invalid')
    if (!Array.isArray(candidate.features) || !candidate.features.every(item => typeof item === 'string')) throw new PairingError('mobile-info-invalid')
    return {
      pluginVersion: candidate.pluginVersion,
      mobileApi: candidate.mobileApi,
      features: candidate.features,
    }
  } catch (error) {
    if (error instanceof PairingError && error.message === 'mobile-forbidden') return null
    throw error
  }
}

/** Reads the bridge's optional authenticated operational health snapshot. */
export async function fetchMobileHealth(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  token: string,
  timeoutMs = 5_000,
): Promise<MobileHealthSnapshot | null> {
  try {
    const value = await callPlugin(conn, headersFactory, instanceId, 'mobile.health', {}, token, timeoutMs)
    if (typeof value !== 'object' || value === null) throw new PairingError('mobile-health-invalid')
    const candidate = value as Partial<MobileHealthSnapshot>
    const validConnection = candidate.connection === 'connecting'
      || candidate.connection === 'connected'
      || candidate.connection === 'reconnecting'
      || candidate.connection === 'disconnected'
    const nullableString = (item: unknown): boolean => item === null || typeof item === 'string'
    if (candidate.status !== 'ok' || !validConnection
      || typeof candidate.pluginVersion !== 'string'
      || typeof candidate.mobileApi !== 'number' || !Number.isInteger(candidate.mobileApi)
      || !Array.isArray(candidate.features)
      || !candidate.features.every(item => typeof item === 'string')
      || typeof candidate.buildId !== 'string'
      || typeof candidate.loadedFrom !== 'string'
      || typeof candidate.instanceId !== 'string'
      || typeof candidate.devices !== 'number' || !Number.isInteger(candidate.devices) || candidate.devices < 0
      || typeof candidate.uptimeMs !== 'number' || !Number.isFinite(candidate.uptimeMs) || candidate.uptimeMs < 0
      || !nullableString(candidate.startedAt)
      || !nullableString(candidate.lastConnectedAt)
      || !nullableString(candidate.lastReconnectAt)
      || !nullableString(candidate.lastError)) {
      throw new PairingError('mobile-health-invalid')
    }
    return candidate as MobileHealthSnapshot
  } catch (error) {
    if (error instanceof PairingError && error.message === 'mobile-forbidden') return null
    throw error
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
