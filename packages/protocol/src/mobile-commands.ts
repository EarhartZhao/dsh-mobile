/**
 * Mobile-only command-directory face. The mobile bridge whitelists these
 * subjects; unlike the browser Remote gateway they are plain unary calls and
 * older hosts may not serve them, so callers must keep a fallback.
 */
import { serverResponseSchema } from './vendor/api/rpc.schema.ts'
import { svcSubject, TOKEN_HEADER } from './subjects.ts'
import type { NatsConnLike, NatsHeadersFactory } from './nats-types.ts'

export interface MobileCommandInput {
  hint: string
  images?: boolean
}

export interface MobileCommandDescriptor {
  name: string
  description: string
  input?: MobileCommandInput
}

export interface MobileCommandExecution {
  commandId: string
  result: { kind: 'success'; text?: string } | { kind: 'error'; text: string }
}

function mintRpcId(): string {
  return crypto.randomUUID()
}

async function callCommand<T>(
  conn: NatsConnLike,
  headersFactory: NatsHeadersFactory,
  instanceId: string,
  method: 'command.list' | 'command.execute',
  payload: unknown,
  token: string,
  timeoutMs: number,
): Promise<T> {
  const headers = headersFactory()
  headers.set(TOKEN_HEADER, token)
  const envelope = { type: 'client-request', rpcId: mintRpcId(), method, payload }
  const reply = await conn.request(svcSubject(instanceId, method), JSON.stringify(envelope), {
    timeout: timeoutMs,
    headers,
  })
  const full = serverResponseSchema.parse(JSON.parse(new TextDecoder().decode(reply.data)))
  if (!full.result.ok) throw new Error(full.result.error.message)
  return full.result.value as T
}

export function createMobileCommands(conn: NatsConnLike, headersFactory: NatsHeadersFactory, instanceId: string, getToken: () => string | undefined): {
  list(payload: { sessionId: string }): Promise<{ commands: MobileCommandDescriptor[] }>
  execute(payload: { sessionId: string; line: string; images?: { type: 'image'; mediaType: string; data: string; name?: string }[] }): Promise<MobileCommandExecution>
} {
  return {
    async list(payload) {
      const token = getToken()
      if (token === undefined) throw new Error('connection not ready')
      return callCommand(conn, headersFactory, instanceId, 'command.list', payload, token, 10_000)
    },
    async execute(payload) {
      const token = getToken()
      if (token === undefined) throw new Error('connection not ready')
      return callCommand(conn, headersFactory, instanceId, 'command.execute', payload, token, 60_000)
    },
  }
}
