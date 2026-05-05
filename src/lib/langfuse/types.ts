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

