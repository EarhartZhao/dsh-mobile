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
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from './preferences'

const store = (AsyncStorage as unknown as { __store: Map<string, string> }).__store
const KEY = 'dsh-mobile/preferences/v1'

describe('preferences', () => {
  beforeEach(() => { store.clear() })

  it('defaults to enter-to-send when nothing is stored', async () => {
    await expect(loadPreferences()).resolves.toEqual(DEFAULT_PREFERENCES)
    expect(DEFAULT_PREFERENCES.enterToSend).toBe(true)
  })

  it('round-trips the stored toggle', async () => {
    await savePreferences({ enterToSend: false })
    expect(store.get(KEY)).toBe(JSON.stringify({ enterToSend: false }))
    await expect(loadPreferences()).resolves.toEqual({ enterToSend: false })
  })

  it('falls back to the default on corrupt or partial documents', async () => {
    store.set(KEY, '{not json')
    await expect(loadPreferences()).resolves.toEqual(DEFAULT_PREFERENCES)
    store.set(KEY, JSON.stringify({ other: 1 }))
    await expect(loadPreferences()).resolves.toEqual(DEFAULT_PREFERENCES)
  })
})
