/**
 * Session labels, matching the Web client's own rules so the two surfaces name
 * a Session identically.
 *
 * The Web sidebar labels a row `blank ? 新会话 : (title || 未命名)` and never
 * shows a path there, while the conversation header shows the client's
 * `displayTitle` (`title ?? basename(cwd) ?? id`). The App used to fall back to
 * the whole cwd on both surfaces, which made an untitled chat read as
 * `C:\code\learner` instead of the name the Web shows.
 */

/** Basename of a workspace path; both separators split, trailing ones are dropped. */
export function workspaceBasename(path: string | undefined): string {
  if (path === undefined) return ''
  const trimmed = path.replace(/[/\\]+$/u, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1)
}

/** Conversation header label: the durable title, else the workspace name, else the id. */
export function sessionDisplayTitle(input: { title?: string | null, cwd?: string, sessionId: string }): string {
  const title = input.title?.trim()
  if (title !== undefined && title !== '') return title
  const base = workspaceBasename(input.cwd)
  return base !== '' ? base : input.sessionId
}

/** Session-list row label: the provisional chat names a blank row, never its path. */
export function sessionRowTitle(
  input: { blank: boolean, title?: string | null },
  labels: { blank: string, untitled: string },
): string {
  if (input.blank) return labels.blank
  const title = input.title?.trim()
  return title === undefined || title === '' ? labels.untitled : title
}

/**
 * The child title a fork takes, copied from the Web client's own rule: an
 * existing `(N)` / `（N）` suffix steps up, and a title without one becomes
 * `… (1)`. The Web's `sessions.fork` renames the child before it resolves, so a
 * branch never reads as its source in the sidebar — a phone that forks has to
 * apply the same rule itself, because `increaseTitle` is client-side.
 * @param title - the source session's durable title.
 * @returns the incremented title; an empty source title stays empty.
 */
export function increasedForkTitle(title: string): string {
  if (title.trim() === '') return title
  const ascii = /^(.*?)\((\d+)\)$/u.exec(title)
  if (ascii?.[1] !== undefined && ascii[2] !== undefined) {
    return `${ascii[1]}(${BigInt(ascii[2]) + 1n})`
  }
  const fullWidth = /^(.*?)（(\d+)）$/u.exec(title)
  if (fullWidth?.[1] !== undefined && fullWidth[2] !== undefined) {
    return `${fullWidth[1]}（${BigInt(fullWidth[2]) + 1n}）`
  }
  return `${title} (1)`
}
