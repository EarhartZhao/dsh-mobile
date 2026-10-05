import React from 'react'
import { BackHandler, Platform } from 'react-native'
import renderer, { act } from 'react-test-renderer'

let mockHasPermission = true
const mockRequestPermission = jest.fn()
type BackPressEvent = Parameters<Parameters<typeof BackHandler.addEventListener>[1]>[0]
let backPressHandler: ((event: BackPressEvent) => boolean | undefined) | undefined

jest.mock('react-native-vision-camera', () => ({
  Camera: (props: Record<string, unknown>) => require('react').createElement('Camera', props),
  useCameraDevice: () => ({ id: 'back' }),
  useCameraPermission: () => ({ hasPermission: mockHasPermission, requestPermission: mockRequestPermission }),
  useCodeScanner: (scanner: unknown) => scanner,
}))

jest.mock('nats.ws', () => ({ connect: jest.fn() }))
jest.mock('../pairing-store', () => ({ savePairing: jest.fn() }))
jest.mock('../hub-tls', () => ({ installHubAnchor: jest.fn(async () => null) }))
jest.mock('@dsh-mobile/protocol', () => ({ headers: {}, redeemPairingCode: jest.fn() }))
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}))
jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({ t: (key: string) => key }),
}))

import { PairingScreen } from './PairingScreen'

