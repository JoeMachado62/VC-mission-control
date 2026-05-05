'use client'

import type { TraceHealth } from '@/lib/langfuse/types'

const TRACE_HEALTH_LABELS: Record<TraceHealth, string> = {
  no_trace: 'No Trace',
  healthy: 'Healthy',
  warning: 'Warning',
  failed: 'Failed',
  needs_eval: 'Needs Eval',
  unknown: 'Unknown',
}

const TRACE_HEALTH_CLASSES: Record<TraceHealth, string> = {
  no_trace: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  healthy: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  failed: 'bg-red-500/15 text-red-400 border-red-500/25',
  needs_eval: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
  unknown: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
}

export function TraceHealthBadge({
  health,
  label,
  compact = false,
}: {
  health: TraceHealth
  label?: string
  compact?: boolean
}) {
  const safeHealth = health in TRACE_HEALTH_LABELS ? health : 'unknown'
  return (
    <span
      className={`inline-flex items-center rounded border font-medium ${TRACE_HEALTH_CLASSES[safeHealth]} ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
      }`}
    >
      {label || TRACE_HEALTH_LABELS[safeHealth]}
    </span>
  )
}

