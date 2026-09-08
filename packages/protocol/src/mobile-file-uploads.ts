/** Mobile-only staged file upload face.
 *
 * The dsh HTTP route is streamed, but the mobile transport is NATS with a
 * bounded message size. Mobile callers therefore use the generated
 * fileUploads/upload Remote fallback with canonical base64 bytes.
 */
import { callMobileRemote } from './mobile-commands.ts'
import type { NatsConnLike, NatsHeadersFactory } from './nats-types.ts'

export interface MobileFileUploadRequest {
  sessionId: string
  data: string
  name?: string
}

export interface MobileFileAttachmentRef {
  attachmentId: string
  name: string
  bytes: number
}

export interface MobileFileUploadValue {
  receiptId: string
  file: MobileFileAttachmentRef
}

export interface MobileFileUploads {
  upload(payload: MobileFileUploadRequest): Promise<MobileFileUploadValue>
}

export function createMobileFileUploads(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  getToken: () => string | undefined,
): MobileFileUploads {
  return {
    async upload(payload) {
      const token = getToken()
      if (token === undefined) throw new Error('connection not ready')
      return callMobileRemote(
        conn, headersFactory, instanceId, 'file.upload', payload, token, 120_000,
      )
    },
  }
}

/** File-receipt prompt payload accepted by current dsh, kept outside the
 * frozen alpha.5 vendor contract until the next protocol snapshot. */
export interface MobileFilePromptContentPart {
  type: 'text' | 'image' | 'file'
  text?: string
  mediaType?: string
  data?: string
  name?: string
  receiptId?: string
}

export function createMobileFilePrompts(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  getToken: () => string | undefined,
): { prompt(payload: { sessionId: string; mode: 'queue' | 'steer'; content: MobileFilePromptContentPart[]; clientTimeZone?: string }): Promise<{ accepted: true; command?: { kind: 'success'; text?: string } }> } {
  return {
    async prompt(payload) {
      const token = getToken()
      if (token === undefined) throw new Error('connection not ready')
      return callMobileRemote(conn, headersFactory, instanceId, 'session.prompt', payload, token, 60_000)
    },
  }
}
