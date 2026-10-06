/**
 * Persisted connections: every Hub this install has paired with, plus which
 * one the app is currently using.
 *
 * One App talks to several computers, and each of them is a `(Hub, instance)`
 * pair with its own credentials, certificate and device token — so the unit
 * here is a {@link Profile}, not "the pairing". Switching is then just picking
 * another active id: the manager is rebuilt from whatever profile is active
 * (see App.tsx), and the native anchor store already keeps one certificate per
 * host, so two Hubs coexist without either losing its trust.
 *
 * AsyncStorage for the v1 skeleton; the storage interface is deliberately tiny
 * so swapping to react-native-keychain is a one-file change.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

/** What a successful pairing produces: the QR payload plus a device token. */
export interface PairingResult {
  hub: string
  user: string
  pass: string
  instance: string
  /** Stable gateway identity from the QR, when the plugin provides it. */
  gatewayId?: string
  gatewayName?: string
  /**
   * The Hub's CA certificate (base64 DER) as delivered by the QR. Trust for
   * `hub` comes from this, not from the build, so it has to outlive the
   * process: the native anchor is re-installed from here on every connect.
   */
  ca?: string
  caFp: string
  token: string
  deviceId: string
  expiresAt: string
  /** Per-device event subject segment; absent for pre-0.2.35 pairings. */
  eventKey?: string
  /** Stable app-install id associated with this pairing. */
  installationId?: string
}

/** One saved connection. */
export interface Profile extends PairingResult {
  /**
   * Identity of the connection, derived from the triple the Hub routes on: the
   * same Hub can host several instances, and the same instance can be reached
   * with different accounts. Re-pairing the same triple replaces its token
   * instead of leaving a dead twin in the list.
   */
  id: string
  /** Owner's chosen name; empty means "fall back to {@link machineName} / instance". */
  label: string
  /**
   * The name the machine reports for itself (`mobile.info`), cached so the
   * list still reads well while that Hub is offline.
   */
  machineName: string
  addedAt: string
}

export interface PairingState {
  profiles: Profile[]
  activeId: string | null
}

const KEY_V2 = 'dsh-mobile/pairing/v2'
const KEY_V1 = 'dsh-mobile/pairing/v1'

export const EMPTY_PAIRING_STATE: PairingState = { profiles: [], activeId: null }

/** The key a `(hub, instance, user)` triple is known by. */
export function profileId(hub: string, instance: string, user: string): string {
  return [hub.trim(), instance.trim(), user.trim()].join('|')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * One stored profile, or null when the record cannot be used. Anything that
 * cannot produce a request is dropped rather than kept as a row that fails on
 * every tap.
 */
function parseProfile(value: unknown): Profile | null {
  if (!isRecord(value)) return null
  const hub = typeof value.hub === 'string' ? value.hub : ''
  const instance = typeof value.instance === 'string' ? value.instance : ''
  const token = typeof value.token === 'string' ? value.token : ''
  if (hub === '' || instance === '' || token === '') return null
  const user = typeof value.user === 'string' ? value.user : ''
  return {
    // The id is derived, never read back: it has to equal the triple, or a
    // re-pair would add a second row for a machine already in the list.
    id: profileId(hub, instance, user),
    label: typeof value.label === 'string' ? value.label : '',
    machineName: typeof value.machineName === 'string' ? value.machineName : '',
    addedAt: typeof value.addedAt === 'string' ? value.addedAt : new Date(0).toISOString(),
    hub,
    user,
    pass: typeof value.pass === 'string' ? value.pass : '',
    instance,
    gatewayId: typeof value.gatewayId === 'string' ? value.gatewayId : undefined,
    gatewayName: typeof value.gatewayName === 'string' ? value.gatewayName : undefined,
    ca: typeof value.ca === 'string' ? value.ca : undefined,
    caFp: typeof value.caFp === 'string' ? value.caFp : '',
    token,
    deviceId: typeof value.deviceId === 'string' ? value.deviceId : '',
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : '',
    eventKey: typeof value.eventKey === 'string' && value.eventKey !== '' ? value.eventKey : undefined,
    installationId: typeof value.installationId === 'string' && value.installationId !== ''
      ? value.installationId
      : undefined,
  }
}

/** Loads the saved connections, migrating the single-pairing format in place. */
export async function loadPairingState(): Promise<PairingState> {
  const raw = await AsyncStorage.getItem(KEY_V2)
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as { profiles?: unknown, activeId?: unknown }
      const profiles = Array.isArray(parsed.profiles)
        ? parsed.profiles.map(parseProfile).filter((item): item is Profile => item !== null)
        : []
      const activeId = typeof parsed.activeId === 'string' && profiles.some(profile => profile.id === parsed.activeId)
        ? parsed.activeId
        : profiles[0]?.id ?? null
      return { profiles, activeId }
    } catch {
      return EMPTY_PAIRING_STATE
    }
  }

  const legacy = await AsyncStorage.getItem(KEY_V1)
  if (legacy === null) return EMPTY_PAIRING_STATE
  let migrated: PairingState = EMPTY_PAIRING_STATE
  try {
    const profile = parseProfile(JSON.parse(legacy))
    if (profile !== null) migrated = { profiles: [profile], activeId: profile.id }
  } catch {
    migrated = EMPTY_PAIRING_STATE
  }
  // The legacy key holds a token, so it goes away once it has been rewritten:
  // two copies of the same secret would outlive any reason for the second one.
  await savePairingState(migrated)
  await AsyncStorage.removeItem(KEY_V1)
  return migrated
}