describe('PairingScreen camera', () => {
  beforeEach(() => {
    mockHasPermission = true
    mockRequestPermission.mockReset()
    backPressHandler = undefined
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      backPressHandler = handler
      return { remove: jest.fn() }
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  async function openScanner(tree: renderer.ReactTestRenderer): Promise<void> {
    const button = tree.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.findAllByProps({ children: 'pairing.openScanner' }).length > 0,
    ).at(-1)
    await act(async () => { button!.props.onPress() })
  }

  it('shows an open-scanner button before mounting the camera', () => {
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })

    expect(tree!.root.findAll(node => (node.type as unknown) === 'Camera')).toHaveLength(0)
    expect(tree!.root.findAllByProps({ children: 'pairing.openScanner' }).length).toBeGreaterThan(0)
  })

  it('keeps the scan launcher down to the button alone', () => {
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })

    // The launcher used to repeat the scan instruction above the button; the
    // full-screen scanner still carries it, so it must be gone from here.
    expect(tree!.root.findAllByProps({ children: 'pairing.openScanner' }).length).toBeGreaterThan(0)
    expect(tree!.root.findAllByProps({ children: 'pairing.scanHint' })).toHaveLength(0)
  })

  it('opens the QR scanner after tapping the open-scanner button', async () => {
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })

    await openScanner(tree!)
    const camera = tree!.root.findAll(node => (node.type as unknown) === 'Camera')[0]
    // `androidPreviewViewType` is an Android-only knob; the iOS camera must not
    // receive it.
    expect(camera.props.androidPreviewViewType).toBeUndefined()
    expect(tree!.root.findAllByProps({ children: 'pairing.title' })).toHaveLength(0)
    expect(tree!.root.findAll(node => (node.type as unknown) === 'TextInput')).toHaveLength(0)
    expect(tree!.root.findAllByProps({ children: 'pairing.scanHint' }).length).toBeGreaterThan(0)
  })

  it('asks the Android camera for the texture preview so scanning composites', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android')
    try {
      let tree: renderer.ReactTestRenderer
      act(() => {
        tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
      })

      await openScanner(tree!)
      const camera = tree!.root.findAll(node => (node.type as unknown) === 'Camera')[0]
      expect(camera.props.androidPreviewViewType).toBe('texture-view')
    } finally {
      platform.restore()
    }
  })

  it('puts the raw scanned value into the pairing input and returns to the pairing page', async () => {
    const connect = jest.requireMock('nats.ws').connect as jest.Mock
    const onPaired = jest.fn()
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={onPaired} />)
    })
    await openScanner(tree!)
    const scanner = tree!.root.findAll(node => (node.type as unknown) === 'Camera')[0].props.codeScanner
    const qrText = '{"hub":"wss://example.test","user":"u","pass":"p","instance":"i","code":"c"}'

    await act(async () => {
      scanner.onCodeScanned([{ value: qrText }])
    })

    expect(tree!.root.findAll(node => (node.type as unknown) === 'Camera')).toHaveLength(0)
    expect(tree!.root.findAll(node => (node.type as unknown) === 'TextInput')[0].props.value).toBe(qrText)
    expect(connect).not.toHaveBeenCalled()
    expect(onPaired).not.toHaveBeenCalled()
  })

  it('closes the scanner and unmounts the camera when returning to pairing', async () => {
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })
    await openScanner(tree!)
    expect(tree!.root.findAll(node => (node.type as unknown) === 'Camera')).toHaveLength(1)

    const backButton = tree!.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.props.accessibilityLabel === 'pairing.closeScanner',
    ).at(-1)
    await act(async () => { backButton!.props.onPress() })

    expect(tree!.root.findAll(node => (node.type as unknown) === 'Camera')).toHaveLength(0)
    expect(tree!.root.findAllByProps({ children: 'pairing.openScanner' }).length).toBeGreaterThan(0)
  })

  it('handles the Android system back button while scanning', async () => {
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })
    await openScanner(tree!)
    expect(backPressHandler).toBeDefined()

    let handled = false
    act(() => { handled = backPressHandler!(undefined as unknown as BackPressEvent) === true })

    expect(handled).toBe(true)
    expect(tree!.root.findAll(node => (node.type as unknown) === 'Camera')).toHaveLength(0)
    expect(tree!.root.findAllByProps({ children: 'pairing.openScanner' }).length).toBeGreaterThan(0)
  })

  it('delegates system back to the root-page handler outside the scanner', () => {
    const onSystemBack = jest.fn(() => true)
    act(() => {
      renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} onSystemBack={onSystemBack} />)
    })

    expect(backPressHandler!(undefined as unknown as BackPressEvent)).toBe(true)
    expect(onSystemBack).toHaveBeenCalledTimes(1)
  })

  it('shows an authorization button when camera permission is missing', () => {
    mockHasPermission = false
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })

    expect(tree!.root.findAll(node => (node.type as unknown) === 'Camera')).toHaveLength(0)
    const button = tree!.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.findAllByProps({ children: 'pairing.allowCamera' }).length > 0,
    ).at(-1)
    act(() => { button!.props.onPress() })
    expect(mockRequestPermission).toHaveBeenCalledTimes(1)
  })

  it('ignores empty QR values', async () => {
    let tree: renderer.ReactTestRenderer
    await act(async () => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })
    await openScanner(tree!)
    const scanner = tree!.root.findAll(node => (node.type as unknown) === 'Camera')[0].props.codeScanner

    await act(async () => {
      scanner.onCodeScanned([{ value: '' }])
    })
    await act(async () => {
      scanner.onCodeScanned([{ value: undefined }])
    })

    expect(tree!.root.findAll(node => (node.type as unknown) === 'Camera')).toHaveLength(1)
  })

  it('shows a camera error and remounts the camera when retrying', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    let tree: renderer.ReactTestRenderer
    await act(async () => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })
    await openScanner(tree!)
    const before = tree!.root.findAll(node => (node.type as unknown) === 'Camera')[0]

    act(() => {
      before.props.onError({ code: 'device/camera-error', message: 'camera failed' })
    })
    expect(tree!.root.findAllByProps({ children: 'pairing.cameraFailed' }).length).toBeGreaterThan(0)

    const retryButton = tree!.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.findAllByProps({ children: 'common.retry' }).length > 0,
    ).at(-1)
    await act(async () => {
      retryButton!.props.onPress()
    })

    const after = tree!.root.findAll(node => (node.type as unknown) === 'Camera')[0]
    expect(after).not.toBe(before)
    expect(tree!.root.findAllByProps({ children: 'pairing.cameraFailed' })).toHaveLength(0)
    error.mockRestore()
  })
})

