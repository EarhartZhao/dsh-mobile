import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({ t: (key: string) => key }),
}))

import { ConfirmModal } from './ConfirmModal'

/** Press the node whose subtree contains the given label. */
function press(tree: renderer.ReactTestRenderer, label: string): void {
  const button = tree.root.findAll(node =>
    typeof node.props.onPress === 'function' &&
    node.findAllByProps({ children: label }).length > 0,
  ).at(-1)
  act(() => { button!.props.onPress() })
}

describe('ConfirmModal', () => {
  const baseProps = {
    visible: true,
    title: '解除配对？',
    message: '本机将清除配对信息。',
    confirmLabel: '解除配对',
    cancelLabel: '取消',
    onCancel: jest.fn(),
    onConfirm: jest.fn(),
  }

  beforeEach(() => {
    baseProps.onCancel = jest.fn()
    baseProps.onConfirm = jest.fn()
  })

  it('shows the title and the consequence text without acting on its own', () => {
    let tree!: renderer.ReactTestRenderer
    act(() => { tree = renderer.create(<ConfirmModal {...baseProps} />) })

    expect(tree.root.findAllByProps({ children: '解除配对？' }).length).toBeGreaterThan(0)
    expect(tree.root.findAllByProps({ children: '本机将清除配对信息。' }).length).toBeGreaterThan(0)
    expect(baseProps.onConfirm).not.toHaveBeenCalled()
    expect(baseProps.onCancel).not.toHaveBeenCalled()
  })

  it('confirms only when the destructive action is pressed', () => {
    let tree!: renderer.ReactTestRenderer
    act(() => { tree = renderer.create(<ConfirmModal {...baseProps} />) })

    press(tree, '解除配对')

    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1)
    expect(baseProps.onCancel).not.toHaveBeenCalled()
  })

  it('cancels without confirming', () => {
    let tree!: renderer.ReactTestRenderer
    act(() => { tree = renderer.create(<ConfirmModal {...baseProps} />) })

    press(tree, '取消')

    expect(baseProps.onCancel).toHaveBeenCalledTimes(1)
    expect(baseProps.onConfirm).not.toHaveBeenCalled()
  })

  it('renders nothing while hidden', () => {
    let tree!: renderer.ReactTestRenderer
    act(() => { tree = renderer.create(<ConfirmModal {...baseProps} visible={false} />) })

    expect(tree.root.findAllByProps({ children: '解除配对？' })).toHaveLength(0)
  })
})
