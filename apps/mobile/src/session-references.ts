/**
 * Presentation of one session-reference row, shared by the `@` completion and
 * the composer's plus-menu. A host from dsh 0.1.6-alpha.2 on resolves a
 * `displayTitle` that prefers a subagent's own label, so a spawned session
 * reads as what it was asked to do instead of as its title; the session title
 * then stays visible beside the working directory.
 */
import type { MobileSessionReference } from '@dsh-mobile/protocol'

export interface SessionReferenceText {
  title: string
  subtitle: string
}

/**
 * `sameWorkspaceLabel` is the caller's translated stand-in for a session that
 * shares this one's working directory, where repeating the path says nothing.
 */
export function sessionReferenceText(
  reference: Pick<MobileSessionReference, 'label' | 'displayTitle' | 'cwd' | 'sameWorkspace'>,
  sameWorkspaceLabel: string,
): SessionReferenceText {
  const title = reference.displayTitle ?? reference.label
  const workspace = reference.sameWorkspace ? sameWorkspaceLabel : reference.cwd ?? sameWorkspaceLabel
  return {
    title,
    subtitle: title === reference.label ? workspace : `${reference.label} · ${workspace}`,
  }
}
