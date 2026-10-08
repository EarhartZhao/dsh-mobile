/**
 * Every pressable in the app is React Native's touchable with one different
 * default. A held control dims to 0.8; the stock 0.2 washes a light surface
 * out to almost nothing, which is the flash the composer's chips used to show.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity as NativeTouchableOpacity } from 'react-native'
import { PRESS_OPACITY, TouchableOpacity } from './Touchable'

const trees: renderer.ReactTestRenderer[] = []

function render(element: React.ReactElement): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer
  act(() => { tree = renderer.create(element) })
  trees.push(tree)
  return tree
}

afterEach(() => {
  for (const tree of trees.splice(0)) act(() => { tree.unmount() })
})

/** The native touchable the wrapper renders, which is what carries the dim. */
function inner(tree: renderer.ReactTestRenderer): renderer.ReactTestInstance {
  return tree.root.findAllByType(NativeTouchableOpacity)[0]
}

describe('TouchableOpacity', () => {
  it('dims a held control to the app press opacity', () => {
    const tree = render(<TouchableOpacity onPress={() => {}} />)
    expect(PRESS_OPACITY).toBe(0.8)
    expect(inner(tree).props.activeOpacity).toBe(PRESS_OPACITY)
  })

  it('lets a surface that is not a button stay flat under the finger', () => {
    const tree = render(<TouchableOpacity activeOpacity={1} onLongPress={() => {}} />)
    expect(inner(tree).props.activeOpacity).toBe(1)
  })
})
