/**
 * Workspace-relative path helpers for the file browser.
 *
 * `workspaceFiles/list` speaks workspace paths: the listed directory reports
 * its own path and only basenames for children, so the client owns joining,
 * descending, and crumb building. Kept free of React so it stays unit-testable.
 */

/** One breadcrumb: the workspace root is the empty-path crumb. */
export interface WorkspaceCrumb {
  /** Basename shown in the trail; empty for the workspace root. */
  name: string
  /** Workspace-relative path this crumb navigates to. */
  path: string
}

/** Strips the leading and trailing separators hosts may echo back. */
function normalize(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '')
}

/** Joins one child basename onto a workspace-relative directory path. */
export function joinWorkspacePath(base: string, name: string): string {
  const parent = normalize(base)
  return parent === '' ? name : `${parent}/${name}`
}

/** Directory above one workspace-relative path; the root stays the root. */
export function parentWorkspacePath(path: string): string {
  const current = normalize(path)
  const cut = current.lastIndexOf('/')
  return cut === -1 ? '' : current.slice(0, cut)
}

/** Breadcrumb chain from the workspace root to `path`, both inclusive. */
export function workspaceCrumbs(path: string): WorkspaceCrumb[] {
  const current = normalize(path)
  const segments = current === '' ? [] : current.split('/')
  const crumbs: WorkspaceCrumb[] = [{ name: '', path: '' }]
  for (const [index, name] of segments.entries()) {
    crumbs.push({ name, path: segments.slice(0, index + 1).join('/') })
  }
  return crumbs
}

/** Directories first, then files, each name-sorted; `other` sinks to the end. */
export function sortWorkspaceEntries<T extends { name: string; type: 'file' | 'directory' | 'other' }>(
  entries: readonly T[],
): T[] {
  const rank = (entry: T): number => entry.type === 'directory' ? 0 : entry.type === 'file' ? 1 : 2
  return [...entries].sort((left, right) => {
    const byType = rank(left) - rank(right)
    return byType === 0 ? left.name.localeCompare(right.name) : byType
  })
}
