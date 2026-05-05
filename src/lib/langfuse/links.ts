import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { buildLangfuseTraceUrl, getLangfuseConfig } from './config'
import type { LangfuseTraceSummary, TraceHealth } from './types'

const VALID_TRACE_HEALTH = new Set<TraceHealth>([
  'no_trace',
  'healthy',
  'warning',
  'failed',
  'needs_eval',
  'unknown',
])

export const DEFAULT_SCORE_WARNING_THRESHOLD = 0.7
export const DEFAULT_SCORE_FAILED_THRESHOLD = 0.4

export function normalizeTraceHealth(value: unknown): TraceHealth {
  return typeof value === 'string' && VALID_TRACE_HEALTH.has(value as TraceHealth)
    ? (value as TraceHealth)
    : 'unknown'
}

export function inferTraceHealth(input: {
  traceId?: string | null
  taskStatus?: string | null
  traceStatus?: string | null
  score?: number | null
  warningThreshold?: number
  failedThreshold?: number
}): TraceHealth {
  if (!input.traceId) return 'no_trace'
  if (input.taskStatus === 'failed' || input.traceStatus === 'failed' || input.traceStatus === 'error') return 'failed'
  if (typeof input.score !== 'number') return 'needs_eval'
  if (input.score < (input.failedThreshold ?? DEFAULT_SCORE_FAILED_THRESHOLD)) return 'failed'
  if (input.score < (input.warningThreshold ?? DEFAULT_SCORE_WARNING_THRESHOLD)) return 'warning'
  return 'healthy'
}

type ObservabilityLinkRow = {
  id: string
  task_id: number
  agent_id?: string | null
  workflow_run_id?: string | null
  langfuse_trace_id: string
  langfuse_session_id?: string | null
  langfuse_project_id?: string | null
  langfuse_url?: string | null
  trace_status?: string | null
  trace_health?: string | null
  trace_score?: number | null
  trace_cost_usd?: number | null
  trace_latency_ms?: number | null
  prompt_name?: string | null
  prompt_version?: string | null
  model_provider?: string | null
  model_name?: string | null
  failure_reason?: string | null
  metadata_json?: string | null
  updated_at?: number
}

