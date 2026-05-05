'use client'

import type { MouseEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'

export function InspectTraceButton({
  taskId,
  hasTrace,
  traceUrl,
  onInspect,
  size = 'xs',
}: {
  taskId: number | string
  hasTrace: boolean
  traceUrl?: string | null
  onInspect?: () => void
  size?: 'xs' | 'sm'
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const openTraceTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!hasTrace) return
    onInspect?.()
    const params = new URLSearchParams(searchParams.toString())
    params.set('taskId', String(taskId))
    params.set('taskTab', 'langfuse')
    router.push(`${pathname}?${params.toString()}`)
  }

  if (!hasTrace) {
    return (
      <Button variant="outline" size={size} disabled>
        No Trace Attached
      </Button>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <Button variant="outline" size={size} onClick={openTraceTab}>
        Inspect Trace
      </Button>
      {traceUrl && (
        <a
          href={traceUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title="Open full Langfuse trace"
          aria-label="Open full Langfuse trace"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 3.5H3.75A1.75 1.75 0 0 0 2 5.25v7A1.75 1.75 0 0 0 3.75 14h7A1.75 1.75 0 0 0 12.5 12.25V9.5" />
            <path d="M9 2h5v5M8 8l5.5-5.5" />
          </svg>
        </a>
      )}
    </div>
  )
}
