import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getLangfuseConfig, isLangfuseConfigured } from '@/lib/langfuse/config'
import { getLangfuseLink, normalizeTraceHealth, upsertLangfuseLink } from '@/lib/langfuse/links'
import type { TraceHealth } from '@/lib/langfuse/types'

const langfuseLinkSchema = z.object({
  agentId: z.string().max(200).nullable().optional(),
  workflowRunId: z.string().max(200).nullable().optional(),
  langfuseTraceId: z.string().min(1).max(500),
  langfuseSessionId: z.string().max(500).nullable().optional(),
  langfuseProjectId: z.string().max(500).nullable().optional(),
  langfuseUrl: z.string().url().nullable().optional(),
  traceStatus: z.string().max(100).nullable().optional(),
  traceHealth: z.enum(['no_trace', 'healthy', 'warning', 'failed', 'needs_eval', 'unknown']).nullable().optional(),
  traceScore: z.number().min(0).max(1).nullable().optional(),
  traceCostUsd: z.number().min(0).nullable().optional(),
  traceLatencyMs: z.number().int().min(0).nullable().optional(),
  promptName: z.string().max(500).nullable().optional(),
  promptVersion: z.string().max(200).nullable().optional(),
  modelProvider: z.string().max(200).nullable().optional(),
  modelName: z.string().max(200).nullable().optional(),
  failureReason: z.string().max(5000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

function parseTaskId(raw: string): number | null {
  const taskId = Number.parseInt(raw, 10)
  return Number.isFinite(taskId) ? taskId : null
}

function getTaskStatus(
  db: ReturnType<typeof getDatabase>,
  taskId: number,
  workspaceId: number
): string | null {
  const row = db.prepare('SELECT status FROM tasks WHERE id = ? AND workspace_id = ?').get(taskId, workspaceId) as
    | { status: string }
    | undefined
  return row?.status || null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params
    const taskId = parseTaskId(resolvedParams.id)
    if (!taskId) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    if (!getTaskStatus(db, taskId, workspaceId)) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const config = getLangfuseConfig()
    const summary = getLangfuseLink(db, taskId, workspaceId)
    return NextResponse.json({
      enabled: config.enabled,
      configured: isLangfuseConfigured(config),
      embedEnabled: config.embedEnabled,
      hasTrace: Boolean(summary),
      summary,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id]/observability/langfuse error')
    return NextResponse.json({ error: 'Failed to fetch Langfuse trace summary' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const resolvedParams = await params
    const taskId = parseTaskId(resolvedParams.id)
    if (!taskId) return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })

    const body = await request.json()
    const parsed = langfuseLinkSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const taskStatus = getTaskStatus(db, taskId, workspaceId)
    if (!taskStatus) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const link = upsertLangfuseLink(db, taskId, workspaceId, {
      ...parsed.data,
      traceHealth: parsed.data.traceHealth
        ? normalizeTraceHealth(parsed.data.traceHealth) as TraceHealth
        : taskStatus === 'failed'
          ? 'failed'
        : undefined,
    })

    return NextResponse.json({
      ok: true,
      observabilityLink: {
        taskId: link.taskId,
        langfuseTraceId: link.traceId,
        traceHealth: link.traceHealth,
      },
      summary: link,
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/observability/langfuse error')
    return NextResponse.json({ error: 'Failed to save Langfuse trace link' }, { status: 500 })
  }
}
