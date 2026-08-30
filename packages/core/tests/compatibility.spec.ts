import { describe, expect, it } from 'vitest'
import { checkMobileCompatibility, REQUIRED_PLUGIN_FEATURES } from '../src/compatibility.ts'

const manifest = { pluginVersion: '0.1.2', mobileApi: 1, features: [...REQUIRED_PLUGIN_FEATURES] }

describe('mobile compatibility', () => {
  it('accepts a plugin from the same mobileApi generation', () => {
    const result = checkMobileCompatibility(manifest)
    expect(result.status).toBe('compatible')
    expect(result.features).toEqual([...REQUIRED_PLUGIN_FEATURES])
    expect(result.missingFeatures).toEqual([])
  })

  it('rejects older, newer, and malformed plugin manifests', () => {
    expect(checkMobileCompatibility({ pluginVersion: '0.0.1', mobileApi: 1, features: [] }).status).toBe('incompatible')
    expect(checkMobileCompatibility({ pluginVersion: '0.2.0', mobileApi: 1, features: [] }).status).toBe('incompatible')
    expect(checkMobileCompatibility({ pluginVersion: '0.1.0', mobileApi: 2, features: [] }).status).toBe('incompatible')
    expect(checkMobileCompatibility({ pluginVersion: 'not-semver', mobileApi: 1, features: [] }).status).toBe('incompatible')
  })

  it('rejects a version-compatible manifest that omits required features', () => {
    const result = checkMobileCompatibility({ ...manifest, features: ['plus-menu'] })
    expect(result.status).toBe('incompatible')
    expect(result.title).toBe('插件功能不足')
    expect(result.missingFeatures).toEqual(REQUIRED_PLUGIN_FEATURES.filter(feature => feature !== 'plus-menu'))
  })

  it('treats missing mobile.info as unknown rather than pretending it is compatible', () => {
    const result = checkMobileCompatibility(null)
    expect(result.status).toBe('unknown')
    expect(result.pluginVersion).toBe('未知')
  })
})
