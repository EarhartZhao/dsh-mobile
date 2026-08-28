/**
 * Persisted pairing record: everything from the QR payload plus the redeemed
 * device token. AsyncStorage for the v1 skeleton; the storage interface is
 * deliberately tiny so swapping to react-native-keychain is a one-file change.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

export interface PairingRecord {
  hub: string
  user: string
  pass: string
  instance: string
  caFp: string
  token: string
  deviceId: string
  expiresAt: string
}

const KEY = 'dsh-mobile/pairing/v1'

export async function loadPairing(): Promise<PairingRecord | null> {
  const raw = await AsyncStorage.getItem(KEY)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PairingRecord>
    if (typeof parsed.hub !== 'string' || typeof parsed.token !== 'string') return null
    return parsed as PairingRecord
  } catch {
    return null
  }
}

export async function savePairing(record: PairingRecord): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(record))
}

export async function clearPairing(): Promise<void> {
  await AsyncStorage.removeItem(KEY)
}
