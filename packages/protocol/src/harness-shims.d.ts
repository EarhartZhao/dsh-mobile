/**
 * The vendored harness contract layer imports *types only* from sibling
 * @deepseek-ai/* packages. Those imports are erased at compile time and never
 * resolve at runtime (Metro/vitest both strip `import type`), but tsc still
 * wants declarations — including two `declare module` *augmentation* sites in
 * sessions.ts, which require the augmented interfaces to pre-exist.
 *
 * Fidelity note: types here are intentionally loose (`unknown`-ish); the
 * runtime contract is the vendored zod schemas, which parse and narrow every
 * wire value for real.
 */
declare module '@deepseek-ai/dsh-brand' {
  export type Branded<B extends string, T = string> = T & { readonly __brand: B }
}

declare module '@deepseek-ai/dsh-llm' {
  /** Augmented by vendored sessions.ts with the 'user-rpc' source kind. */
  export interface MessageSourceMap {}
}

declare module '@deepseek-ai/dsh-llm/brand' {
  export type MessageId = string & { readonly __brand: 'message-id' }
  export type CallId = string & { readonly __brand: 'call-id' }
}

declare module '@deepseek-ai/dsh-llm/types' {
  export type Message = unknown
  export type ContentBlock = unknown
}

declare module '@deepseek-ai/dsh-session/types' {
  export type SessionId = string & { readonly __brand: 'session-id' }
  export type JsonValue = unknown
  /** Append-only session log entry; seq ordering is what clients rely on. */
  export type SessionEvent = { seq?: number; type?: string; [key: string]: unknown }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  /** Augmented by vendored sessions.ts (sessionListMetadata, imageLimits).
   * The index signature mirrors the real map: projection keys are registered
   * across plugins (title lives in dsh-session-title), so the client-side
   * store treats it as open. */
  export interface SessionProjectionMap { [key: string]: unknown }
  export interface SessionProjectionStateMap {}
}

declare module '@deepseek-ai/dsh-attachment' {
  export type AttachmentIdType = string
  export type ImageAttachmentLimits = unknown
  export type ImageAttachmentRef = unknown
  export type ImageMediaType = string
}

declare module '@deepseek-ai/dsh-tools/presentation' {
  export type ToolCallView = unknown
  export type ToolResultView = unknown
}

declare module '@deepseek-ai/dsh-jobs/brand' {
  export type JobId = string & { readonly __brand: 'job-id' }
}

declare module '@deepseek-ai/dsh-user-approval/types' {
  export type ApprovalRequestId = string & { readonly __brand: 'approval-request-id' }
  export type ApprovalOutcome = unknown
}

declare module '@deepseek-ai/dsh-user-questions/types' {
  export type AskUserQuestionItem = unknown
  export type AskUserQuestionAnswer = unknown
}
