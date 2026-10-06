/**
 * Stable id for this app installation.
 *
 * It is not a credential and never replaces the device token. Its only job is
 * to let a plugin recognize that a fresh pairing belongs to the same phone, so
 * re-pairing after an expiry or token rotation updates one device record
 * instead of filling the roster with duplicates.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = 'dsh-mobile/installation-id/v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let pending: Promise<string> | null = null

export async function getInstallationId(): Promise<string> {
  if (pending !== null) return pending
  pending = (async () => {
    const stored = await AsyncStorage.getItem(STORAGE_KEY)
    if (stored !== null && UUID.test(stored)) return stored.toLowerCase()
    const created = crypto.randomUUID().toLowerCase()
    await AsyncStorage.setItem(STORAGE_KEY, created)
    return created
  })()
  try {
    return await pending
  } catch (error) {
    pending = null
    throw error
  }
}
