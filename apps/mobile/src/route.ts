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
  /**
   * One conversation's trajectory, opened from its own header. A sub-page of
   * the conversation rather than a peer of it: the lineage above is kept, so
   * backing out of the trajectory lands on the conversation it belongs to.
   */
  | { name: 'trajectory'; sessionId: string }
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

/** The two routes that show a conversation, and so keep its lineage. */
const showsConversation = (route: Route): boolean =>
  route.name === 'chat' || route.name === 'trajectory'

/**
 * Show one screen. Any screen but a conversation drops the lineage: back is a
 * way out of the conversation the reader followed, not a redo stack.
 */
export function routeTo(state: NavState, route: Route): NavState {
  return { route, chatTrail: showsConversation(route) ? state.chatTrail : [] }
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

/**
 * Open one conversation's trajectory. The hop it was opened through stays on
 * the trail, so leaving the trajectory walks back into the conversation and
 * only then out to whatever that conversation was opened from.
 */
export function openTrajectory(state: NavState, sessionId: string): NavState {
  return { route: { name: 'trajectory', sessionId }, chatTrail: state.chatTrail }
}

/** Leave a trajectory: the conversation it belongs to, which is where it opened. */
export function closeTrajectory(state: NavState): NavState {
  return state.route.name === 'trajectory'
    ? { route: { name: 'chat', sessionId: state.route.sessionId }, chatTrail: state.chatTrail }
    : state
}
