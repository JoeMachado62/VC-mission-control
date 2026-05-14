import { getGraphitiConfig, isGraphitiConfigured, type GraphitiConfig } from './config'
import type { VchNamespace } from './namespaces'
import type { GraphitiConflict, GraphitiEpisode, GraphitiFact, GraphitiGraph, GraphitiHealth, GraphitiStats } from './types'

type FetchJsonOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
}

function toIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function parseSourceDescription(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return asRecord(parsed)
  } catch {
    return {}
  }
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function normalizeEpisode(raw: unknown, fallbackGroupId: string): GraphitiEpisode {
  const record = asRecord(raw)
  return {
    uuid: pickString(record.uuid, record.id) || '',
    name: pickString(record.name) || 'Episode',
    content: pickString(record.content, record.episode_body, record.body) || '',
    source: pickString(record.source),
    sourceDescription: pickString(record.source_description, record.sourceDescription),
    groupId: pickString(record.group_id, record.groupId) || fallbackGroupId,
    createdAt: toIso(record.created_at ?? record.createdAt),
    validAt: toIso(record.valid_at ?? record.validAt),
    raw,
  }
}

function normalizeFact(raw: unknown): GraphitiFact {
  const record = asRecord(raw)
  const metadata = {
    ...parseSourceDescription(record.source_description),
    ...asRecord(record.metadata),
  }
  const fact = pickString(record.fact, record.content, record.name) || ''
  const source = parseSourceDescription(record.sourceDescription)
  const merged = { ...source, ...metadata }
  return {
    uuid: pickString(record.uuid, record.id) || '',
    name: pickString(record.name) || 'Fact',
    fact,
    validAt: toIso(record.valid_at ?? record.validAt ?? merged.valid_at),
    invalidAt: toIso(record.invalid_at ?? record.invalidAt),
    createdAt: toIso(record.created_at ?? record.createdAt),
    expiredAt: toIso(record.expired_at ?? record.expiredAt),
    agentId: pickString(merged.agent_id, record.agent_id),
    agentName: pickString(merged.agent_name, record.agent_name),
    entityType: pickString(merged.entity_type, record.entity_type),
    entityId: pickString(merged.entity_id, record.entity_id),
    taskId: pickString(merged.task_id, record.task_id),
    traceId: pickString(merged.trace_id, record.trace_id),
    confidence: pickNumber(merged.confidence, record.confidence),
    raw,
  }
}

export class GraphitiClient {
  constructor(private readonly config: GraphitiConfig = getGraphitiConfig()) {}

  get settings() {
    return this.config
  }

  private disabledHealth(status: GraphitiHealth['status'], error?: string): GraphitiHealth {
    return {
      enabled: this.config.enabled,
      configured: isGraphitiConfigured(this.config),
      reachable: false,
      status,
      apiUrl: this.config.apiUrl || null,
      mcpUrl: this.config.mcpUrl || null,
      readOnly: this.config.readOnly,
      checkedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    }
  }

  disabledPayload<T>(value: T, namespace: VchNamespace): T & { enabled: false; disabled: true; namespace: VchNamespace } {
    return { ...value, enabled: false, disabled: true, namespace }
  }

  ensureEnabled(): GraphitiHealth | null {
    if (!this.config.enabled) return this.disabledHealth('disabled')
    if (!isGraphitiConfigured(this.config)) return this.disabledHealth('unconfigured', 'Graphiti API URL is not configured')
    return null
  }

