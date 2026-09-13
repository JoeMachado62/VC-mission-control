import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { createGraphitiClient } from '@/lib/graphiti/client'
import { resolveReadScope } from '@/lib/graphiti/namespaces'
import { logger } from '@/lib/logger'

// GET /api/graphiti/search?namespace=<ns>&q=...&limit=10        — single namespace
// GET /api/graphiti/search?mode=buyer|wholesale|admin&q=...      — mode read policy
// One of namespace or mode is required; neither defaults. The mode boundary is a
// security property, so `mode` widens the read only as far as READ_POLICY allows.
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

  const query = (request.nextUrl.searchParams.get('q') || '').trim()
  if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

  try {
    const maxFacts = Number.parseInt(request.nextUrl.searchParams.get('limit') || '10', 10)
    const capped = Number.isFinite(maxFacts) ? maxFacts : 10
    const facts = scope.kind === 'mode'
      ? await client.searchAcross(scope.mode, query, capped)
      : await client.search(scope.namespace, query, capped)
    return NextResponse.json({ enabled: true, ...echo, query, facts })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/graphiti/search error')
    return NextResponse.json({ error: 'Failed to search Graphiti' }, { status: 502 })
  }
}
