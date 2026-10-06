import { describe, expect, it } from 'vitest'
import { classifyConnectionFailure, gatewayIdentityMismatch } from '../src/connection-manager.ts'

describe('connection failure classification', () => {
  it('distinguishes missing responders from plugin compatibility', () => {
    expect(classifyConnectionFailure('503 No Responders Available For Request')).toBe('bridge-unavailable')
    expect(classifyConnectionFailure('TIMEOUT')).toBe('bridge-unavailable')
  })

  it('classifies actionable authentication, TLS, network, and protocol failures', () => {
    expect(classifyConnectionFailure('mobile-unauthenticated')).toBe('authentication')
    expect(classifyConnectionFailure('TLS certificate rejected')).toBe('tls')
    expect(classifyConnectionFailure('gateway-identity-mismatch')).toBe('protocol')
    expect(classifyConnectionFailure('socket connection refused')).toBe('network')
    expect(classifyConnectionFailure('mobile-info-invalid')).toBe('protocol')
    expect(classifyConnectionFailure('mobile-health-invalid')).toBe('protocol')
  })
})

describe('gateway identity', () => {
  it('accepts older plugins that omit either side and rejects a changed identity', () => {
    expect(gatewayIdentityMismatch(undefined, 'gateway-a')).toBe(false)
    expect(gatewayIdentityMismatch('gateway-a', undefined)).toBe(false)
    expect(gatewayIdentityMismatch('gateway-a', 'gateway-a')).toBe(false)
    expect(gatewayIdentityMismatch('gateway-a', 'gateway-b')).toBe(true)
  })
})
