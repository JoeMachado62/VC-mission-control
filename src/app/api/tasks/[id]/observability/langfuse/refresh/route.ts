import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getLangfuseConfig, isLangfuseConfigured } from '@/lib/langfuse/config'
import { getLangfuseLink } from '@/lib/langfuse/links'

function parseTaskId(raw: string): number | null {
  const taskId = Number.parseInt(raw, 10)
  return Number.isFinite(taskId) ? taskId : null
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

    return NextResponse.json({
      enabled: config.enabled,
      configured: isLangfuseConfigured(config),
      embedEnabled: config.embedEnabled,
      hasTrace: Boolean(summary),
      summary,
      refreshed: false,
      message: 'Direct Langfuse API refresh is not enabled in this MVP; returning the latest Mission Control summary.',
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/observability/langfuse/refresh error')
    return NextResponse.json({ error: 'Failed to refresh Langfuse trace summary' }, { status: 500 })
  }
}

