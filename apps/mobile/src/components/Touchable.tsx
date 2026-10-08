/**
 * The app's pressable.
 *
 * React Native dims a `TouchableOpacity` to `activeOpacity` 0.2, which on a
 * light surface washes the control out to nearly nothing — the flash the
 * composer's chips and the list rows used to show. Every control in the app
 * presses to the same 0.8 instead, a dim that reads as "held" without making
 * the label disappear; a caller may still pass its own `activeOpacity`.
 */
import React from 'react'
import {
  TouchableOpacity as NativeTouchableOpacity,
  type HostInstance,
  type TouchableOpacityProps,
} from 'react-native'

/** What every pressable in the app dims to while it is held. */
export const PRESS_OPACITY = 0.8

export const TouchableOpacity = React.forwardRef<HostInstance, TouchableOpacityProps>(function AppTouchableOpacity(
  { activeOpacity = PRESS_OPACITY, ...rest },
  ref,
): React.JSX.Element {
  // React Native types the touchable's own ref as the component rather than the
  // view it renders, so the handle is passed through untyped.
  return <NativeTouchableOpacity ref={ref as never} activeOpacity={activeOpacity} {...rest} />
})
