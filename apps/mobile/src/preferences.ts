/**
 * Persisted app preferences that are neither pairing state nor language:
 * AsyncStorage, one versioned key, unknown fields ignored.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'dsh-mobile/preferences/v1'

export interface Preferences {
  /** Enter sends the composer message; Shift+Enter always keeps the newline. */
  enterToSend: boolean
}

export const DEFAULT_PREFERENCES: Preferences = {
  // Chat convention, and the browser's reference flow is built around it.
  enterToSend: true,
}

export async function loadPreferences(): Promise<Preferences> {
  const raw = await AsyncStorage.getItem(KEY)
  if (raw === null) return DEFAULT_PREFERENCES
  try {
    const parsed = JSON.parse(raw) as Partial<Preferences>
    return {
      enterToSend: typeof parsed.enterToSend === 'boolean'
        ? parsed.enterToSend
        : DEFAULT_PREFERENCES.enterToSend,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export async function savePreferences(preferences: Preferences): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(preferences))
}
