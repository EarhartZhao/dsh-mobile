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

const scheme = Appearance.getColorScheme() === 'light' ? 'light' : 'dark'

/** Visual tokens, mobile-adapted from the harness web UI (dark first). */
export const colors = scheme === 'light' ? lightColors : darkColors

export const spacing = (n: number): number => n * 4

/**
 * Web-parity surface tokens for the conversation.
 *
 * Every name is the harness web UI's own alias (`ui-theme/src/styles/
 * design-platform.css`), so the transcript is styled from the same words the
 * browser stylesheet uses instead of a parallel vocabulary. The shell
 * (session list, settings, pairing) keeps {@link colors}; this set is what the
 * chat screen, its disclosure rows and its composer draw with.
 */
export interface ChatTokens {
  /** `bg-base`: the transcript's own surface. */
  bgBase: string
  /** `specific-bubble`: the user's prompt fill. */
  bubble: string
  /** `specific-input-major`: the composer card. */
  inputCard: string
  /** `specific-selector`: the 28px attach circle. */
  selector: string
  /** `button-floating-fill`: the floating scroll-to-bottom control. */
  floating: string
  /** `specific-menu`: the stat panels' translucent surface. */
  menu: string
  /** `markdown-code-block` / `markdown-inline-code`. */
  codeBlock: string
  inlineCode: string
  labelPrimary: string
  labelSecondary: string
  labelTertiary: string
  labelCaption: string
  borderL1: string
  borderL2: string
  borderL3: string
  borderL4: string
  /** `interactive-bg-hover` (translucent) and `…-hover-solid`. */
  hover: string
  hoverSolid: string
  /** `button-info-fill` / `button-info-hover`: the send circle. */
  infoFill: string
  infoHover: string
  /** `label-deep-diving`: the running status line's colour. */
  deepDiving: string
  link: string
  success: string
  warn: string
  error: string
  /** The 0.5px elevation hairline, pre-multiplied for `borderWidth`. */
  stroke: string
}

const lightChat: ChatTokens = {
  bgBase: 'rgb(255, 255, 255)',
  bubble: 'rgb(237, 243, 254)',
  inputCard: 'rgb(255, 255, 255)',
  selector: 'rgb(245, 246, 247)',
  floating: 'rgb(255, 255, 255)',
  menu: 'rgba(248, 249, 250, 0.94)',
  codeBlock: 'rgb(249, 250, 251)',
  inlineCode: 'rgb(250, 250, 250)',
  labelPrimary: 'rgb(15, 17, 21)',
  labelSecondary: 'rgb(97, 102, 107)',
  labelTertiary: 'rgb(129, 133, 140)',
  labelCaption: 'rgb(173, 178, 184)',
  borderL1: 'rgba(0, 0, 0, 0.04)',
  borderL2: 'rgba(0, 0, 0, 0.10)',
  borderL3: 'rgba(0, 0, 0, 0.12)',
  borderL4: 'rgba(0, 0, 0, 0.16)',
  hover: 'rgba(38, 49, 72, 0.06)',
  hoverSolid: 'rgb(241, 243, 245)',
  infoFill: 'rgb(65, 118, 230)',
  infoHover: 'rgb(122, 170, 255)',
  // color-mix(deepseek-500 70%, blue-950).
  deepDiving: 'rgb(52, 94, 186)',
  link: 'rgb(65, 118, 230)',
  success: 'rgb(34, 197, 94)',
  warn: 'rgb(245, 158, 11)',
  error: 'rgb(236, 19, 19)',
  stroke: 'rgba(0, 0, 0, 0.10)',
}

const darkChat: ChatTokens = {
  bgBase: 'rgb(21, 21, 23)',
  bubble: 'rgb(44, 44, 46)',
  inputCard: 'rgb(44, 44, 46)',
  selector: 'rgb(53, 54, 56)',
  floating: 'rgb(44, 44, 46)',
  menu: 'rgba(48, 49, 54, 0.94)',
  codeBlock: 'rgb(27, 27, 28)',
  inlineCode: 'rgb(41, 41, 41)',
  labelPrimary: 'rgb(249, 250, 251)',
  labelSecondary: 'rgb(207, 211, 214)',
  labelTertiary: 'rgb(173, 178, 184)',
  labelCaption: 'rgb(129, 133, 140)',
  borderL1: 'rgba(255, 255, 255, 0.06)',
  borderL2: 'rgba(255, 255, 255, 0.12)',
  borderL3: 'rgba(255, 255, 255, 0.16)',
  borderL4: 'rgba(255, 255, 255, 0.20)',
  hover: 'rgba(255, 255, 255, 0.08)',
  hoverSolid: 'rgb(53, 54, 56)',
  infoFill: 'rgb(122, 170, 255)',
  infoHover: 'rgb(65, 118, 230)',
  // color-mix(deepseek-450 55%, neutral-bluish-400).
  deepDiving: 'rgb(125, 154, 223)',
  link: 'rgb(122, 170, 255)',
  success: 'rgb(34, 197, 94)',
  warn: 'rgb(245, 158, 11)',
  error: 'rgb(242, 90, 90)',
  stroke: 'rgba(255, 255, 255, 0.12)',
}

export const chat = scheme === 'light' ? lightChat : darkChat

/**
 * The web's type ladder for conversation content: body 14/24, the secondary
 * tier 13/20 (every disclosure title and summary), the prompt bubble 14/22,
 * and the action/clock caption 12/20.
 */
export const chatText = {
  body: { fontSize: 14, lineHeight: 24 },
  secondary: { fontSize: 13, lineHeight: 20 },
  bubble: { fontSize: 14, lineHeight: 22 },
  caption: { fontSize: 12, lineHeight: 20 },
} as const

/**
 * The web elevation tiers as `boxShadow` strings (0.5px stroke plus a soft
 * glow). New Architecture renders these on both platforms; a hairline border
 * is applied alongside so the stroke survives a renderer without `boxShadow`.
 */
export const shadow = {
  /** Menus and floating controls. */
  panel: `0 0 0 0.5px ${chat.stroke}, 0 3px 8px rgba(0, 0, 0, 0.03), 0 0 16px rgba(0, 0, 0, 0.02)`,
  /** Stat panels, which sit above the composer. */
  prominent: `0 0 0 0.5px ${chat.stroke}, 0 3px 8px rgba(0, 0, 0, 0.04), 0 0 20px rgba(0, 0, 0, 0.05)`,
  /** The composer card: a wider, fainter glow. */
  soft: `0 0 0 0.5px ${chat.borderL2}, 0 4px 16px rgba(0, 0, 0, 0.03), 0 0 24px rgba(0, 0, 0, 0.03)`,
  /**
   * The transcript's own edges: the header's bottom and the composer band's
   * top. Weaker than the panel tiers on purpose — this is a separator, not a
   * surface being lifted, and the transcript scrolls right past it.
   */
  edgeDown: '0 2px 6px rgba(0, 0, 0, 0.05)',
  edgeUp: '0 -2px 6px rgba(0, 0, 0, 0.05)',
} as const

export const radius = {
  /** Nested cards inside the transcript (tool bodies, file cards). */
  card: 8,
  sm: 8,
  md: 12,
  lg: 16,
  /** The web's `radius-xl`: the user's prompt bubble. */
  bubble: 20,
  xl: 20,
  /** The web's `radius-panel`: menus and the composer card. */
  panel: 28,
}

export const fontSize = {
  body: 15,
  small: 13,
  tiny: 11,
  title: 17,
  /** Group headers in the session list, matched to the web sidebar's 14px. */
  section: 14,
}
