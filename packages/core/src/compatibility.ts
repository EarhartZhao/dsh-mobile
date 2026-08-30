/**
 * Mobile/plugin compatibility contract. Plugin self-description is mandatory
 * from mobileApi 1; missing information cannot safely expose the new surface.
 */
import type { MobilePluginInfo } from '@dsh-mobile/protocol'

export const APP_VERSION = '0.1.0'
export const APP_MOBILE_API = 1
export const SUPPORTED_PLUGIN_RANGE = '>=0.1.0 <0.2.0'
export const SUPPORTED_MOBILE_APIS = [1] as const
export const REQUIRED_PLUGIN_FEATURES = [
  'plus-menu',
  'multi-image',
  'durable-attachment-order',
] as const

export type CompatibilityStatus = 'compatible' | 'incompatible' | 'unknown'

export interface CompatibilityResult {
  status: CompatibilityStatus
  title: string
  message: string
  appVersion: string
  mobileApi: number
  features: string[]
  missingFeatures: string[]
  pluginVersion: string
  supportedPluginRange: string
}

function semverCore(value: string): [number, number, number] | null {
  const core = value.replace(/^v/i, '').split('-', 1)[0] ?? ''
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(core)
  if (match === null) return null
  const [major = 0, minor = 0, patch = 0] = match.slice(1)
  return [Number(major), Number(minor), Number(patch)]
}

function compareSemver(left: string, right: string): number {
  const a = semverCore(left)
  const b = semverCore(right)
  if (a === null || b === null) return Number.NaN
  if (a[0] !== b[0]) return a[0] - b[0]
  if (a[1] !== b[1]) return a[1] - b[1]
  return a[2] - b[2]
}

export function checkMobileCompatibility(info: MobilePluginInfo | null): CompatibilityResult {
  const base = {
    appVersion: APP_VERSION,
    supportedPluginRange: SUPPORTED_PLUGIN_RANGE,
  }
  if (info === null) {
    return {
      status: 'unknown',
      title: '插件版本未知',
      message: '当前 dsh-mobile-plugin 未提供 mobile.info。App 0.1.x 需要 dsh-mobile-plugin 0.1.x，请在 Web 设置页更新并重启移动端桥后重试。',
      pluginVersion: '未知',
      mobileApi: 0,
      features: [],
      missingFeatures: [...REQUIRED_PLUGIN_FEATURES],
      ...base,
    }
  }
  const validMobileApi = (SUPPORTED_MOBILE_APIS as readonly number[]).includes(info.mobileApi)
  const version = semverCore(info.pluginVersion)
  const pluginVersionValid = version !== null && compareSemver(info.pluginVersion, '0.1.0') >= 0 && compareSemver(info.pluginVersion, '0.2.0') < 0
  const missingFeatures = REQUIRED_PLUGIN_FEATURES.filter(feature => !info.features.includes(feature))
  if (validMobileApi && pluginVersionValid) {
    if (missingFeatures.length > 0) {
      return {
        status: 'incompatible',
        title: '插件功能不足',
        message: `App ${APP_VERSION} 需要插件提供：${missingFeatures.join(', ')}。当前插件 ${info.pluginVersion} 缺少这些能力，请更新 dsh-mobile-plugin 后重试。`,
        pluginVersion: info.pluginVersion,
        mobileApi: info.mobileApi,
        features: [...info.features],
        missingFeatures,
        ...base,
      }
    }
    return {
      status: 'compatible',
      title: '版本兼容',
      message: `App ${APP_VERSION} 与 dsh-mobile-plugin ${info.pluginVersion} 兼容。`,
      pluginVersion: info.pluginVersion,
      mobileApi: info.mobileApi,
      features: [...info.features],
      missingFeatures: [],
      ...base,
    }
  }
  return {
    status: 'incompatible',
    title: '版本不一致',
      message: `App ${APP_VERSION} 需要插件 ${SUPPORTED_PLUGIN_RANGE}（mobileApi ${SUPPORTED_MOBILE_APIS.join(' / ')}）。当前插件 ${info.pluginVersion}（mobileApi ${info.mobileApi}）。请更新 dsh-mobile-plugin 后重试。`,
      pluginVersion: info.pluginVersion,
      mobileApi: info.mobileApi,
      features: [...info.features],
      missingFeatures,
      ...base,
    }
}
