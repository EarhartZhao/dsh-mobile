import { Appearance } from 'react-native'

const lightColors = {
  bg: '#f5f6f8',
  bgElevated: '#ffffff',
  bgBubbleUser: '#d9e7ff',
  bgBubbleAssistant: '#ffffff',
  border: '#d8dbe2',
  text: '#1c2029',
  textDim: '#68707e',
  accent: '#2563eb',
  success: '#15803d',
  warning: '#b45309',
  danger: '#dc2626',
  running: '#2563eb',
}

const darkColors = {
  bg: '#0f1115',
  bgElevated: '#171a21',
  bgBubbleUser: '#274063',
  bgBubbleAssistant: '#1c2029',
  border: '#2a2f3a',
  text: '#e6e9ef',
  textDim: '#9aa3b2',
  accent: '#4f8cff',
  success: '#3fb96c',
  warning: '#d9a13b',
  danger: '#d95757',
  running: '#4f8cff',
}

/** Visual tokens, mobile-adapted from the harness web UI (dark first). */
export const colors = Appearance.getColorScheme() === 'light' ? lightColors : darkColors

export const spacing = (n: number): number => n * 4

export const radius = {
  card: 8,
  bubble: 12,
}

export const fontSize = {
  body: 15,
  small: 13,
  tiny: 11,
  title: 17,
}