function parseMetadata(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function mapObservabilityLink(row: ObservabilityLinkRow): LangfuseTraceSummary {
  return {
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id,
    workflowRunId: row.workflow_run_id,
    traceId: row.langfuse_trace_id,
    sessionId: row.langfuse_session_id,
    projectId: row.langfuse_project_id,
    traceHealth: normalizeTraceHealth(row.trace_health),
    traceStatus: row.trace_status,
    score: row.trace_score,
    costUsd: row.trace_cost_usd,
    latencyMs: row.trace_latency_ms,
    promptName: row.prompt_name,
    promptVersion: row.prompt_version,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    failureReason: row.failure_reason,
    url: row.langfuse_url,
    metadata: parseMetadata(row.metadata_json),
    updatedAt: row.updated_at,
  }
}

export function getLangfuseLink(
  db: Database.Database,
  taskId: number,
  workspaceId: number
): LangfuseTraceSummary | null {
  const row = db.prepare(`
    SELECT *
    FROM observability_links
    WHERE task_id = ? AND workspace_id = ? AND provider = 'langfuse'
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(taskId, workspaceId) as ObservabilityLinkRow | undefined

  return row ? mapObservabilityLink(row) : null
}

export type UpsertLangfuseLinkInput = {
  agentId?: string | null
  workflowRunId?: string | null
  langfuseTraceId: string
  langfuseSessionId?: string | null
  langfuseProjectId?: string | null
  langfuseUrl?: string | null
  traceStatus?: string | null
  traceHealth?: TraceHealth | null
  traceScore?: number | null
  traceCostUsd?: number | null
  traceLatencyMs?: number | null
  promptName?: string | null
  promptVersion?: string | null
  modelProvider?: string | null
  modelName?: string | null
  failureReason?: string | null
  metadata?: Record<string, unknown>
}

export function upsertLangfuseLink(
  db: Database.Database,
  taskId: number,
  workspaceId: number,
  input: UpsertLangfuseLinkInput
): LangfuseTraceSummary {
  const config = getLangfuseConfig()
  const projectId = input.langfuseProjectId || config.projectId
  const traceUrl = input.langfuseUrl ||
    (config.traceDeeplinkBase
      ? buildLangfuseTraceUrl(config.traceDeeplinkBase, projectId, input.langfuseTraceId)
      : null)
  const traceHealth = input.traceHealth ||
    inferTraceHealth({
      traceId: input.langfuseTraceId,
      traceStatus: input.traceStatus,
      score: input.traceScore,
    })

  const existing = db.prepare(`
    SELECT id FROM observability_links
    WHERE task_id = ? AND workspace_id = ? AND provider = 'langfuse'
    LIMIT 1
  `).get(taskId, workspaceId) as { id: string } | undefined
  const id = existing?.id || randomUUID()

  db.prepare(`
    INSERT INTO observability_links (
      id, task_id, workspace_id, agent_id, workflow_run_id, provider,
      langfuse_trace_id, langfuse_session_id, langfuse_project_id, langfuse_url,
      trace_status, trace_health, trace_score, trace_cost_usd, trace_latency_ms,
      prompt_name, prompt_version, model_provider, model_name, failure_reason,
      metadata_json, created_at, updated_at
    ) VALUES (
      @id, @taskId, @workspaceId, @agentId, @workflowRunId, 'langfuse',
      @langfuseTraceId, @langfuseSessionId, @langfuseProjectId, @langfuseUrl,
      @traceStatus, @traceHealth, @traceScore, @traceCostUsd, @traceLatencyMs,
      @promptName, @promptVersion, @modelProvider, @modelName, @failureReason,
      @metadataJson, unixepoch(), unixepoch()
    )
    ON CONFLICT(workspace_id, task_id, provider) DO UPDATE SET
      agent_id = excluded.agent_id,
      workflow_run_id = excluded.workflow_run_id,
      langfuse_trace_id = excluded.langfuse_trace_id,
      langfuse_session_id = excluded.langfuse_session_id,
      langfuse_project_id = excluded.langfuse_project_id,
      langfuse_url = excluded.langfuse_url,
      trace_status = excluded.trace_status,
      trace_health = excluded.trace_health,
      trace_score = excluded.trace_score,
      trace_cost_usd = excluded.trace_cost_usd,
      trace_latency_ms = excluded.trace_latency_ms,
      prompt_name = excluded.prompt_name,
      prompt_version = excluded.prompt_version,
      model_provider = excluded.model_provider,
      model_name = excluded.model_name,
      failure_reason = excluded.failure_reason,
      metadata_json = excluded.metadata_json,
      updated_at = unixepoch()
  `).run({
    id,
    taskId,
    workspaceId,
    agentId: input.agentId ?? null,
    workflowRunId: input.workflowRunId ?? null,
    langfuseTraceId: input.langfuseTraceId,
    langfuseSessionId: input.langfuseSessionId ?? null,
    langfuseProjectId: projectId ?? null,
    langfuseUrl: traceUrl,
    traceStatus: input.traceStatus ?? null,
    traceHealth,
    traceScore: input.traceScore ?? null,
    traceCostUsd: input.traceCostUsd ?? null,
    traceLatencyMs: input.traceLatencyMs ?? null,
    promptName: input.promptName ?? null,
    promptVersion: input.promptVersion ?? null,
    modelProvider: input.modelProvider ?? null,
    modelName: input.modelName ?? null,
    failureReason: input.failureReason ?? null,
    metadataJson: JSON.stringify(input.metadata || {}),
  })

  const link = getLangfuseLink(db, taskId, workspaceId)
  if (!link) throw new Error('Failed to save Langfuse observability link')
  return link
}

