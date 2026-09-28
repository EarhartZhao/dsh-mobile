/**
 * File-kind helpers for the preview sheet: extension mapping, preview mode,
 * and the Markdown references a document pulls in through `readRelated`.
 * React-free so the parsing rules stay unit-testable.
 */

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

/** Markdown image targets, used to pull a document's own referenced images. */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(([^)\s]+)/g
/** How many relative references one preview resolves. */
export const MAX_RELATIVE_IMAGES = 4

/** Lowercased extension of a path's last segment; empty when it has none. */
export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? path
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** Media type of an image path, or undefined when the kind is not previewable. */
export function imageMediaTypeOf(path: string): string | undefined {
  return IMAGE_TYPES[extensionOf(path)]
}

/** Whether a path should render as Markdown-flavoured text. */
export function isMarkdown(path: string): boolean {
  const extension = extensionOf(path)
  return extension === 'md' || extension === 'markdown'
}

/**
 * Extensions that need an application to open: the phone cannot render them, and
 * neither can this sheet. The list is by intent, not by exclusion — a `.pdf` or
 * `.docx` is exactly the case the hand-off exists for, while an unknown
 * extension is still attempted as text.
 */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf',
  'zip', 'gz', 'tgz', 'tar', '7z', 'rar', 'bz2', 'xz',
  'mp3', 'wav', 'm4a', 'ogg', 'flac', 'mp4', 'mov', 'avi', 'mkv', 'webm',
  'ttf', 'otf', 'woff', 'woff2', 'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'sqlite', 'db', 'class', 'jar',
])

/** How this client should present one path. */
export type PreviewKind = 'image' | 'text' | 'binary'

/**
 * Classify a path for the preview sheet: images render inline, text renders as
 * text, and everything else is handed to an application that can open it.
 *
 * @param path - the file path (any separator style).
 * @returns the preview mode this client uses.
 */
export function previewKindOf(path: string): PreviewKind {
  if (imageMediaTypeOf(path) !== undefined) return 'image'
  if (BINARY_EXTENSIONS.has(extensionOf(path))) return 'binary'
  // Everything else is attempted as text: the host's read either returns text or
  // fails loudly, and a wrong guess costs one round trip rather than a blank card.
  return 'text'
}

/**
 * Relative image targets of one Markdown page. Absolute paths, URLs, anchors,
 * and non-image kinds are skipped: the host resolves relative references
 * against the document's own directory, which is what `readRelated` needs.
 */
export function relativeImageRefs(text: string): string[] {
  const refs: string[] = []
  for (const match of text.matchAll(MARKDOWN_IMAGE)) {
    const raw = match[1] ?? ''
    const target = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw
    if (target === '' || target.startsWith('/') || target.startsWith('#') || refs.includes(target)) continue
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue
    if (imageMediaTypeOf(target) === undefined) continue
    refs.push(target)
    if (refs.length >= MAX_RELATIVE_IMAGES) break
  }
  return refs
}
