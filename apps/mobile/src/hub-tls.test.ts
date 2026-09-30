import { hubHostOf, hubUsesTls, sameFingerprint } from './hub-tls'

describe('hubHostOf', () => {
  it('reads the host out of the address the QR carries', () => {
    expect(hubHostOf('wss://hub.test:8443')).toBe('hub.test')
    expect(hubHostOf('wss://115.159.57.137:8443')).toBe('115.159.57.137')
    expect(hubHostOf('ws://10.0.2.2:8443')).toBe('10.0.2.2')
  })

  it('drops a path, a port and any credentials', () => {
    expect(hubHostOf('wss://hub.test:8443/mobile-bridge')).toBe('hub.test')
    expect(hubHostOf('wss://c-end:secret@hub.test:8443')).toBe('hub.test')
  })

  it('keeps an IPv6 literal without its brackets', () => {
    // `SecTrust` hands over the bare address, so the stored key has to be bare
    // too or the anchor would never be found.
    expect(hubHostOf('wss://[::1]:8443')).toBe('::1')
    expect(hubHostOf('wss://[2001:db8::1]:8443')).toBe('2001:db8::1')
  })

  it('accepts a bare host, and normalises case', () => {
    expect(hubHostOf('Hub.Test')).toBe('hub.test')
  })
})

describe('hubUsesTls', () => {
  it('separates a TLS Hub from the plaintext dev rig', () => {
    expect(hubUsesTls('wss://hub.test:8443')).toBe(true)
    // A bare host and an https address both end up in a TLS handshake.
    expect(hubUsesTls('hub.test')).toBe(true)
    expect(hubUsesTls('https://hub.test')).toBe(true)
    expect(hubUsesTls('ws://10.0.2.2:8333')).toBe(false)
    expect(hubUsesTls(' ws://localhost:8333 ')).toBe(false)
  })
})

describe('sameFingerprint', () => {
  const fingerprint = '04:5E:2C:22:20:1A:9C:6C:E5:01:A4:42:B2:1C:ED:97'

  it('ignores case and separators', () => {
    expect(sameFingerprint(fingerprint.toLowerCase(), fingerprint)).toBe(true)
    expect(sameFingerprint(fingerprint.replace(/:/g, ''), fingerprint)).toBe(true)
  })

  it('never matches an empty side', () => {
    expect(sameFingerprint('', '')).toBe(false)
    expect(sameFingerprint('', fingerprint)).toBe(false)
  })

  it('separates different certificates', () => {
    expect(sameFingerprint(fingerprint, '61:49:3F:1A')).toBe(false)
  })
})
