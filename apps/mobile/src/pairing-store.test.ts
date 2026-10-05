jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>()
  return {
    __store: store,
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store.set(key, value) }),
    removeItem: jest.fn(async (key: string) => { store.delete(key) }),
  }
})

import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  EMPTY_PAIRING_STATE,
  activeProfile,
  hostStillUsed,
  loadPairingState,
  profileId,
  profileTitle,
  removeProfile,
  savePairingState,
  setActiveProfile,
  setProfileLabel,
  setProfileMachineName,
  upsertProfile,
  type PairingResult,
} from './pairing-store'

const store = (AsyncStorage as unknown as { __store: Map<string, string> }).__store
const KEY_V2 = 'dsh-mobile/pairing/v2'
const KEY_V1 = 'dsh-mobile/pairing/v1'

function result(overrides: Partial<PairingResult> = {}): PairingResult {
  return {
    hub: 'wss://hub.test:8443',
    user: 'c-end-test',
    pass: 'secret',
    instance: 'home',
    ca: 'CA-DER',
    caFp: 'AA:BB',
    token: 'token-1',
    deviceId: 'device-1',
    expiresAt: '2026-12-31T00:00:00.000Z',
    ...overrides,
  }
}

/** The `(hub, instance, user)` triple the store keys profiles by. */
function idOf(value: PairingResult): string {
  return profileId(value.hub, value.instance, value.user)
}

