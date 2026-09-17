import React from 'react'
import renderer, { act } from 'react-test-renderer'
import type { ConnectionManager } from '@dsh-mobile/core'

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({ t: (key: string) => key }),
}))

import { SessionListScreen } from './SessionListScreen'

/** Only the surface the list touches; the unpair affordance must be gone. */
const manager = {
  compatibility: { pluginVersion: '0.2.7', mobileApi: 2, features: [] },
  store: {
    on: () => () => undefined,
    summaries: [],
    workspaces: [],
    archivedSessionIds: [],
  },
  client: undefined,
} as unknown as ConnectionManager

describe('SessionListScreen header', () => {
  it('no longer offers unpairing outside of settings', () => {
    let tree!: renderer.ReactTestRenderer
    act(() => {
      tree = renderer.create(
        <SessionListScreen
          manager={manager}
          onOpenSession={jest.fn()}
          onOpenSettings={jest.fn()}
        />,
      )
    })

    expect(tree.root.findAllByProps({ children: 'session.unpair' })).toHaveLength(0)
  })
})
