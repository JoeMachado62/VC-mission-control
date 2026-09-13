import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { createGraphitiClient } from '@/lib/graphiti/client'
import { resolveReadScope } from '@/lib/graphiti/namespaces'
import { logger } from '@/lib/logger'

// GET /api/graphiti/facts?namespace=vch_buyer|vch_admin|vch_wholesale&limit=50
// Namespace is required — mode boundary is a security property; do not default.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  const scope = resolveReadScope(
    request.nextUrl.searchParams.get('namespace'),
    request.nextUrl.searchParams.get('mode'),
  )
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: 400 })
  const echo = { namespaces: scope.namespaces, ...(scope.kind === 'mode' ? { mode: scope.mode } : { namespace: scope.namespace }) }

  const client = createGraphitiClient()
  const disabled = client.ensureEnabled()
  if (disabled) return NextResponse.json({ ...disabled, ...echo, facts: [] })

  try {
    const limit = Number.parseInt(request.nextUrl.searchParams.get('limit') || '50', 10)
    const capped = Number.isFinite(limit) ? limit : 50
    const facts = scope.kind === 'mode'
      ? await client.recentFactsAcross(scope.mode, capped)
      : await client.recentFacts(scope.namespace, capped)
    return NextResponse.json({ enabled: true, ...echo, facts })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/graphiti/facts error')
    return NextResponse.json({ error: 'Failed to fetch Graphiti facts' }, { status: 502 })
  }
}
