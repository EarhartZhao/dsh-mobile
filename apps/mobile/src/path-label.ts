/**
 * The directory label the conversation header shows.
 *
 * A workspace path is routinely deeper than the phone is wide — the header's
 * own line was the whole `/Users/…/deepseek-harness`, and the tail (the part
 * that identifies the project) is exactly what a one-line label truncates away.
 * So the label keeps the last segments and marks the cut with an ellipsis, and
 * the reader taps it when they want the whole thing.
 */

/**
 * Fold an absolute path to its last `keep` segments.
 *
 * Windows hosts write `E:\Users\admin\.dsh\profiles\web` while POSIX ones write
 * `/Users/mac/…`; both separators split, and the fold is expressed with `/`
 * (the shape the identifier is read in, not the shape it was written in).
 *
 * @param value - the absolute path, as the Host reported it.
 * @param keep - how many trailing segments to keep.
 * @returns the folded label, or the path unchanged when it is already short.
 */
export function foldPath(value: string, keep = 2): string {
  const trimmed = value.replace(/[/\\]+$/u, '')
  if (trimmed === '') return value
  // A leading separator leaves an empty first segment; it is the root, not a
  // segment of its own, so it does not count towards `keep`.
  const parts = trimmed.split(/[/\\]+/u).filter(part => part !== '')
  if (parts.length <= keep + 1) return trimmed
  return `…/${parts.slice(-keep).join('/')}`
}
