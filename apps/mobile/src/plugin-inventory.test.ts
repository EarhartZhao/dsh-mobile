import { inventoryCounts } from './plugin-inventory'

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
