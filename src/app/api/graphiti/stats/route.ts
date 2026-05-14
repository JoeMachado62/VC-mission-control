import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { createGraphitiClient } from '@/lib/graphiti/client'
import { isVchNamespace, VCH_NAMESPACES } from '@/lib/graphiti/namespaces'
import { logger } from '@/lib/logger'

// GET /api/graphiti/stats?namespace=vch_buyer|vch_admin|vch_wholesale
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
  if (disabled) {
    return NextResponse.json(client.disabledPayload({
      recentEpisodeCount: 0,
      recentFactCount: 0,
      agentWrites: [],
      entityTouches: [],
      lastWriteAt: null,
    }, namespace))
  }

  try {
    return NextResponse.json(await client.stats(namespace))
  } catch (error) {
    logger.error({ err: error }, 'GET /api/graphiti/stats error')
    return NextResponse.json({ error: 'Failed to derive Graphiti stats' }, { status: 502 })
  }
}
