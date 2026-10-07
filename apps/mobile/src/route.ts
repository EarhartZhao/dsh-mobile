/**
 * Which screen is up, plus the conversation lineage a back gesture retraces.
 *
 * The subagent switcher opens a child conversation from its parent's header,
 * and the child's own header carries no switcher — its children are its own.
 * So without a lineage, following a child and coming back landed on the session
 * list: the reader lost the conversation they had been reading, and the child
 * is not even in that list. Kept pure and outside the component so the retrace
 * rules get tests of their own.
 */

export type Route =
  | { name: 'list' }
  | { name: 'chat'; sessionId: string }
  | { name: 'settings' }
  | { name: 'plugins' }
  | { name: 'connections' }
  | { name: 'pairing' }

export interface NavState {
  route: Route
  /** Conversations above the one on screen, oldest first: one entry per hop. */
  chatTrail: readonly string[]
}

export const INITIAL_NAV: NavState = { route: { name: 'list' }, chatTrail: [] }

/**
 * Show one screen. Any screen but a conversation drops the lineage: back is a
 * way out of the conversation the reader followed, not a redo stack.
 */
export function routeTo(state: NavState, route: Route): NavState {
  return { route, chatTrail: route.name === 'chat' ? state.chatTrail : [] }
}

/**
 * Open one conversation. Opened from another conversation — the switcher, or a
 * subagent's own header — the one it came from is remembered, so back retraces
 * the hop; opened from anywhere else the lineage starts over.
 */
export function openChat(state: NavState, sessionId: string): NavState {
  const from = state.route.name === 'chat' ? state.route.sessionId : null
  const trail = from === null || from === sessionId
    ? (from === null ? [] : state.chatTrail)
    : [...state.chatTrail, from]
  return { route: { name: 'chat', sessionId }, chatTrail: trail }
}

/**
 * Back out of a conversation: the one it was opened from, or the session list
 * when it was opened from there.
 */
export function closeChat(state: NavState): NavState {
  const parent = state.chatTrail.at(-1)
  return parent === undefined
    ? INITIAL_NAV
    : { route: { name: 'chat', sessionId: parent }, chatTrail: state.chatTrail.slice(0, -1) }
}