describe('PairingScreen hub credential errors', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    ;(jest.requireMock('nats.ws').connect as jest.Mock).mockReset()
    ;(jest.requireMock('../hub-tls').installHubAnchor as jest.Mock).mockReset()
    ;(jest.requireMock('../hub-tls').installHubAnchor as jest.Mock).mockResolvedValue(null)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  /** Paste a QR payload and press 「配对并连接」, as the on-device flow does. */
  async function pasteAndPair(tree: renderer.ReactTestRenderer, qrText: string): Promise<void> {
    await act(async () => {
      tree.root.findAll(node => (node.type as unknown) === 'TextInput')[0].props.onChangeText(qrText)
    })
    const button = tree.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.findAllByProps({ children: 'pairing.pairAndConnect' }).length > 0,
    ).at(-1)
    await act(async () => { await button!.props.onPress() })
  }

  it('tells the user to configure the hub password when the QR carries no pass', async () => {
    const connect = jest.requireMock('nats.ws').connect as jest.Mock
    let tree: renderer.ReactTestRenderer
    await act(async () => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })

    await pasteAndPair(tree!, '{"hub":"wss://hub.test:8443","user":"c-end-dsh","pass":"","instance":"home","code":"ABCDEFGH"}')

    expect(tree!.root.findAllByProps({ children: 'pairing.missingHubCredential' }).length).toBeGreaterThan(0)
    expect(connect).not.toHaveBeenCalled()
  })

  it('maps a hub authorization rejection to an actionable message', async () => {
    const connect = jest.requireMock('nats.ws').connect as jest.Mock
    connect.mockRejectedValueOnce(new Error("'Authorization Violation'"))
    let tree: renderer.ReactTestRenderer
    await act(async () => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })

    await pasteAndPair(tree!, '{"hub":"wss://hub.test:8443","user":"c-end-dsh","pass":"123456","instance":"home","code":"ABCDEFGH"}')

    expect(connect).toHaveBeenCalledTimes(1)
    expect(tree!.root.findAllByProps({ children: 'pairing.authFailed' }).length).toBeGreaterThan(0)
  })

  it('explains an unanswered bridge instead of showing the raw no-responders 503', async () => {
    const connect = jest.requireMock('nats.ws').connect as jest.Mock
    // NATS answers a request to a subject nobody serves with code AND message
    // "503" — the QR then points at a machine whose dsh is not on the Hub.
    connect.mockRejectedValueOnce(Object.assign(new Error('503'), { code: '503' }))
    let tree: renderer.ReactTestRenderer
    await act(async () => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })

    await pasteAndPair(tree!, '{"hub":"wss://hub.test:8443","user":"c-end-dsh","pass":"p","instance":"home","code":"ABCDEFGH"}')

    expect(tree!.root.findAllByProps({ children: 'pairing.bridgeOffline' }).length).toBeGreaterThan(0)
  })

  it('explains a transport failure whose NatsError carries no message', async () => {
    const connect = jest.requireMock('nats.ws').connect as jest.Mock
    // What a failed TLS handshake actually produces on the phone: `nats.ws`
    // reports the code and leaves `message` undefined. Reading it as a string
    // used to throw inside the error mapper, so the phone showed
    // "Cannot read property 'trim' of undefined" instead of anything useful.
    const transport = Object.assign(new Error(), { name: 'NatsError', code: 'CONNECTION_REFUSED' })
    Object.defineProperty(transport, 'message', { value: undefined })
    connect.mockRejectedValueOnce(transport)
    let tree: renderer.ReactTestRenderer
    await act(async () => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })

    await pasteAndPair(tree!, '{"hub":"wss://hub.test:8443","user":"c-end-dsh","pass":"p","instance":"home","code":"ABCDEFGH"}')

    expect(tree!.root.findAllByProps({ children: 'pairing.natsFailed' }).length).toBeGreaterThan(0)
    expect(tree!.root.findAll(node => `${String(node.props.children)}`.includes('trim')).length).toBe(0)
  })

  it('redeems the code with this phone own name, so the console roster is readable', async () => {
    const connect = jest.requireMock('nats.ws').connect as jest.Mock
    const redeem = jest.requireMock('@dsh-mobile/protocol').redeemPairingCode as jest.Mock
    const onPaired = jest.fn()
    redeem.mockResolvedValueOnce({ token: 'tok', deviceId: 'dev-1', expiresAt: '2027-01-01T00:00:00.000Z' })
    connect.mockResolvedValueOnce({ close: jest.fn(async () => undefined) })
    let tree: renderer.ReactTestRenderer
    await act(async () => {
      tree = renderer.create(<PairingScreen deviceName="Pixel 8 · Android 16" onPaired={onPaired} />)
    })

    await pasteAndPair(tree!, '{"hub":"wss://hub.test:8443","user":"c-end-dsh","pass":"p","instance":"home","code":"ABCDEFGH"}')

    // Index-based: the header factory comes from the mocked `nats.ws`, so
    // matching the whole call would assert on a stub this test does not own.
    expect(redeem).toHaveBeenCalledTimes(1)
    expect(redeem.mock.calls[0][2]).toBe('home')
    expect(redeem.mock.calls[0][3]).toBe('ABCDEFGH')
    expect(redeem.mock.calls[0][4]).toBe('Pixel 8 · Android 16')
    // The screen hands back the QR payload plus the redeemed token; saving and
    // switch handling belong to the root, which now keeps a list of them.
    expect(onPaired).toHaveBeenCalledWith(expect.objectContaining({
      hub: 'wss://hub.test:8443',
      instance: 'home',
      token: 'tok',
      deviceId: 'dev-1',
    }))
  })

  it('installs the QR certificate as the anchor before dialling the hub', async () => {
    const connect = jest.requireMock('nats.ws').connect as jest.Mock
    const install = jest.requireMock('../hub-tls').installHubAnchor as jest.Mock
    const order: string[] = []
    install.mockImplementationOnce(async () => { order.push('anchor'); return null })
    connect.mockImplementationOnce(async () => { order.push('dial'); throw new Error('stop') })
    let tree: renderer.ReactTestRenderer
    await act(async () => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })

    await pasteAndPair(tree!, '{"hub":"wss://hub.test:8443","user":"c-end-dsh","pass":"p","instance":"home","caFp":"AA:BB","ca":"MIIB","code":"ABCDEFGH"}')

    expect(install).toHaveBeenCalledWith('wss://hub.test:8443', 'MIIB', 'AA:BB')
    // The anchor has to exist before the first handshake: the QR is the only
    // moment the app can learn it, and a handshake cannot ask again.
    expect(order).toEqual(['anchor', 'dial'])
  })

  it('dials even when the QR carries no certificate, leaving TLS to the system store', async () => {
    const connect = jest.requireMock('nats.ws').connect as jest.Mock
    const install = jest.requireMock('../hub-tls').installHubAnchor as jest.Mock
    connect.mockRejectedValueOnce(new Error('stop'))
    let tree: renderer.ReactTestRenderer
    await act(async () => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })

    await pasteAndPair(tree!, '{"hub":"wss://hub.test:8443","user":"c-end-dsh","pass":"p","instance":"home","caFp":"","code":"ABCDEFGH"}')

    expect(install).toHaveBeenCalledWith('wss://hub.test:8443', undefined, '')
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('refuses a QR whose certificate cannot be read, without dialling', async () => {
    const connect = jest.requireMock('nats.ws').connect as jest.Mock
    const install = jest.requireMock('../hub-tls').installHubAnchor as jest.Mock
    install.mockRejectedValueOnce(new Error('hub-ca-invalid'))
    let tree: renderer.ReactTestRenderer
    await act(async () => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })

    await pasteAndPair(tree!, '{"hub":"wss://hub.test:8443","user":"c-end-dsh","pass":"p","instance":"home","caFp":"AA:BB","ca":"not-a-certificate","code":"ABCDEFGH"}')

    expect(tree!.root.findAllByProps({ children: 'pairing.caInvalid' }).length).toBeGreaterThan(0)
    expect(connect).not.toHaveBeenCalled()
  })

  it('refuses a QR whose certificate contradicts its fingerprint', async () => {
    const connect = jest.requireMock('nats.ws').connect as jest.Mock
    const install = jest.requireMock('../hub-tls').installHubAnchor as jest.Mock
    install.mockRejectedValueOnce(new Error('hub-ca-mismatch'))
    let tree: renderer.ReactTestRenderer
    await act(async () => {
      tree = renderer.create(<PairingScreen deviceName="test-phone" onPaired={jest.fn()} />)
    })

    await pasteAndPair(tree!, '{"hub":"wss://hub.test:8443","user":"c-end-dsh","pass":"p","instance":"home","caFp":"AA:BB","ca":"MIIB","code":"ABCDEFGH"}')

    expect(tree!.root.findAllByProps({ children: 'pairing.caMismatch' }).length).toBeGreaterThan(0)
    expect(connect).not.toHaveBeenCalled()
  })
})
