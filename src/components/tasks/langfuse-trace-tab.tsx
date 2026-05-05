'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TraceHealthBadge } from './trace-health-badge'
import type { LangfuseTraceSummary } from '@/lib/langfuse/types'

type LangfuseTraceResponse = {
  enabled: boolean
  configured: boolean
  embedEnabled: boolean
  hasTrace: boolean
  summary: LangfuseTraceSummary | null
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

export function LangfuseTraceTab({ taskId }: { taskId: number | string }) {
  const [data, setData] = useState<LangfuseTraceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  if (!data.hasTrace || !data.summary) {
    return (
      <div className="rounded-lg border border-border/40 bg-secondary/20 p-4 text-sm text-muted-foreground">
        No Langfuse trace is attached to this task yet.
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
