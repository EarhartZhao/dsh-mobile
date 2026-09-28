/**
 * Handing one remote file to an application on the phone.
 *
 * The bridge carries bytes, so a `.docx` or `.pdf` reaches this client only as
 * base64 over NATS: this module fetches the windows it needs, stitches them, and
 * calls the native module that writes a cache file and fires ACTION_VIEW. Native
 * code is required — React Native has neither a filesystem nor an intent API —
 * and it is reached defensively so an older APK simply has no hand-off button.
 */
import { NativeModules } from 'react-native'
import { Buffer } from 'buffer'
import type { NatsApiClient } from '@dsh-mobile/protocol'

/** Largest document this hand-off will materialize; beyond it the phone would choke. */
export const MAX_OPEN_BYTES = 8 * 1024 * 1024
/** One NATS response must stay under the carrier's payload cap. */
const WINDOW_BYTES = 512 * 1024

interface FileOpenerModule {
  openWithApp: (name: string, mimeType: string, base64: string) => Promise<boolean>
}

/** The native hand-off, or null in a build that predates it. */
export function fileOpener(): FileOpenerModule | null {
  const candidate: unknown = NativeModules.DshFileOpener
  return typeof candidate === 'object' && candidate !== null
    && typeof (candidate as FileOpenerModule).openWithApp === 'function'
    ? candidate as FileOpenerModule
    : null
}

/**
 * MIME types by extension, for the formats the sheet hands off. An unknown
 * extension goes out as a wildcard type so the chooser, not this table, decides.
 */
const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
}

/** Best-effort MIME type for a path, a wildcard when the extension is unknown. */
export function mimeTypeOf(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? path
  const dot = name.lastIndexOf('.')
  const extension = dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
  return MIME_TYPES[extension] ?? '*/*'
}

/** Why a hand-off could not happen, in the caller's own words. */
export type OpenFailure =
  | { kind: 'unavailable' }
  | { kind: 'tooLarge'; limit: number }
  | { kind: 'noApp' }
  | { kind: 'error'; message: string }

export type OpenResult = { ok: true } | { ok: false; failure: OpenFailure }

/**
 * Fetch one file's bytes and hand them to a phone application.
 *
 * @param client - the connected bridge client.
 * @param sessionId - the session whose workspace resolves the path.
 * @param path - the file's path as the conversation named it.
 * @returns whether an application took over, or which refusal the caller should explain.
 */
export async function openWithPhoneApp(
  client: NatsApiClient,
  sessionId: string,
  path: string,
): Promise<OpenResult> {
  const opener = fileOpener()
  if (opener === null) return { ok: false, failure: { kind: 'unavailable' } }

  const chunks: Buffer[] = []
  let offset = 0
  let total = 0
  try {
    for (;;) {
      const window = await client.files.bytes({ sessionId, path, offset, length: WINDOW_BYTES })
      // Each window is decoded and re-encoded rather than concatenated as text:
      // separately padded base64 windows do not concatenate into valid base64.
      const chunk = Buffer.from(window.data, 'base64')
      chunks.push(chunk)
      total += chunk.length
      if (window.eof || window.data === '') break
      if (total > MAX_OPEN_BYTES) return { ok: false, failure: { kind: 'tooLarge', limit: MAX_OPEN_BYTES } }
      offset += chunk.length
    }
  } catch (error: unknown) {
    return { ok: false, failure: { kind: 'error', message: error instanceof Error ? error.message : String(error) } }
  }
  if (total > MAX_OPEN_BYTES) return { ok: false, failure: { kind: 'tooLarge', limit: MAX_OPEN_BYTES } }

  try {
    const name = path.split(/[\\/]/).at(-1) ?? 'file'
    await opener.openWithApp(name, mimeTypeOf(path), Buffer.concat(chunks).toString('base64'))
    return { ok: true }
  } catch (error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, failure: code === 'NO_APP' ? { kind: 'noApp' } : { kind: 'error', message } }
  }
}