export async function savePairingState(state: PairingState): Promise<void> {
  await AsyncStorage.setItem(KEY_V2, JSON.stringify({ version: 2, ...state }))
}

/** The profile the app should be talking to. */
export function activeProfile(state: PairingState): Profile | null {
  return state.profiles.find(profile => profile.id === state.activeId) ?? null
}

/**
 * What the list should print: the owner's name for it, else the machine's own,
 * else the instance id every connection is guaranteed to have.
 */
export function profileTitle(profile: Profile): string {
  if (profile.label.trim() !== '') return profile.label.trim()
  if (profile.machineName.trim() !== '') return profile.machineName.trim()
  return profile.instance
}

/**
 * Adds a freshly paired connection, or replaces the token of one that is
 * already saved, and makes it active. Re-pairing is how a rotated Hub
 * certificate or an expired token is fixed, so it must not create a second row
 * for the same machine.
 */
export function upsertProfile(state: PairingState, result: PairingResult, now = new Date().toISOString()): PairingState {
  const id = profileId(result.hub, result.instance, result.user)
  const existing = state.profiles.find(profile => profile.id === id)
  const profile: Profile = {
    ...result,
    id,
    label: existing?.label ?? '',
    machineName: existing?.machineName ?? '',
    addedAt: existing?.addedAt ?? now,
  }
  const profiles = existing === undefined
    ? [...state.profiles, profile]
    : state.profiles.map(item => (item.id === id ? profile : item))
  return { profiles, activeId: id }
}

/**
 * Drops one connection. The active id moves to a remaining neighbour so the
 * app lands somewhere usable; with none left it becomes null and the pairing
 * screen takes over.
 */
export function removeProfile(state: PairingState, id: string): PairingState {
  const index = state.profiles.findIndex(profile => profile.id === id)
  if (index === -1) return state
  const profiles = state.profiles.filter(profile => profile.id !== id)
  if (state.activeId !== id) return { profiles, activeId: state.activeId }
  const next = profiles[index] ?? profiles[index - 1] ?? null
  return { profiles, activeId: next?.id ?? null }
}

export function setActiveProfile(state: PairingState, id: string): PairingState {
  if (!state.profiles.some(profile => profile.id === id)) return state
  return { ...state, activeId: id }
}

/** Sets the owner's name for one connection; an empty label restores the default. */
export function setProfileLabel(state: PairingState, id: string, label: string): PairingState {
  const trimmed = label.trim().slice(0, 64)
  return {
    ...state,
    profiles: state.profiles.map(profile => (profile.id === id ? { ...profile, label: trimmed } : profile)),
  }
}

/**
 * Records the name a machine reports for itself. Called after every successful
 * connect, so a machine renamed in the plugin console fixes its row here too.
 */
export function setProfileMachineName(state: PairingState, id: string, machineName: string): PairingState {
  const trimmed = machineName.trim().slice(0, 64)
  const current = state.profiles.find(profile => profile.id === id)
  if (current === undefined || current.machineName === trimmed) return state
  return {
    ...state,
    profiles: state.profiles.map(profile => (profile.id === id ? { ...profile, machineName: trimmed } : profile)),
  }
}

/**
 * Whether the Hub of `id` is still needed, i.e. another saved connection points
 * at the same host. Anchors are stored per host, so removing the last
 * connection that used one is the only time the app may forget it — otherwise
 * deleting `home` would break a sibling `home-mac` on the same Hub.
 */
export function hostStillUsed(state: PairingState, id: string): boolean {
  const target = state.profiles.find(profile => profile.id === id)
  if (target === undefined) return false
  return state.profiles.some(profile => profile.id !== id && profile.hub === target.hub)
}
