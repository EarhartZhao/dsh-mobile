import React from 'react'
import renderer, { act } from 'react-test-renderer'
import type { ConnectionManager, ConversationImage } from '@dsh-mobile/core'

jest.mock('../i18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useI18n: () => ({ t: (key: string) => key }),
}))

import { AttachmentImage } from './AttachmentImage'

const trees: renderer.ReactTestRenderer[] = []

function render(image: ConversationImage, manager: ConnectionManager): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  act(() => {
    tree = renderer.create(
      <AttachmentImage
        image={image}
        manager={manager}
        sessionId="s1"
        style={{ width: 100 }}
        fallbackStyle={{ color: '#000' }}
      />,
    )
  })
  trees.push(tree)
  return tree
}

afterEach(() => {
  act(() => {
    for (const tree of trees) tree.unmount()
  })
  trees.length = 0
})

function attachmentResult(): { result: { ok: true; value: { attachment: { mediaType: string; width: number; height: number }; data: string } } } {
  return {
    result: {
      ok: true,
      value: {
        attachment: { mediaType: 'image/png', width: 800, height: 600 },
        data: 'QUJD',
      },
    },
  }
}

function managerWith(attachment: jest.Mock): ConnectionManager {
  return { client: { sessions: { attachment } } } as unknown as ConnectionManager
}

function hasSource(tree: renderer.ReactTestRenderer, uri: string): boolean {
  return tree.root.findAll(node =>
    typeof node.props.source === 'object' && node.props.source !== null &&
    node.props.source.uri === uri,
  ).length > 0
}

describe('AttachmentImage', () => {
  it('renders a data image without a host round trip', () => {
    const tree = render({ kind: 'data', uri: 'data:image/png;base64,AA', name: 'shot' }, managerWith(jest.fn()))

    expect(hasSource(tree, 'data:image/png;base64,AA')).toBe(true)
    expect(tree.root.findAllByProps({ children: 'chat.imageLoading' })).toHaveLength(0)
  })

  it('resolves an attachment image from the host and shows it', async () => {
    const attachment = jest.fn().mockResolvedValue(attachmentResult())
    const tree = render({ kind: 'attachment', attachmentId: 'a1', name: 'shot' }, managerWith(attachment))

    await act(async () => {})

    expect(attachment).toHaveBeenCalledWith({ sessionId: 's1', attachmentId: 'a1' })
    expect(hasSource(tree, 'data:image/png;base64,QUJD')).toBe(true)
    expect(tree.root.findAllByProps({ children: 'chat.imageLoading' })).toHaveLength(0)
  })

  it('shows a failure state instead of a permanent loading placeholder', async () => {
    const attachment = jest.fn().mockRejectedValue(new Error('host unreachable'))
    const tree = render({ kind: 'attachment', attachmentId: 'a1' }, managerWith(attachment))

    await act(async () => {})

    expect(tree.root.findAllByProps({ children: 'chat.imageLoading' })).toHaveLength(0)
    expect(tree.root.findAllByProps({ children: 'chat.imageFailed' }).length).toBeGreaterThan(0)
  })

  it('retries a failed attachment load on tap', async () => {
    const attachment = jest.fn()
      .mockRejectedValueOnce(new Error('host unreachable'))
      .mockResolvedValueOnce(attachmentResult())
    const tree = render({ kind: 'attachment', attachmentId: 'a1' }, managerWith(attachment))

    await act(async () => {})
    expect(tree.root.findAllByProps({ children: 'chat.imageFailed' }).length).toBeGreaterThan(0)

    const retry = tree.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.findAllByProps({ children: 'chat.imageFailed' }).length > 0,
    ).at(-1)!
    act(() => { retry.props.onPress() })
    await act(async () => {})

    expect(attachment).toHaveBeenCalledTimes(2)
    expect(hasSource(tree, 'data:image/png;base64,QUJD')).toBe(true)
  })

  it('fails fast while the client is disconnected', () => {
    const tree = render({ kind: 'attachment', attachmentId: 'a1' }, { client: null } as unknown as ConnectionManager)

    expect(tree.root.findAllByProps({ children: 'chat.imageFailed' }).length).toBeGreaterThan(0)
  })

  it('retries automatically once the client reconnects', async () => {
    const attachment = jest.fn().mockResolvedValue(attachmentResult())
    const tree = render({ kind: 'attachment', attachmentId: 'a1' }, { client: null } as unknown as ConnectionManager)
    expect(tree.root.findAllByProps({ children: 'chat.imageFailed' }).length).toBeGreaterThan(0)

    act(() => {
      tree.update(
        <AttachmentImage
          image={{ kind: 'attachment', attachmentId: 'a1' }}
          manager={managerWith(attachment)}
          sessionId="s1"
          style={{ width: 100 }}
          fallbackStyle={{ color: '#000' }}
        />,
      )
    })
    await act(async () => {})

    expect(attachment).toHaveBeenCalledWith({ sessionId: 's1', attachmentId: 'a1' })
    expect(hasSource(tree, 'data:image/png;base64,QUJD')).toBe(true)
  })
})
