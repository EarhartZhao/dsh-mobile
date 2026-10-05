jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>()
  return {
    __store: store,
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store.set(key, value) }),
    removeItem: jest.fn(async (key: string) => { store.delete(key) }),
  }
})

// Only `Platform` is read, so the module is replaced wholesale and each test
// rewrites the two fields the name is built from.
jest.mock('react-native', () => ({ Platform: { OS: 'android', constants: {} } }))

import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { DEVICE_NAME_LIMIT, defaultDeviceName, loadDeviceName, saveDeviceName } from './device-name'

const store = (AsyncStorage as unknown as { __store: Map<string, string> }).__store
const platform = Platform as unknown as { OS: string, constants: Record<string, unknown> }
const KEY = 'dsh-mobile/device-name/v1'

describe('defaultDeviceName', () => {
  beforeEach(() => {
    platform.OS = 'android'
    platform.constants = {}
  })

  it('reads system, version and model off an Android device', () => {
    platform.constants = { Release: '16', Manufacturer: 'vivo', Model: 'V2405A' }
    expect(defaultDeviceName()).toBe('Android 16 · vivo V2405A')
  })

  it('drops missing constants instead of printing them', () => {
    platform.constants = { Release: '16' }
    expect(defaultDeviceName()).toBe('Android 16')
    platform.constants = { Model: 'V2405A' }
    expect(defaultDeviceName()).toBe('Android · V2405A')
    platform.constants = {}
    expect(defaultDeviceName()).toBe('Android')
  })

  it('names the iPhone and iPad idioms on iOS', () => {
    platform.OS = 'ios'
    platform.constants = { osVersion: '26.5', interfaceIdiom: 'phone' }
    expect(defaultDeviceName()).toBe('iOS 26.5 · iPhone')
    platform.constants = { osVersion: '26.5', interfaceIdiom: 'pad' }
    expect(defaultDeviceName()).toBe('iOS 26.5 · iPad')
    platform.constants = {}
    expect(defaultDeviceName()).toBe('iOS · iPhone')
  })

  it('never returns an empty name', () => {
    platform.OS = 'web'
    platform.constants = {}
    expect(defaultDeviceName()).toBe('web')
  })
})

describe('loadDeviceName', () => {
  beforeEach(() => { store.clear() })

  it('reports "never set" for a fresh install, so the default follows the device', async () => {
    await expect(loadDeviceName()).resolves.toBeNull()
  })

  it('reads back a plain stored name', async () => {
    store.set(KEY, 'Pixel 8 · Android 16')
    await expect(loadDeviceName()).resolves.toBe('Pixel 8 · Android 16')
  })

  it('also accepts the JSON encoding an older build could have written', async () => {
    store.set(KEY, JSON.stringify('我的手机'))
    await expect(loadDeviceName()).resolves.toBe('我的手机')
  })

  it('treats blank storage as "never set"', async () => {
    store.set(KEY, '   ')
    await expect(loadDeviceName()).resolves.toBeNull()
    store.set(KEY, JSON.stringify(''))
    await expect(loadDeviceName()).resolves.toBeNull()
  })
})

describe('saveDeviceName', () => {
  beforeEach(() => { store.clear() })

  it('stores a trimmed name', async () => {
    await saveDeviceName('  我的手机  ')
    expect(store.get(KEY)).toBe('我的手机')
  })

  it('truncates to what the plugin will keep', async () => {
    await saveDeviceName('x'.repeat(100))
    expect(store.get(KEY)).toHaveLength(DEVICE_NAME_LIMIT)
  })

  it('clears the override when emptied, restoring the default', async () => {
    await saveDeviceName('我的手机')
    await saveDeviceName('   ')
    expect(store.has(KEY)).toBe(false)
    await expect(loadDeviceName()).resolves.toBeNull()
  })
})
