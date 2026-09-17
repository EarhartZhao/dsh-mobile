import React from 'react'
import renderer, { act } from 'react-test-renderer'
import type { ConnectionManager } from '@dsh-mobile/core'

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      values === undefined ? key : `${key}(${Object.values(values).join(',')})`,
  }),
}))

import { SettingsScreen } from './SettingsScreen'

const manager = {
  compatibility: { pluginVersion: '0.2.7', mobileApi: 2, features: ['goal-state', 'open-path'] },
} as unknown as ConnectionManager

function entry(entryId: string, enabled: boolean) {
  return { entryId, moduleName: `mod-${entryId}`, enabled, fiberPhase: 'active' as const }
}

function render(overrides: Partial<React.ComponentProps<typeof SettingsScreen>> = {}) {
  const props = {
    manager,
    connState: 'online' as const,
    errors: [],
    events: [],
    inventory: { entries: [entry('a', true), entry('b', false), entry('c', true)] },
    themeMode: 'system' as const,
    setTheme: jest.fn(),
    language: 'system' as const,
    setLanguage: jest.fn(),
    enterToSend: false,
    setEnterToSend: jest.fn(),
    onOpenDiagnostics: jest.fn(),
    onOpenPlugins: jest.fn(),
    onUnpair: jest.fn(),
    onBack: jest.fn(),
    appVersion: '0.0.3',
    ...overrides,
  }
  let tree!: renderer.ReactTestRenderer
  act(() => { tree = renderer.create(<SettingsScreen {...props} />) })
  return { tree, props }
}

/** Press the node whose subtree contains the given label. */
function press(tree: renderer.ReactTestRenderer, label: string): void {
  const button = tree.root.findAll(node =>
    typeof node.props.onPress === 'function' &&
    node.findAllByProps({ children: label }).length > 0,
  ).at(-1)
  act(() => { button!.props.onPress() })
}

describe('SettingsScreen plugin section', () => {
  it('summarises the plugin count instead of listing every plugin inline', () => {
    const { tree } = render()

    expect(tree.root.findAllByProps({ children: 'plugins.summary(3,2)' }).length).toBeGreaterThan(0)
    // The full list moved to its own page: no module rows here anymore.
    for (const id of ['mod-a', 'mod-b', 'mod-c']) {
      expect(tree.root.findAllByProps({ children: id })).toHaveLength(0)
    }
  })

  it('opens the plugin page from the summary row', () => {
    const { tree, props } = render()

    press(tree, 'plugins.summary(3,2)')

    expect(props.onOpenPlugins).toHaveBeenCalledTimes(1)
  })

  it('still distinguishes loading, unavailable, and empty inventories', () => {
    expect(render({ inventory: undefined }).tree.root.findAllByProps({ children: 'inventory.loading' }).length)
      .toBeGreaterThan(0)
    expect(render({ inventory: null }).tree.root.findAllByProps({ children: 'inventory.unavailable' }).length)
      .toBeGreaterThan(0)
    expect(render({ inventory: { entries: [] } }).tree.root.findAllByProps({ children: 'inventory.empty' }).length)
      .toBeGreaterThan(0)
  })
})

describe('SettingsScreen unpair', () => {
  it('asks for confirmation before unpairing', () => {
    const { tree, props } = render()

    press(tree, 'session.unpair')

    expect(tree.root.findAllByProps({ children: 'settings.unpairConfirmTitle' }).length).toBeGreaterThan(0)
    expect(props.onUnpair).not.toHaveBeenCalled()
  })

  it('unpairs once the confirmation is accepted', () => {
    const { tree, props } = render()

    press(tree, 'session.unpair')
    press(tree, 'settings.unpairConfirmAction')

    expect(props.onUnpair).toHaveBeenCalledTimes(1)
  })

  it('leaves the pairing alone when the confirmation is dismissed', () => {
    const { tree, props } = render()

    press(tree, 'session.unpair')
    press(tree, 'common.cancel')

    expect(props.onUnpair).not.toHaveBeenCalled()
  })
})
