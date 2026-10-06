import { checkForAppUpdate, isNewerVersion } from './app-update'

function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v0.2.0',
    name: 'dsh-mobile v0.2.0',
    body: 'notes',
    assets: [
      { name: 'DshMobile-v0.2.0-release.apk', browser_download_url: 'https://example.test/app.apk' },
    ],
    ...overrides,
  }
}

/** The module only ever fetches the one release URL; the stub answers it. */
function stubFetch(body: unknown, ok = true): jest.Mock {
  const mock = jest.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }))
  ;(globalThis as { fetch?: unknown }).fetch = mock
  return mock as unknown as jest.Mock
}

describe('isNewerVersion', () => {
  it('compares numerically rather than as strings', () => {
    expect(isNewerVersion('0.1.10', '0.1.9')).toBe(true)
    expect(isNewerVersion('0.2.0', '0.10.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true)
  })

  it('ignores the leading v and any prerelease suffix', () => {
    expect(isNewerVersion('v0.3.0', '0.2.9')).toBe(true)
    expect(isNewerVersion('0.2.0-rc.1', '0.1.9')).toBe(true)
  })

  it('treats the installed version and anything older as not newer', () => {
    expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false)
    expect(isNewerVersion('0.1.9', '0.2.0')).toBe(false)
  })

  it('refuses to guess when a tag is not a version', () => {
    expect(isNewerVersion('nightly', '0.2.0')).toBe(false)
  })
})

describe('checkForAppUpdate', () => {
  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch
  })

  it('picks the APK asset out of a newer release', async () => {
    stubFetch(release())

    await expect(checkForAppUpdate()).resolves.toEqual({
      version: '0.2.0',
      name: 'dsh-mobile v0.2.0',
      notes: 'notes',
      downloadUrl: 'https://example.test/app.apk',
    })
  })

  it('reports nothing to do when the newest release is the installed one', async () => {
    stubFetch(release({ tag_name: 'v0.0.1' }))

    await expect(checkForAppUpdate()).resolves.toBeNull()
  })

  it('skips releases whose only asset is not an installable APK', async () => {
    // The iOS job attaches an unsigned IPA to the same release; it must not be
    // mistaken for something Android can install.
    stubFetch(release({ assets: [{ name: 'DshMobile-v0.2.0-ios-unsigned.ipa', browser_download_url: 'https://example.test/app.ipa' }] }))

    await expect(checkForAppUpdate()).resolves.toBeNull()
  })

  it('refuses a download URL that is not HTTPS', async () => {
    stubFetch(release({ assets: [{ name: 'app.apk', browser_download_url: 'http://example.test/app.apk' }] }))

    await expect(checkForAppUpdate()).resolves.toBeNull()
  })

  it('surfaces a failed request instead of pretending there is no update', async () => {
    stubFetch(release(), false)

    await expect(checkForAppUpdate()).rejects.toThrow('HTTP 500')
  })
})
