import { inventoryChangedByEvent, inventoryCounts } from './plugin-inventory'

function entry(enabled: boolean) {
  return { entryId: String(enabled), moduleName: 'plugin', enabled, fiberPhase: 'active' as const }
}

describe('inventoryCounts', () => {
  it('counts every loaded entry and the enabled subset', () => {
    expect(inventoryCounts({ entries: [entry(true), entry(false), entry(true)] }))
      .toEqual({ total: 3, enabled: 2 })
  })

  it('counts an empty inventory as zero rather than unavailable', () => {
    expect(inventoryCounts({ entries: [] })).toEqual({ total: 0, enabled: 0 })
  })

  it('distinguishes a bridge that serves no inventory from an empty one', () => {
    expect(inventoryCounts(null)).toBeNull()
    expect(inventoryCounts(undefined)).toBeNull()
  })
})

describe('inventoryChangedByEvent', () => {
  it('accepts every event the plugin manager forwards', () => {
    expect(inventoryChangedByEvent('plugin-manager/changed')).toBe(true)
    expect(inventoryChangedByEvent('plugin-manager/install-state')).toBe(true)
    expect(inventoryChangedByEvent('plugin-manager/install-log')).toBe(true)
  })

  it('ignores unrelated forwarded events', () => {
    expect(inventoryChangedByEvent('api-session/activity')).toBe(false)
    expect(inventoryChangedByEvent('settings/document-updated')).toBe(false)
    expect(inventoryChangedByEvent('plugin-managers/changed')).toBe(false)
  })
})
