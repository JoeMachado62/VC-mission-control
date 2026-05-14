'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { GraphitiConflict, GraphitiFact, GraphitiGraph, GraphitiHealth, GraphitiStats } from '@/lib/graphiti/types'
import { VCH_NAMESPACES, type VchNamespace } from '@/lib/graphiti/namespaces'

type LoadState = 'idle' | 'loading' | 'error'

type BrainData = {
  health: GraphitiHealth | null
  facts: GraphitiFact[]
  stats: GraphitiStats | null
  conflicts: GraphitiConflict[]
  graph: GraphitiGraph | null
}

const NAMESPACE_LABELS: Record<VchNamespace, string> = {
  vch_buyer: 'Buyer',
  vch_admin: 'Admin',
  vch_wholesale: 'Wholesale',
}

const DEFAULT_NAMESPACE: VchNamespace = 'vch_buyer'

function formatTime(value: string | null | undefined): string {
  if (!value) return 'n/a'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-amber-500'}`} />
}

function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'good' | 'warn' | 'info' }) {
  const toneClass = {
    muted: 'border-border bg-secondary text-muted-foreground',
    good: 'border-green-500/30 bg-green-500/10 text-green-400',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    info: 'border-primary/30 bg-primary/10 text-primary',
  }[tone]
  return <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${toneClass}`}>{children}</span>
}

const EMPTY_DATA: BrainData = {
  health: null,
  facts: [],
  stats: null,
  conflicts: [],
  graph: null,
}

export function SharedBrainPanel() {
  const [namespace, setNamespace] = useState<VchNamespace>(DEFAULT_NAMESPACE)
  const [data, setData] = useState<BrainData>(EMPTY_DATA)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GraphitiFact[]>([])
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [searchState, setSearchState] = useState<LoadState>('idle')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (ns: VchNamespace) => {
    setLoadState('loading')
    setError(null)
    const qs = `namespace=${encodeURIComponent(ns)}`
    try {
      const [healthRes, factsRes, statsRes, conflictsRes, graphRes] = await Promise.all([
        fetch('/api/graphiti/health'),
        fetch(`/api/graphiti/facts?${qs}&limit=50`),
        fetch(`/api/graphiti/stats?${qs}`),
        fetch(`/api/graphiti/conflicts?${qs}`),
        fetch(`/api/graphiti/graph?${qs}`),
      ])
      const [health, factsPayload, stats, conflictsPayload, graphPayload] = await Promise.all([
        healthRes.json(),
        factsRes.json(),
        statsRes.json(),
        conflictsRes.json(),
        graphRes.json(),
      ])

      setData({
        health,
        facts: Array.isArray(factsPayload?.facts) ? factsPayload.facts : [],
        stats,
        conflicts: Array.isArray(conflictsPayload?.conflicts) ? conflictsPayload.conflicts : [],
        graph: {
          nodes: Array.isArray(graphPayload?.nodes) ? graphPayload.nodes : [],
          edges: Array.isArray(graphPayload?.edges) ? graphPayload.edges : [],
        },
      })
      setLastRefresh(new Date().toISOString())
      setLoadState('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Shared Brain data')
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    // Reset search state when changing namespace so stale results don't leak
    // across the mode boundary.
    setSearchResults([])
    setData(EMPTY_DATA)
    void load(namespace)
    const timer = window.setInterval(() => {
      void load(namespace)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [load, namespace])

  const runSearch = async () => {
    const trimmed = query.trim()
    if (!trimmed) {
      setSearchResults([])
      return
    }
    setSearchState('loading')
    try {
      const response = await fetch(
        `/api/graphiti/search?namespace=${encodeURIComponent(namespace)}&q=${encodeURIComponent(trimmed)}&limit=12`,
      )
      const payload = await response.json()
      setSearchResults(Array.isArray(payload?.facts) ? payload.facts : [])
      setSearchState('idle')
    } catch {
      setSearchState('error')
    }
  }

  const healthOk = data.health?.status === 'healthy'
  const graphPreview = useMemo(() => {
    const nodes = data.graph?.nodes || []
    const edges = data.graph?.edges || []
    return {
      agents: nodes.filter((node) => node.type === 'agent').slice(0, 6),
      entities: nodes.filter((node) => node.type === 'entity').slice(0, 8),
      edgeCount: edges.length,
    }
  }, [data.graph])

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Shared Brain</h1>
          <p className="text-sm text-muted-foreground">Graphiti read-only view, scoped per VCH mode namespace.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load(namespace)} disabled={loadState === 'loading'}>
          Refresh
        </Button>
      </div>

      <div role="tablist" aria-label="Graphiti namespace" className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
        {VCH_NAMESPACES.map((ns) => {
          const active = ns === namespace
          return (
            <button
              key={ns}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setNamespace(ns)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {NAMESPACE_LABELS[ns]}
              <span className="ml-2 text-xs opacity-60">{ns}</span>
            </button>
          )
        })}
      </div>

      <section className="rounded-lg border border-border bg-card p-3">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="flex items-center gap-2">
            <StatusDot ok={healthOk} />
            <div>
              <div className="text-xs text-muted-foreground">API</div>
              <div className="text-sm font-medium text-foreground">{data.health?.status || 'checking'}</div>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Enabled</div>
            <div className="text-sm text-foreground">{data.health?.enabled ? 'yes' : 'no'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Namespace</div>
            <div className="text-sm text-foreground">{data.stats?.namespace || namespace}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Mode</div>
            <div className="text-sm text-foreground">{data.health?.readOnly === false ? 'write-enabled' : 'read-only'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Last refresh</div>
            <div className="text-sm text-foreground">{formatTime(lastRefresh)}</div>
          </div>
        </div>
        {(error || data.health?.error) && (
          <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {error || data.health?.error}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
        <section className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Recent Facts</h2>
              <p className="text-xs text-muted-foreground">{data.facts.length} recent Graphiti episodes normalized as facts</p>
            </div>
          </div>
          <div className="divide-y divide-border">
            {loadState === 'loading' && data.facts.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading {NAMESPACE_LABELS[namespace]} facts...</div>
            ) : data.facts.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">No recent facts in {namespace} yet.</div>
            ) : data.facts.slice(0, 20).map((fact) => (
              <article key={fact.uuid || fact.fact} className="px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Pill tone="info">{fact.agentName || fact.agentId || 'unknown agent'}</Pill>
                  {fact.entityId && <Pill>{fact.entityType ? `${fact.entityType}:${fact.entityId}` : fact.entityId}</Pill>}
                  {fact.taskId && <Pill>task {fact.taskId}</Pill>}
                  <span className="text-xs text-muted-foreground">{formatTime(fact.validAt || fact.createdAt)}</span>
                </div>
                <p className="text-sm leading-6 text-foreground">{fact.fact || fact.name}</p>
              </article>
            ))}
          </div>
        </section>

        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Search</h2>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runSearch()
                }}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                placeholder="vehicle, client, deal, dealer..."
              />
              <Button size="sm" onClick={() => void runSearch()} disabled={searchState === 'loading'}>
                Search
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {searchResults.map((fact) => (
                <div key={fact.uuid || fact.fact} className="rounded border border-border bg-background p-3 text-sm text-foreground">
                  <div className="mb-1 text-xs text-muted-foreground">{fact.name}</div>
                  {fact.fact}
                </div>
              ))}
              {searchState === 'error' && <div className="text-sm text-amber-300">Search failed.</div>}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Conflict Alerts</h2>
            {data.conflicts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No multi-agent entity conflicts detected in the configured window.</p>
            ) : (
              <div className="space-y-3">
                {data.conflicts.slice(0, 6).map((conflict) => (
                  <div key={conflict.entityKey} className="rounded border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone="warn">{conflict.entityKey}</Pill>
                      <span className="text-xs text-amber-200">{conflict.count} touches by {conflict.agents.join(', ')}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Latest {formatTime(conflict.latestAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Write Stats</h2>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border border-border bg-background p-3">
                <div className="text-xl font-semibold text-foreground">{data.stats?.recentEpisodeCount || 0}</div>
                <div className="text-xs text-muted-foreground">episodes</div>
              </div>
              <div className="rounded border border-border bg-background p-3">
                <div className="text-xl font-semibold text-foreground">{data.stats?.recentFactCount || 0}</div>
                <div className="text-xs text-muted-foreground">facts</div>
              </div>
              <div className="rounded border border-border bg-background p-3">
                <div className="text-xl font-semibold text-foreground">{data.stats?.agentWrites?.length || 0}</div>
                <div className="text-xs text-muted-foreground">agents</div>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {(data.stats?.agentWrites || []).slice(0, 6).map((item) => (
                <div key={item.agent} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{item.agent}</span>
                  <Pill tone="good">{item.count}</Pill>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Graph Preview</h2>
            <div className="mb-3 text-xs text-muted-foreground">
              {graphPreview.agents.length} agents, {graphPreview.entities.length} entities, {graphPreview.edgeCount} links
            </div>
            <div className="flex flex-wrap gap-2">
              {graphPreview.agents.map((node) => <Pill key={node.id} tone="info">{node.label}</Pill>)}
              {graphPreview.entities.map((node) => <Pill key={node.id}>{node.label}</Pill>)}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
