import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getLangfuseConfig, isLangfuseConfigured } from '@/lib/langfuse/config'
import { getLangfuseLink } from '@/lib/langfuse/links'
import type { TaskAgentContext } from '@/lib/langfuse/types'

function parseTaskId(raw: string): number | null {
  const taskId = Number.parseInt(raw, 10)
  return Number.isFinite(taskId) ? taskId : null
}

type TaskAgentContextRow = {
  assigned_to: string | null
  mode: string | null
  admin_identity: string | null
  admin_auth_tier: number | null
  intent_thread_id: string | null
  deal_id: string | null
  exception_category: string | null
  allowed_tools: string | null
  metadata: string | null
}

function parseAllowedTools(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const tools = parsed.map((t) => String(t)).filter(Boolean)
      return tools.length ? tools : null
    }
  } catch {
    // fall through
  }
  return null
}

function extractChannel(metadataJson: string | null): string | null {
  if (!metadataJson) return null
  try {
    const meta = JSON.parse(metadataJson)
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      const channel = (meta as { channel?: unknown }).channel
      if (typeof channel === 'string' && channel.trim()) return channel.trim()
    }
  } catch {
    // ignore
  }
  return null
}

function getTaskAgentContext(
  db: ReturnType<typeof getDatabase>,
  taskId: number,
  workspaceId: number,
  viewerRole: 'admin' | 'operator' | 'viewer'
): TaskAgentContext | null {
  const row = db.prepare(`
    SELECT assigned_to, mode, admin_identity, admin_auth_tier,
           intent_thread_id, deal_id, exception_category, allowed_tools, metadata
    FROM tasks
    WHERE id = ? AND workspace_id = ?
  `).get(taskId, workspaceId) as TaskAgentContextRow | undefined

  if (!row) return null

  const ctx: TaskAgentContext = {
    agent: row.assigned_to,
    mode: row.mode,
    channel: extractChannel(row.metadata),
    adminAuthTier: row.admin_auth_tier === 1 || row.admin_auth_tier === 2 ? row.admin_auth_tier : null,
    intentThreadId: row.intent_thread_id,
    dealId: row.deal_id,
    exceptionCategory: row.exception_category,
    allowedTools: parseAllowedTools(row.allowed_tools),
  }

  if (viewerRole === 'admin') {
    ctx.adminIdentity = row.admin_identity
  }

  return ctx
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

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const task = db.prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?').get(taskId, workspaceId)
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const config = getLangfuseConfig()
    const summary = getLangfuseLink(db, taskId, workspaceId)
    const taskContext = getTaskAgentContext(db, taskId, workspaceId, auth.user.role)

    return NextResponse.json({
      enabled: config.enabled,
      configured: isLangfuseConfigured(config),
      embedEnabled: config.embedEnabled,
      hasTrace: Boolean(summary),
      summary,
      taskContext,
      traceDeeplinkBase: config.traceDeeplinkBase,
      refreshed: false,
      message: 'Direct Langfuse API refresh is not enabled in this MVP; returning the latest Mission Control summary.',
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/observability/langfuse/refresh error')
    return NextResponse.json({ error: 'Failed to refresh Langfuse trace summary' }, { status: 500 })
  }
}

