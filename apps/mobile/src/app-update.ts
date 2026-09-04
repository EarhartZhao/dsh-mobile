import { APP_VERSION } from '@dsh-mobile/core'

export const APP_RELEASES_API = 'https://api.github.com/repos/EarhartZhao/dsh-mobile/releases/latest'

export interface AppUpdateInfo {
  version: string
  name: string
  notes: string
  downloadUrl: string
}

function versionParts(value: string): number[] | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/u.exec(value.trim())
  if (match === null) return null
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

export function isNewerVersion(candidate: string, current = APP_VERSION): boolean {
  const next = versionParts(candidate)
  const installed = versionParts(current)
  if (next === null || installed === null) return false
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index]
  }
  return false
}

export async function checkForAppUpdate(signal?: AbortSignal): Promise<AppUpdateInfo | null> {
  const response = await fetch(APP_RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const release: unknown = await response.json()
  if (release === null || typeof release !== 'object') return null
  const data = release as {
    tag_name?: unknown
    name?: unknown
    body?: unknown
    assets?: unknown
  }
  const tag = typeof data.tag_name === 'string' ? data.tag_name : ''
  if (!isNewerVersion(tag)) return null
  const assets = Array.isArray(data.assets) ? data.assets : []
  const apk = assets.find(asset => {
    if (asset === null || typeof asset !== 'object') return false
    const item = asset as { name?: unknown; browser_download_url?: unknown }
    return typeof item.name === 'string' && item.name.toLowerCase().endsWith('.apk') && typeof item.browser_download_url === 'string'
  }) as { browser_download_url: string } | undefined
  if (apk === undefined || !/^https:\/\//u.test(apk.browser_download_url)) return null
  return {
    version: tag.replace(/^v/u, ''),
    name: typeof data.name === 'string' && data.name !== '' ? data.name : tag,
    notes: typeof data.body === 'string' ? data.body.trim() : '',
    downloadUrl: apk.browser_download_url,
  }
}
