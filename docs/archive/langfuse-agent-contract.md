# Langfuse Agent Observability Contract

Mission Control owns task lifecycle state. Langfuse owns trace, prompt, score, latency, model usage, and cost detail. Agents should correlate both systems with the same task and agent IDs.

## Required Environment

```env
LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=https://observe.example.com
LANGFUSE_PUBLIC_KEY=pk-lf-REPLACE_ME
LANGFUSE_SECRET_KEY=sk-lf-REPLACE_ME
LANGFUSE_PROJECT_ID=REPLACE_ME
LANGFUSE_TRACE_DEEPLINK_BASE=https://observe.example.com
```

`LANGFUSE_SECRET_KEY` is server-side only. Do not expose it through `NEXT_PUBLIC_*` variables.

## Required Trace Metadata

Every Langfuse trace created for a Mission Control task should include:

```json
{
  "task_id": "mc_task_123",
  "agent_id": "vehicle_scout",
  "workflow_id": "vehicle_match",
  "environment": "production",
  "business": "virtual-carhub"
}
```

Recommended metadata for Virtual CarHub flows:

```json
{
  "ghl_contact_id": "abc123",
  "ghl_opportunity_id": "opp456",
  "buyer_id": "buyer_123",
  "vehicle_id": "VIN_OR_LISTING_ID",
  "pipeline_stage": "Vehicle Match In Progress",
  "prompt_name": "vehicle-scout",
  "prompt_version": "v7"
}
```

## Mission Control Link Endpoint

Agents attach or update the trace summary with:

```http
POST /api/tasks/:taskId/observability/langfuse
```

```json
{
  "agentId": "vehicle_scout",
  "workflowRunId": "workflow_123",
  "langfuseTraceId": "trace_abc123",
  "traceStatus": "failed",
  "traceHealth": "failed",
  "traceScore": 0,
  "traceCostUsd": 0.11,
  "traceLatencyMs": 8400,
  "promptName": "vehicle-scout",
  "promptVersion": "v7",
  "modelProvider": "openai",
  "modelName": "gpt-5-mini",
  "failureReason": "MarketCheck API returned empty result set",
  "metadata": {
    "ghlContactId": "abc123",
    "ghlOpportunityId": "opp456"
  }
}
```

## Lifecycle

1. Agent receives a task from Mission Control.
2. Agent starts a Langfuse trace and includes Mission Control IDs in metadata.
3. Agent logs LLM calls, tool calls, and key steps as Langfuse observations.
4. Agent immediately attaches the trace ID to Mission Control with `traceHealth: "needs_eval"`.
5. Agent reports task progress to Mission Control as usual.
6. On success, agent finalizes the trace, records score/cost/latency, and updates Mission Control.
7. On failure, agent records the error in Langfuse and posts `traceHealth: "failed"` plus `failureReason` to Mission Control.

## Minimal Wrapper Shape

```ts
async function runObservedTask(task, agent, handler) {
  const trace = await langfuse.trace({
    name: task.title,
    metadata: {
      task_id: String(task.id),
      agent_id: agent.id,
      workflow_id: task.workflowId,
      environment: process.env.LANGFUSE_DEFAULT_ENVIRONMENT || 'production',
      business: 'virtual-carhub',
    },
  })

  await missionControl.attachLangfuseTrace(task.id, {
    langfuseTraceId: trace.id,
    traceHealth: 'needs_eval',
  })

  try {
    const result = await handler({ task, agent, trace })
    await missionControl.attachLangfuseTrace(task.id, {
      langfuseTraceId: trace.id,
      traceStatus: 'completed',
      traceHealth: 'healthy',
      traceScore: 1,
    })
    return result
  } catch (error) {
    await missionControl.attachLangfuseTrace(task.id, {
      langfuseTraceId: trace.id,
      traceStatus: 'failed',
      traceHealth: 'failed',
      traceScore: 0,
      failureReason: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    await langfuse.flushAsync?.()
  }
}
```