  private async fetchJson(pathname: string, options: FetchJsonOptions = {}): Promise<unknown> {
    const disabled = this.ensureEnabled()
    if (disabled) throw new Error(disabled.error || `Graphiti is ${disabled.status}`)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await fetch(`${this.config.apiUrl.replace(/\/$/, '')}${pathname}`, {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
        cache: 'no-store',
      })

      const text = await response.text()
      const json = text ? JSON.parse(text) as unknown : null
      if (!response.ok) {
        const detail = pickString(asRecord(json).detail, asRecord(json).error) || response.statusText
        throw new Error(`Graphiti ${response.status}: ${detail}`)
      }
      return json
    } finally {
      clearTimeout(timeout)
    }
  }

  // Health is the only non-namespace-scoped operation: it pings /healthcheck.
  async health(): Promise<GraphitiHealth> {
    const disabled = this.ensureEnabled()
    if (disabled) return disabled

    try {
      const payload = asRecord(await this.fetchJson('/healthcheck'))
      const statusText = pickString(payload.status)
      return {
        enabled: this.config.enabled,
        configured: true,
        reachable: statusText === 'healthy',
        status: statusText === 'healthy' ? 'healthy' : 'error',
        apiUrl: this.config.apiUrl,
        mcpUrl: this.config.mcpUrl || null,
        readOnly: this.config.readOnly,
        checkedAt: new Date().toISOString(),
        ...(statusText === 'healthy' ? {} : { error: 'Unexpected Graphiti health response' }),
      }
    } catch (error) {
      return this.disabledHealth('error', error instanceof Error ? error.message : 'Graphiti health check failed')
    }
  }

  async episodes(namespace: VchNamespace, lastN = 50): Promise<GraphitiEpisode[]> {
    const capped = Math.max(1, Math.min(200, Math.floor(lastN)))
    const payload = await this.fetchJson(`/episodes/${encodeURIComponent(namespace)}?last_n=${capped}`)
    const items = Array.isArray(payload) ? payload : []
    // Server-side filter is enforced by the path-scoped /episodes/{group_id}
    // endpoint. Add a defensive client-side filter so cross-namespace data
    // cannot leak even if the server contract changes.
    return items
      .map((item) => normalizeEpisode(item, namespace))
      .filter((episode) => episode.groupId === namespace)
  }

  async search(namespace: VchNamespace, query: string, maxFacts = 10): Promise<GraphitiFact[]> {
    const payload = asRecord(await this.fetchJson('/search', {
      method: 'POST',
      body: {
        group_ids: [namespace],
        query,
        max_facts: Math.max(1, Math.min(50, Math.floor(maxFacts))),
      },
    }))
    const facts = Array.isArray(payload.facts) ? payload.facts : []
    // Defensive: drop any fact whose embedded group_id does not match the
    // requested namespace. Server-side filter via group_ids is the primary
    // boundary; this is a belt-and-braces enforcement of mode isolation.
    return facts.map(normalizeFact).filter((fact) => {
      const factGroup = pickString(asRecord(fact.raw).group_id, asRecord(fact.raw).groupId)
      return factGroup === null || factGroup === namespace
    })
  }

  async recentFacts(namespace: VchNamespace, limit = 50): Promise<GraphitiFact[]> {
    const episodes = await this.episodes(namespace, limit)
    return episodes.map((episode) => {
      const metadata = parseSourceDescription(episode.sourceDescription)
      return normalizeFact({
        uuid: episode.uuid,
        name: episode.name,
        fact: episode.content,
        created_at: episode.createdAt,
        valid_at: episode.validAt,
        source_description: JSON.stringify(metadata),
        metadata,
        group_id: episode.groupId,
        raw_episode: episode.raw,
      })
    })
  }

  async stats(namespace: VchNamespace): Promise<GraphitiStats> {
    const [episodes, facts] = await Promise.all([
      this.episodes(namespace, 100),
      this.recentFacts(namespace, 100),
    ])
    const agentCounts = new Map<string, number>()
    const entityCounts = new Map<string, number>()
    let lastWriteAt: string | null = null

    for (const fact of facts) {
      const agent = fact.agentName || fact.agentId || 'unknown'
      agentCounts.set(agent, (agentCounts.get(agent) || 0) + 1)
      if (fact.entityId) {
        const entity = fact.entityType ? `${fact.entityType}:${fact.entityId}` : fact.entityId
        entityCounts.set(entity, (entityCounts.get(entity) || 0) + 1)
      }
      const timestamp = fact.createdAt || fact.validAt
      if (timestamp && (!lastWriteAt || timestamp > lastWriteAt)) lastWriteAt = timestamp
    }

    return {
      enabled: this.config.enabled,
      namespace,
      recentEpisodeCount: episodes.length,
      recentFactCount: facts.length,
      agentWrites: [...agentCounts.entries()].map(([agent, count]) => ({ agent, count })).sort((a, b) => b.count - a.count),
      entityTouches: [...entityCounts.entries()].map(([entity, count]) => ({ entity, count })).sort((a, b) => b.count - a.count),
      lastWriteAt,
    }
  }

  async conflicts(namespace: VchNamespace): Promise<GraphitiConflict[]> {
    const facts = await this.recentFacts(namespace, 150)
    const cutoff = Date.now() - this.config.conflictWindowMinutes * 60 * 1000
    const byEntity = new Map<string, GraphitiFact[]>()

    for (const fact of facts) {
      if (!fact.entityId) continue
      const timestamp = Date.parse(fact.validAt || fact.createdAt || '')
      if (Number.isFinite(timestamp) && timestamp < cutoff) continue
      const key = `${fact.entityType || 'entity'}:${fact.entityId}`
      const bucket = byEntity.get(key) || []
      bucket.push(fact)
      byEntity.set(key, bucket)
    }

    return [...byEntity.entries()].flatMap(([entityKey, entityFacts]) => {
      const agents = Array.from(new Set(entityFacts.map((fact) => fact.agentName || fact.agentId || 'unknown')))
      if (agents.length < 2) return []
      const latestAt = entityFacts
        .map((fact) => fact.validAt || fact.createdAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) || null
      const [entityType, ...rest] = entityKey.split(':')
      return [{
        entityKey,
        entityType: entityType || null,
        entityId: rest.join(':'),
        agents,
        count: entityFacts.length,
        windowMinutes: this.config.conflictWindowMinutes,
        latestAt,
        facts: entityFacts.slice(0, 8),
      }]
    }).sort((a, b) => b.count - a.count)
  }

  async graph(namespace: VchNamespace): Promise<GraphitiGraph> {
    const facts = await this.recentFacts(namespace, 100)
    const nodes = new Map<string, GraphitiGraph['nodes'][number]>()
    const edges: GraphitiGraph['edges'] = []

    for (const fact of facts) {
      const factId = `fact:${fact.uuid || fact.fact.slice(0, 60)}`
      nodes.set(factId, { id: factId, label: fact.name || fact.fact.slice(0, 40) || 'Fact', type: 'fact' })

      const agent = fact.agentName || fact.agentId
      if (agent) {
        const agentId = `agent:${agent}`
        nodes.set(agentId, { id: agentId, label: agent, type: 'agent', count: (nodes.get(agentId)?.count || 0) + 1 })
        edges.push({ id: `${agentId}->${factId}`, source: agentId, target: factId, label: 'wrote' })
      }

      if (fact.entityId) {
        const entityLabel = fact.entityType ? `${fact.entityType}:${fact.entityId}` : fact.entityId
        const entityId = `entity:${entityLabel}`
        nodes.set(entityId, { id: entityId, label: entityLabel, type: 'entity', count: (nodes.get(entityId)?.count || 0) + 1 })
        edges.push({ id: `${factId}->${entityId}`, source: factId, target: entityId, label: 'mentions' })
      }
    }

    return { nodes: [...nodes.values()], edges }
  }
}

export function createGraphitiClient() {
  return new GraphitiClient()
}
