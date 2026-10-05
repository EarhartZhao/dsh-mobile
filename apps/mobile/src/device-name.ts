/**
 * What this phone calls itself.
 *
 * The name is the phone's own, not the Hub's: the plugin's device roster lists
 * one row per paired device, and a roster of identical `android` / `ios` rows
 * tells the owner nothing when several phones or several Hubs are involved.
 * So the default is what the device can state about itself without asking
 * anyone — system, system version and model — and the owner can replace it
 * with something they recognise.
 *
 * The name travels to the plugin twice: once when a pairing code is redeemed,
 * and again on every `hello`, so renaming the phone lands in the console
 * roster on the next connect instead of needing another pairing round.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'

const KEY = 'dsh-mobile/device-name/v1'

/** The longest name the plugin will store; anything longer is truncated there. */
export const DEVICE_NAME_LIMIT = 64

/**
 * Platform constants are typed per-OS, so the shared fields are read through a
 * loose view of the same object instead of narrowing the union at every use.
 */
function constants(): Record<string, unknown> {
  return Platform.constants as unknown as Record<string, unknown>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * System + system version + what else the platform is willing to say, e.g.
 * `Android 16 · vivo V2405A` or `iOS 26.5 · iPhone`. Missing constants are
 * dropped rather than printed as `undefined`, and the result is never empty.
 */
export function defaultDeviceName(): string {
  const values = constants()
  if (Platform.OS === 'ios') {
    const version = text(values.osVersion)
    const idiom = text(values.interfaceIdiom)
    const device = idiom === 'pad' ? 'iPad' : idiom === 'tv' ? 'Apple TV' : idiom === 'vision' ? 'Vision Pro' : 'iPhone'
    return [`iOS${version === '' ? '' : ` ${version}`}`, device].join(' · ')
  }
  if (Platform.OS === 'android') {
    const release = text(values.Release)
    const model = [text(values.Manufacturer), text(values.Model)].filter(part => part !== '').join(' ')
    const head = `Android${release === '' ? '' : ` ${release}`}`
    return model === '' ? head : `${head} · ${model}`
  }
  return Platform.OS
}

/**
 * The stored name, or null when the owner has never set one. Callers fall back
 * to {@link defaultDeviceName} rather than this module deciding, so a default
 * follows the device instead of being frozen into storage on first launch.
 */
export async function loadDeviceName(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(KEY)
  if (raw === null) return null
  try {
    // The value is plain text, but an older build could have stored JSON.
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'string') {
      const trimmed = parsed.trim()
      return trimmed === '' ? null : trimmed
    }
  } catch {
    // Not JSON: the raw value is the name.
  }
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/** Stores a name; an empty one clears the override and restores the default. */
export async function saveDeviceName(name: string): Promise<void> {
  const trimmed = name.trim().slice(0, DEVICE_NAME_LIMIT)
  if (trimmed === '') {
    await AsyncStorage.removeItem(KEY)
    return
  }
  await AsyncStorage.setItem(KEY, trimmed)
}
