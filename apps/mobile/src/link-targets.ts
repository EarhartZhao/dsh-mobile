/**
 * What a link inside a transcript should do on a phone.
 *
 * Model answers are full of links, and only some of them are web URLs: this
 * project's own replies cite workspace files (`docs/architecture.md`,
 * `packages/core/src/index.ts`) and sometimes host paths. The markdown renderer's
 * default is `Linking.openURL(href)`, which is useless for a relative path (no
 * scheme → the OS rejects it, so tapping a file link silently did nothing) and
 * wrong for a bare path that happens to look like one.
 *
 * This module is the pure classification the caller acts on: external URLs open
 * outside the app, file references open the workspace preview, and anything this
 * build has no handler for is ignored rather than half-opened.
 */

export type LinkTarget =
  /** A URL the OS can open (`http`, `https`, `mailto`, `tel`). */
  | { kind: 'external'; url: string }
  /** A file reference: workspace-relative, POSIX-absolute, or a Windows path. */
  | { kind: 'file'; path: string }
  /** Nothing this build should act on. */
  | { kind: 'ignore' }

/** Schemes the OS opens for us. Everything else is app vocabulary, not a URL. */
const EXTERNAL_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto', 'tel'])

/** A Windows drive path must be read as a path, not as a one-letter scheme. */
const WINDOWS_PATH = /^[a-zA-Z]:[\\/]/

/**
 * Classify one markdown link target.
 *
 * @param href - the link target exactly as the Markdown carried it.
 * @returns the action to take; `ignore` for anchors, empty targets, and schemes
 *   this client has no handler for (`dsh-session:`, `dsh-resource:`, …).
 */
export function linkTarget(href: string): LinkTarget {
  const value = href.trim()
  if (value === '' || value.startsWith('#')) return { kind: 'ignore' }
  if (WINDOWS_PATH.test(value)) return { kind: 'file', path: stripLocation(value) }
  if (/^file:/iu.test(value)) {
    const path = value.replace(/^file:\/\//iu, '').replace(/^file:/iu, '')
    return path === '' ? { kind: 'ignore' } : { kind: 'file', path: stripLocation(path) }
  }
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/u.exec(value)?.[1]?.toLowerCase()
  if (scheme !== undefined) {
    return EXTERNAL_SCHEMES.has(scheme) ? { kind: 'external', url: value } : { kind: 'ignore' }
  }
  // No scheme at all: a path relative to the session workspace.
  return { kind: 'file', path: stripLocation(value) }
}

/**
 * Drop the fragment/query a preview cannot honour (`docs/a.md#L10` still names
 * the file) and decode percent-escapes so a path with spaces reaches the reader.
 */
function stripLocation(value: string): string {
  const cut = value.search(/[#?]/u)
  const path = cut === -1 ? value : value.slice(0, cut)
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}
