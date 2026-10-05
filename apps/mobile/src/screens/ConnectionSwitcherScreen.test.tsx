import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      values === undefined ? key : `${key}(${Object.values(values).join(',')})`,
  }),
}))

import { ConnectionSwitcherScreen } from './ConnectionSwitcherScreen'
import type { Profile } from '../pairing-store'

function profile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    label: '',
    machineName: '',
    addedAt: '2026-01-01T00:00:00.000Z',
    hub: `wss://${id}.test:8443`,
    user: 'c-end-test',
    pass: 'secret',
    instance: id,
    ca: 'CA-DER',
    caFp: 'AA:BB',
    token: `token-${id}`,
    deviceId: `device-${id}`,
    expiresAt: '2026-12-31T00:00:00.000Z',
    ...overrides,
  }
}

function render(overrides: Partial<React.ComponentProps<typeof ConnectionSwitcherScreen>> = {}) {
  const props = {
    profiles: [profile('home'), profile('home-mac', { machineName: '工作台 Mac' })],
    activeId: 'home',
    onSwitch: jest.fn(),
    onRemove: jest.fn(),
    onRename: jest.fn(),
    onAdd: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  }
  let tree!: renderer.ReactTestRenderer
  act(() => { tree = renderer.create(<ConnectionSwitcherScreen {...props} />) })
  return { tree, props }
}

/** Press the deepest node carrying the given accessibility label. */
function pressLabel(tree: renderer.ReactTestRenderer, label: string): void {
  const button = tree.root.findAll(node =>
    typeof node.props.onPress === 'function' && node.props.accessibilityLabel === label,
  ).at(-1)
  act(() => { button!.props.onPress() })
}

/** Every accessibility label currently in the tree. */
function labels(tree: renderer.ReactTestRenderer): string[] {
  return tree.root.findAll(node => typeof node.props.accessibilityLabel === 'string')
    .map(node => node.props.accessibilityLabel as string)
}

/** Text nodes whose content is exactly `value`, as the i18n mock renders it. */
function hasText(tree: renderer.ReactTestRenderer, value: string): boolean {
  return tree.root.findAll(node => node.props.children === value).length > 0
}

describe('ConnectionSwitcherScreen', () => {
  it('lists one row per saved connection', () => {
    const { tree } = render()

    // The i18n mock renders keys verbatim, so a row reads "<name> <key>".
    expect(labels(tree)).toContain('home connections.current')
    expect(labels(tree)).toContain('工作台 Mac connections.switch')
  })

  it('switches to the tapped connection', () => {
    const { tree, props } = render()
    pressLabel(tree, '工作台 Mac connections.switch')
    expect(props.onSwitch).toHaveBeenCalledWith('home-mac')
  })

  it('adds another machine from the header', () => {
    const { tree, props } = render()
    pressLabel(tree, 'connections.add')
    expect(props.onAdd).toHaveBeenCalledTimes(1)
  })

  it('renames a connection from its row', () => {
    const { tree, props } = render()
    pressLabel(tree, 'connections.rename: 工作台 Mac')

    const input = tree.root.findByProps({ accessibilityLabel: 'connections.rename' })
    act(() => { input.props.onChangeText('书房 PC') })
    act(() => { input.props.onSubmitEditing() })

    expect(props.onRename).toHaveBeenCalledWith('home-mac', '书房 PC')
  })

  it('starts a rename from the name the row currently shows', () => {
    const { tree } = render()
    pressLabel(tree, 'connections.rename: home')
    const input = tree.root.findByProps({ accessibilityLabel: 'connections.rename' })
    expect(input.props.value).toBe('home')
  })

  it('removes a connection only after the confirmation', () => {
    const { tree, props } = render()
    pressLabel(tree, 'connections.remove: 工作台 Mac')

    // The dialog names what is about to go, and nothing has been removed yet.
    expect(hasText(tree, 'connections.removeConfirmMessage(工作台 Mac)')).toBe(true)
    expect(props.onRemove).not.toHaveBeenCalled()

    pressLabel(tree, 'connections.removeConfirmAction')
    expect(props.onRemove).toHaveBeenCalledWith('home-mac')
  })

  it('cancelling the confirmation keeps the connection', () => {
    const { tree, props } = render()
    pressLabel(tree, 'connections.remove: 工作台 Mac')
    pressLabel(tree, 'common.cancel')

    expect(props.onRemove).not.toHaveBeenCalled()
    expect(labels(tree)).not.toContain('connections.removeConfirmAction')
  })

  it('says so when nothing is saved', () => {
    const { tree } = render({ profiles: [], activeId: null })
    expect(hasText(tree, 'connections.empty')).toBe(true)
    expect(labels(tree)).not.toContain('home connections.current')
  })
})
