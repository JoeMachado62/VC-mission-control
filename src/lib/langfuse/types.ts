export type TraceHealth =
  | 'no_trace'
  | 'healthy'
  | 'warning'
  | 'failed'
  | 'needs_eval'
  | 'unknown'

export type LangfuseTraceSummary = {
  id?: string
  taskId: number
  agentId?: string | null
  workflowRunId?: string | null
  traceId: string
  sessionId?: string | null
  projectId?: string | null
  traceHealth: TraceHealth
  traceStatus?: string | null
  score?: number | null
  costUsd?: number | null
  latencyMs?: number | null
  promptName?: string | null
  promptVersion?: string | null
  modelProvider?: string | null
  modelName?: string | null
  failureReason?: string | null
  url?: string | null
  metadata?: Record<string, unknown>
  updatedAt?: number
}

export type TaskObservabilityPreview = {
  hasTrace: boolean
  traceHealth: TraceHealth
  traceId?: string | null
  traceUrl?: string | null
  failureReason?: string | null
  costUsd?: number | null
  latencyMs?: number | null
}

/**
 * v4 Observability v2 — agent-task tag taxonomy surfaced in Mission Control.
 *
 * Sourced authoritatively from the `tasks` table (migration 052), NOT from
 * Langfuse trace tags. Channel is read from `tasks.metadata.channel` since
 * MC has no dedicated channel column on tasks.
 *
 * `adminIdentity` is sensitive (Telegram user id / Twilio CID) — the GET
 * route omits it for non-admin viewers; clients should treat the field as
 * optional.
 */
export type TaskAgentContext = {
  agent?: string | null
  mode?: 'buyer' | 'admin' | 'wholesale' | string | null
  channel?: string | null
  adminAuthTier?: 1 | 2 | null
  /** Present only for admin role viewers; redacted/omitted otherwise. */
  adminIdentity?: string | null
  intentThreadId?: string | null
  dealId?: string | null
  exceptionCategory?: string | null
  /** Parsed from JSON-encoded `tasks.allowed_tools`. */
  allowedTools?: string[] | null
}

