/**
 * Counts for the settings summary row. The settings page shows how many
 * plugins are loaded and how many are switched on, and the full list lives on
 * its own page — a long inventory should not stretch the settings page.
 */
import type { MobileInventorySnapshot } from '@dsh-mobile/protocol'

export interface InventoryCounts {
  total: number
  enabled: number
}

/**
 * `null` when the bridge serves no inventory at all (old plugin, or the RPC
 * failed) — distinct from an empty inventory, which is a real answer.
 */
export function inventoryCounts(snapshot: MobileInventorySnapshot | null | undefined): InventoryCounts | null {
  if (snapshot === null || snapshot === undefined) return null
  return {
    total: snapshot.entries.length,
    enabled: snapshot.entries.filter(entry => entry.enabled).length,
  }
}
