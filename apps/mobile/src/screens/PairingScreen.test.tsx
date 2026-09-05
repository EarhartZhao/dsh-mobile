import React from 'react'
import { BackHandler } from 'react-native'
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
      tree = renderer.create(<PairingScreen onPaired={jest.fn()} />)
    })

    expect(tree!.root.findAll(node => (node.type as unknown) === 'Camera')).toHaveLength(0)
    expect(tree!.root.findAllByProps({ children: 'pairing.openScanner' }).length).toBeGreaterThan(0)
  })

  it('opens the QR scanner after tapping the open-scanner button', async () => {
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<PairingScreen onPaired={jest.fn()} />)
    })

    await openScanner(tree!)
    const camera = tree!.root.findAll(node => (node.type as unknown) === 'Camera')[0]
    expect(camera.props.androidPreviewViewType).toBe('texture-view')
    expect(tree!.root.findAllByProps({ children: 'pairing.title' })).toHaveLength(0)
    expect(tree!.root.findAll(node => (node.type as unknown) === 'TextInput')).toHaveLength(0)
    expect(tree!.root.findAllByProps({ children: 'pairing.scanHint' }).length).toBeGreaterThan(0)
  })

  it('puts the raw scanned value into the pairing input and returns to the pairing page', async () => {
    const connect = jest.requireMock('nats.ws').connect as jest.Mock
    const onPaired = jest.fn()
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<PairingScreen onPaired={onPaired} />)
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
      tree = renderer.create(<PairingScreen onPaired={jest.fn()} />)
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
      tree = renderer.create(<PairingScreen onPaired={jest.fn()} />)
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
      renderer.create(<PairingScreen onPaired={jest.fn()} onSystemBack={onSystemBack} />)
    })

    expect(backPressHandler!(undefined as unknown as BackPressEvent)).toBe(true)
    expect(onSystemBack).toHaveBeenCalledTimes(1)
  })

  it('shows an authorization button when camera permission is missing', () => {
    mockHasPermission = false
    let tree: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(<PairingScreen onPaired={jest.fn()} />)
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
      tree = renderer.create(<PairingScreen onPaired={jest.fn()} />)
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
      tree = renderer.create(<PairingScreen onPaired={jest.fn()} />)
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
