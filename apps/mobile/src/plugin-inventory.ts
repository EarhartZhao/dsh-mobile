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

/**
 * Whether one forwarded host event invalidates the inventory snapshot. dsh
 * 0.1.6-alpha.2 started forwarding `plugin-manager/changed` with the in-flight
 * `install-state`/`install-log` pair, so an install started from the desktop no
 * longer needs the phone's manual refresh. The frame's own arrival is the
 * capability signal: a bridge that does not relay them simply sends nothing.
 */
export function inventoryChangedByEvent(event: string): boolean {
  return event.startsWith('plugin-manager/')
}
