'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TraceHealthBadge } from './trace-health-badge'
import type { LangfuseTraceSummary, TaskAgentContext } from '@/lib/langfuse/types'

type LangfuseTraceResponse = {
  enabled: boolean
  configured: boolean
  embedEnabled: boolean
  hasTrace: boolean
  summary: LangfuseTraceSummary | null
  taskContext?: TaskAgentContext | null
  traceDeeplinkBase?: string | null
  error?: string
}

function formatCost(value?: number | null): string {
  if (typeof value !== 'number') return 'Unavailable'
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`
}

function formatLatency(value?: number | null): string {
  if (typeof value !== 'number') return 'Unavailable'
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`
}

function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase text-muted-foreground/60 tracking-wide">{label}</div>
      <div className="text-sm text-foreground break-words">{value || 'Unavailable'}</div>
    </div>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-border/60 bg-secondary/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground/90">
      {children}
    </span>
  )
}

function ModeBadge({ mode }: { mode: string }) {
  const tone = mode === 'admin'
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    : mode === 'wholesale'
      ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      mode:{mode}
    </span>
  )
}

function AuthTierBadge({ tier }: { tier: 1 | 2 }) {
  const label = tier === 2 ? 'Tier 2 (PIN-verified)' : 'Tier 1 (read-only)'
  const tone = tier === 2
    ? 'border-red-500/30 bg-red-500/10 text-red-300'
    : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {label}
    </span>
  )
}

/**
 * True if at least one v4 task-context field is populated. Legacy tasks
 * created before migration 052 will return false here so the section hides
 * gracefully instead of rendering empty rows.
 */
function hasAgentContext(ctx?: TaskAgentContext | null): ctx is TaskAgentContext {
  if (!ctx) return false
  return Boolean(
    ctx.agent ||
    (ctx.mode && ctx.mode !== 'buyer') || // 'buyer' is the schema default; treat alone as no signal
    ctx.channel ||
    ctx.adminAuthTier ||
    ctx.adminIdentity ||
    ctx.intentThreadId ||
    ctx.dealId ||
    ctx.exceptionCategory ||
    (ctx.allowedTools && ctx.allowedTools.length > 0)
  )
}

/**
 * Build a Langfuse "filter dashboard" URL pre-applied with the relevant tag
 * filter. Langfuse's exact dashboard query-string syntax is project-specific
 * (typically `?filter=tags:has:<value>` in the v4 UI); we emit a stable
 * `?tags=<key>:<value>` shape that is easy to rewrite once the canonical
 * dashboard convention is finalized on the Langfuse side.
 */
function buildDashboardFilterUrl(
  base: string,
  filterKey: string,
  filterValue: string
): string {
  const cleanBase = base.replace(/\/$/, '')
  const tag = `${filterKey}:${filterValue}`
  return `${cleanBase}/traces?tags=${encodeURIComponent(tag)}`
}

