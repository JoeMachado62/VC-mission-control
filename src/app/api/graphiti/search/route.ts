import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { createGraphitiClient } from '@/lib/graphiti/client'
import { isVchNamespace, VCH_NAMESPACES } from '@/lib/graphiti/namespaces'
import { logger } from '@/lib/logger'

// GET /api/graphiti/search?namespace=vch_buyer|vch_admin|vch_wholesale&q=...&limit=10
// Namespace is required — mode boundary is a security property; do not default.
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = readLimiter(request)
  if (limited) return limited

  const namespace = request.nextUrl.searchParams.get('namespace')
  if (!isVchNamespace(namespace)) {
    return NextResponse.json(
      { error: `namespace query parameter required; must be one of ${VCH_NAMESPACES.join(', ')}` },
      { status: 400 },
    )
  }

  const client = createGraphitiClient()
  const disabled = client.ensureEnabled()
  if (disabled) return NextResponse.json({ ...disabled, namespace, facts: [] })

  const query = (request.nextUrl.searchParams.get('q') || '').trim()
  if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

  try {
    const maxFacts = Number.parseInt(request.nextUrl.searchParams.get('limit') || '10', 10)
    const facts = await client.search(namespace, query, Number.isFinite(maxFacts) ? maxFacts : 10)
    return NextResponse.json({ enabled: true, namespace, query, facts })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/graphiti/search error')
    return NextResponse.json({ error: 'Failed to search Graphiti' }, { status: 502 })
  }
}
