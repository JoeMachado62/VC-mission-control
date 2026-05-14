export type GraphitiHealth = {
  enabled: boolean
  configured: boolean
  reachable: boolean
  status: 'healthy' | 'disabled' | 'unconfigured' | 'error'
  apiUrl: string | null
  mcpUrl: string | null
  readOnly: boolean
  checkedAt: string
  error?: string
}

export type GraphitiEpisode = {
  uuid: string
  name: string
  content: string
  source: string | null
  sourceDescription: string | null
  groupId: string | null
  createdAt: string | null
  validAt: string | null
  raw?: unknown
}

export type GraphitiFact = {
  uuid: string
  name: string
  fact: string
  validAt: string | null
  invalidAt: string | null
  createdAt: string | null
  expiredAt: string | null
  agentId: string | null
  agentName: string | null
  entityType: string | null
  entityId: string | null
  taskId: string | null
  traceId: string | null
  confidence: number | null
  raw?: unknown
}

export type GraphitiStats = {
  enabled: boolean
  namespace: string
  recentEpisodeCount: number
  recentFactCount: number
  agentWrites: Array<{ agent: string; count: number }>
  entityTouches: Array<{ entity: string; count: number }>
  lastWriteAt: string | null
}

export type GraphitiConflict = {
  entityKey: string
  entityType: string | null
  entityId: string
  agents: string[]
  count: number
  windowMinutes: number
  latestAt: string | null
  facts: GraphitiFact[]
}

export type GraphitiGraph = {
  nodes: Array<{
    id: string
    label: string
    type: 'agent' | 'entity' | 'fact'
    count?: number
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    label: string
  }>
}