export function LangfuseTraceTab({ taskId }: { taskId: number | string }) {
  const [data, setData] = useState<LangfuseTraceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contextOpen, setContextOpen] = useState(true)

  const load = useCallback(async () => {
    try {
      setError(null)
      const response = await fetch(`/api/tasks/${taskId}/observability/langfuse`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Failed to load trace summary')
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Langfuse trace summary could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const refresh = async () => {
    try {
      setRefreshing(true)
      setError(null)
      const response = await fetch(`/api/tasks/${taskId}/observability/langfuse/refresh`, { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Refresh failed')
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Langfuse trace summary could not be refreshed.')
    } finally {
      setRefreshing(false)
    }
  }

  const dashboardLink = useMemo(() => {
    const base = data?.traceDeeplinkBase
    const ctx = data?.taskContext
    if (!base || !ctx) return null
    // Prefer the most distinctive tag available, in order of operator usefulness.
    if (ctx.mode) return { label: `Filter: mode:${ctx.mode}`, href: buildDashboardFilterUrl(base, 'mode', ctx.mode) }
    if (ctx.agent) return { label: `Filter: agent:${ctx.agent}`, href: buildDashboardFilterUrl(base, 'agent', ctx.agent) }
    if (ctx.channel) return { label: `Filter: channel:${ctx.channel}`, href: buildDashboardFilterUrl(base, 'channel', ctx.channel) }
    return null
  }, [data?.traceDeeplinkBase, data?.taskContext])

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading Langfuse trace...</div>
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
        {error}
      </div>
    )
  }

  if (!data?.enabled) {
    return (
      <div className="rounded-lg border border-border/40 bg-secondary/20 p-4 text-sm text-muted-foreground">
        Langfuse integration is not enabled. Set LANGFUSE_ENABLED=true and configure Langfuse keys.
      </div>
    )
  }

  if (!data.configured) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
        Langfuse is enabled, but base URL and API keys are not fully configured.
      </div>
    )
  }

  const taskContext = data.taskContext
  const showContext = hasAgentContext(taskContext)

  // No trace AND no v4 context — original empty-state behavior.
  if (!data.hasTrace || !data.summary) {
    return (
      <div className="space-y-4">
        {showContext && (
          <AgentTaskContextSection
            context={taskContext}
            open={contextOpen}
            onToggle={() => setContextOpen((v) => !v)}
            dashboardLink={dashboardLink}
          />
        )}
        <div className="rounded-lg border border-border/40 bg-secondary/20 p-4 text-sm text-muted-foreground">
          No Langfuse trace is attached to this task yet.
        </div>
      </div>
    )
  }

  const summary = data.summary
  const model = [summary.modelProvider, summary.modelName].filter(Boolean).join(' / ')
  const prompt = [summary.promptName, summary.promptVersion].filter(Boolean).join(' @ ')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TraceHealthBadge health={summary.traceHealth} />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="xs" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
          {summary.url && (
            <Button asChild variant="default" size="xs">
              <a href={summary.url} target="_blank" rel="noopener noreferrer">
                Open Full Trace in Langfuse
              </a>
            </Button>
          )}
        </div>
      </div>

      {summary.failureReason && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <div className="text-[10px] uppercase text-red-300/70 tracking-wide">Failure Reason</div>
          <div className="mt-1 text-sm text-red-200 whitespace-pre-wrap">{summary.failureReason}</div>
        </div>
      )}

      {showContext && (
        <AgentTaskContextSection
          context={taskContext}
          open={contextOpen}
          onToggle={() => setContextOpen((v) => !v)}
          dashboardLink={dashboardLink}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-border/40 bg-secondary/20 p-3">
        <DetailRow label="Trace ID" value={<span className="font-mono text-xs">{summary.traceId}</span>} />
        <DetailRow label="Status" value={summary.traceStatus} />
        <DetailRow label="Agent ID" value={summary.agentId} />
        <DetailRow label="Workflow ID" value={summary.workflowRunId} />
        <DetailRow label="Cost" value={formatCost(summary.costUsd)} />
        <DetailRow label="Latency" value={formatLatency(summary.latencyMs)} />
        <DetailRow label="Model" value={model || undefined} />
        <DetailRow label="Prompt" value={prompt || undefined} />
        <DetailRow label="Eval Score" value={typeof summary.score === 'number' ? summary.score.toFixed(2) : undefined} />
        <DetailRow label="Updated" value={summary.updatedAt ? new Date(summary.updatedAt * 1000).toLocaleString() : undefined} />
      </div>

      {data.embedEnabled && summary.url && (
        <iframe
          src={summary.url}
          title="Langfuse trace"
          className="h-[480px] w-full rounded-lg border border-border bg-background"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
      )}
    </div>
  )
}

/**
 * Renders the v4 agent-task tag taxonomy (mode / channel / auth tier /
 * thread keys / allowed tools) sourced from the `tasks` table.
 *
 * NOTE: `adminIdentity` is only present in the payload when the viewer has
 * the `admin` role (gated server-side in the GET route). Trace tab access
 * is already restricted to authenticated viewers; no further gating is
 * applied client-side.
 */
function AgentTaskContextSection({
  context,
  open,
  onToggle,
  dashboardLink,
}: {
  context: TaskAgentContext
  open: boolean
  onToggle: () => void
  dashboardLink: { label: string; href: string } | null
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-secondary/20">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Agent Task Context
          </span>
          {context.mode && <ModeBadge mode={String(context.mode)} />}
          {context.adminAuthTier && <AuthTierBadge tier={context.adminAuthTier} />}
        </div>
        <span className="text-xs text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/40 px-3 py-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {context.agent && <DetailRow label="Agent" value={context.agent} />}
            {context.mode && <DetailRow label="Mode" value={String(context.mode)} />}
            {context.channel && <DetailRow label="Channel" value={context.channel} />}
            {context.adminAuthTier && (
              <DetailRow
                label="Admin Auth Tier"
                value={context.adminAuthTier === 2 ? '2 (PIN-verified)' : '1 (read-only)'}
              />
            )}
            {context.adminIdentity && (
              <DetailRow
                label="Admin Identity"
                value={<span className="font-mono text-xs">{context.adminIdentity}</span>}
              />
            )}
            {context.intentThreadId && (
              <DetailRow
                label="Intent Thread"
                value={<span className="font-mono text-xs">{context.intentThreadId}</span>}
              />
            )}
            {context.dealId && (
              <DetailRow label="Deal ID" value={<span className="font-mono text-xs">{context.dealId}</span>} />
            )}
            {context.exceptionCategory && (
              <DetailRow label="Exception" value={context.exceptionCategory} />
            )}
          </div>

          {context.allowedTools && context.allowedTools.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase text-muted-foreground/60 tracking-wide">Allowed Tools</div>
              <div className="flex flex-wrap gap-1">
                {context.allowedTools.map((tool) => (
                  <Chip key={tool}>{tool}</Chip>
                ))}
              </div>
            </div>
          )}

          {dashboardLink && (
            <div className="pt-1">
              <Button asChild variant="outline" size="xs">
                <a href={dashboardLink.href} target="_blank" rel="noopener noreferrer">
                  {dashboardLink.label}
                </a>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
