/** Subject layout shared with dsh-mobile-plugin (docs/02-protocol.md). */
export function svcSubject(instanceId: string, method: string): string {
  return `svc.dsh.${instanceId}.${method}`
}

export function evtSubject(instanceId: string, stream: 'mux' | 'host'): string {
  return `evt.dsh.${instanceId}.${stream}`
}

/** NATS header carrying the application-layer device token (plugin TOKEN_HEADER). */
export const TOKEN_HEADER = 'x-dsh-token'