describe('pairing-store', () => {
  beforeEach(() => { store.clear() })

  describe('profileId', () => {
    it('keys on the triple the Hub routes on, ignoring surrounding space', () => {
      expect(profileId(' wss://hub.test:8443 ', ' home ', ' c-end-test ')).toBe('wss://hub.test:8443|home|c-end-test')
      // Same Hub, different instance and different account are different rows.
      expect(profileId('wss://hub.test:8443', 'home', 'a')).not.toBe(profileId('wss://hub.test:8443', 'home-mac', 'a'))
      expect(profileId('wss://hub.test:8443', 'home', 'a')).not.toBe(profileId('wss://hub.test:8443', 'home', 'b'))
    })
  })

  describe('loadPairingState', () => {
    it('is empty before anything is paired', async () => {
      await expect(loadPairingState()).resolves.toEqual(EMPTY_PAIRING_STATE)
    })

    it('reads back what savePairingState wrote', async () => {
      const state = upsertProfile(EMPTY_PAIRING_STATE, result())
      await savePairingState(state)
      expect(JSON.parse(store.get(KEY_V2)!).version).toBe(2)
      await expect(loadPairingState()).resolves.toEqual(state)
    })

    it('migrates the single-pairing v1 file and drops the legacy key', async () => {
      const legacy = { ...result(), id: 'ignored' }
      store.set(KEY_V1, JSON.stringify(legacy))

      const loaded = await loadPairingState()

      const id = idOf(legacy)
      expect(loaded.activeId).toBe(id)
      expect(loaded.profiles).toHaveLength(1)
      expect(loaded.profiles[0]).toMatchObject({ id, hub: legacy.hub, token: legacy.token, label: '' })
      // The v1 file holds a token, so only one copy may survive the migration.
      expect(store.has(KEY_V1)).toBe(false)
      expect(JSON.parse(store.get(KEY_V2)!).profiles).toHaveLength(1)
      // And the migration is idempotent: the legacy key is gone for good.
      await expect(loadPairingState()).resolves.toEqual(loaded)
    })

    it('drops records that could not produce a request', async () => {
      store.set(KEY_V2, JSON.stringify({
        version: 2,
        profiles: [
          { hub: 'wss://hub.test:8443', instance: 'home', user: 'a', token: 't1' },
          { hub: '', instance: 'home', user: 'a', token: 't1' },
          { hub: 'wss://hub.test:8443', instance: 'home', user: 'a', token: '' },
          'not an object',
        ],
        activeId: 'wss://hub.test:8443|home|a',
      }))

      const loaded = await loadPairingState()

      expect(loaded.profiles).toHaveLength(1)
      expect(loaded.activeId).toBe('wss://hub.test:8443|home|a')
    })

    it('repairs an active id that no longer names a saved profile', async () => {
      const first = upsertProfile(EMPTY_PAIRING_STATE, result())
      const second = upsertProfile(first, result({ instance: 'home-mac', user: 'c-end-test-2' }))
      store.set(KEY_V2, JSON.stringify({ version: 2, profiles: second.profiles, activeId: 'gone' }))

      const loaded = await loadPairingState()

      expect(loaded.activeId).toBe(second.profiles[0].id)
    })

    it('falls back to empty on a corrupt document', async () => {
      store.set(KEY_V2, '{not json')
      await expect(loadPairingState()).resolves.toEqual(EMPTY_PAIRING_STATE)
      store.set(KEY_V1, 'nope')
      await expect(loadPairingState()).resolves.toEqual(EMPTY_PAIRING_STATE)
    })
  })

  describe('upsertProfile', () => {
    it('appends a new connection and makes it active', () => {
      const state = upsertProfile(EMPTY_PAIRING_STATE, result(), '2026-01-01T00:00:00.000Z')

      expect(state.profiles).toHaveLength(1)
      expect(state.activeId).toBe(idOf(result()))
      expect(state.profiles[0]).toMatchObject({
        id: idOf(result()),
        label: '',
        machineName: '',
        addedAt: '2026-01-01T00:00:00.000Z',
        token: 'token-1',
      })
    })

    it('re-pairing the same triple replaces the token instead of adding a twin', () => {
      const first = upsertProfile(EMPTY_PAIRING_STATE, result(), '2026-01-01T00:00:00.000Z')
      const renamed = setProfileLabel(first, idOf(result()), '家里的 Mac')
      const again = upsertProfile(renamed, result({ token: 'token-2', expiresAt: '2027-01-01T00:00:00.000Z' }), '2026-06-01T00:00:00.000Z')

      expect(again.profiles).toHaveLength(1)
      expect(again.profiles[0]).toMatchObject({
        token: 'token-2',
        expiresAt: '2027-01-01T00:00:00.000Z',
        // The owner's name and the machine's own name survive a re-pair.
        label: '家里的 Mac',
        addedAt: '2026-01-01T00:00:00.000Z',
      })
      expect(again.activeId).toBe(idOf(result()))
    })

    it('keeps connections to different instances of the same Hub apart', () => {
      const first = upsertProfile(EMPTY_PAIRING_STATE, result())
      const second = upsertProfile(first, result({ instance: 'home-mac' }))

      expect(second.profiles).toHaveLength(2)
      expect(second.activeId).toBe(idOf(result({ instance: 'home-mac' })))
      expect(activeProfile(second)?.instance).toBe('home-mac')
    })
  })

  describe('removeProfile', () => {
    it('leaves the active connection alone when a neighbour goes', () => {
      const one = upsertProfile(EMPTY_PAIRING_STATE, result())
      const two = upsertProfile(one, result({ instance: 'home-mac' }))
      const active = setActiveProfile(two, idOf(result()))

      const next = removeProfile(active, idOf(result({ instance: 'home-mac' })))

      expect(next.profiles.map(profile => profile.id)).toEqual([idOf(result())])
      expect(next.activeId).toBe(idOf(result()))
    })

    it('moves the active id to a remaining neighbour', () => {
      const one = upsertProfile(EMPTY_PAIRING_STATE, result())
      const two = upsertProfile(one, result({ instance: 'home-mac' }))
      const three = upsertProfile(two, result({ instance: 'home-pc' }))
      const active = setActiveProfile(three, idOf(result({ instance: 'home-mac' })))

      const next = removeProfile(active, idOf(result({ instance: 'home-mac' })))

      expect(next.profiles).toHaveLength(2)
      expect(next.activeId).toBe(idOf(result({ instance: 'home-pc' })))
    })

    it('falls back to the last neighbour when the tail of the list goes', () => {
      const one = upsertProfile(EMPTY_PAIRING_STATE, result())
      const two = upsertProfile(one, result({ instance: 'home-mac' }))

      const next = removeProfile(two, idOf(result({ instance: 'home-mac' })))

      expect(next.activeId).toBe(idOf(result()))
    })

    it('clears the active id with the last connection', () => {
      expect(removeProfile(upsertProfile(EMPTY_PAIRING_STATE, result()), idOf(result()))).toEqual({
        profiles: [],
        activeId: null,
      })
    })

    it('is a no-op for an unknown id', () => {
      const state = upsertProfile(EMPTY_PAIRING_STATE, result())
      expect(removeProfile(state, 'gone')).toBe(state)
    })
  })

  describe('setActiveProfile', () => {
    it('switches to a saved connection', () => {
      const one = upsertProfile(EMPTY_PAIRING_STATE, result())
      const two = upsertProfile(one, result({ instance: 'home-mac' }))

      const next = setActiveProfile(two, idOf(result()))

      expect(activeProfile(next)?.instance).toBe('home')
    })

    it('ignores an id that is not saved', () => {
      const state = upsertProfile(EMPTY_PAIRING_STATE, result())
      expect(setActiveProfile(state, 'gone')).toBe(state)
    })
  })

  describe('labels and machine names', () => {
    it('prefers the owner label, then the machine name, then the instance', () => {
      const base = upsertProfile(EMPTY_PAIRING_STATE, result())
      const profile = base.profiles[0]

      expect(profileTitle(profile)).toBe('home')
      expect(profileTitle({ ...profile, machineName: '工作台 Mac' })).toBe('工作台 Mac')
      expect(profileTitle({ ...profile, machineName: '工作台 Mac', label: ' 我的手机 ' })).toBe('我的手机')
      // A whitespace-only label is not a name.
      expect(profileTitle({ ...profile, label: '   ' })).toBe('home')
    })

    it('trims and truncates a label, and clears it when emptied', () => {
      const base = upsertProfile(EMPTY_PAIRING_STATE, result())
      const id = base.profiles[0].id

      const named = setProfileLabel(base, id, '  long-name  ')
      expect(named.profiles[0].label).toBe('long-name')
      expect(setProfileLabel(base, id, 'x'.repeat(100)).profiles[0].label).toHaveLength(64)
      expect(setProfileLabel(named, id, '   ').profiles[0].label).toBe('')
    })

    it('records the machine name only when it actually changed', () => {
      const base = upsertProfile(EMPTY_PAIRING_STATE, result())
      const id = base.profiles[0].id

      const named = setProfileMachineName(base, id, ' 工作台 Mac ')
      expect(named.profiles[0].machineName).toBe('工作台 Mac')
      // Same name means no new state, so App.tsx does not rewrite storage.
      expect(setProfileMachineName(named, id, '工作台 Mac')).toBe(named)
      expect(setProfileMachineName(named, 'gone', 'x')).toBe(named)
      expect(setProfileMachineName(named, id, 'y'.repeat(100)).profiles[0].machineName).toHaveLength(64)
    })
  })

  describe('hostStillUsed', () => {
    it('is true while a sibling connection points at the same Hub', () => {
      const one = upsertProfile(EMPTY_PAIRING_STATE, result())
      const two = upsertProfile(one, result({ instance: 'home-mac' }))

      // Anchors live per host, so `home`'s certificate is still needed.
      expect(hostStillUsed(two, idOf(result()))).toBe(true)
    })

    it('is false for the last connection to a Hub', () => {
      const one = upsertProfile(EMPTY_PAIRING_STATE, result())
      const two = upsertProfile(one, result({ hub: 'wss://other.test:8443', instance: 'home' }))

      expect(hostStillUsed(two, idOf(result()))).toBe(false)
      expect(hostStillUsed(two, 'gone')).toBe(false)
    })
  })

})
