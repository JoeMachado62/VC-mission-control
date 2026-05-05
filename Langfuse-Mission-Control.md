# PRD: Langfuse Integration for Mission Control AgentOps Dashboard

## Document Purpose

This document is intended to be used as a product requirements document and implementation prompt for an AI coding assistant operating inside VS Code on the existing Mission Control codebase.

The goal is to install or connect Langfuse and integrate Langfuse observability into the existing Mission Control dashboard so that agent task failures, trace data, prompt versions, eval scores, latency, model usage, and cost data can be inspected directly from Mission Control.

Mission Control remains the central agent operating dashboard. Langfuse becomes the observability, tracing, evaluation, and prompt-debugging subsystem.

---

# 1. Product Summary

## 1.1 Product Name

**Mission Control + Langfuse Observability Integration**

Optional internal product name:

**Virtual CarHub AgentOps Command Center**

## 1.2 Business Context

Virtual CarHub is building a distributed AI-agent operating environment. Mission Control is already installed as the central operational dashboard, and at least one OpenClaw agent is already connected to that Mission Control server.

GoHighLevel is already used as the business CRM, opportunity pipeline, marketing automation, contact management, and workflow automation system. Therefore, this project must not duplicate CRM or deal pipeline functionality.

The purpose of this build is to make Mission Control the operational layer for agents while adding Langfuse as the observability layer for tracing, debugging, prompt evaluation, agent performance monitoring, and failure analysis.

## 1.3 Core Idea

When an AI agent task runs, Mission Control tracks the task lifecycle and operational status. Langfuse tracks the technical execution details of the task.

When a task fails inside Mission Control, the user should be able to click the failed task and open a Langfuse-powered trace view from inside Mission Control.

The end-user workflow should be:

```text
Mission Control Task Fails
        ↓
User opens Task Detail
        ↓
User clicks Langfuse / Trace tab
        ↓
Mission Control displays trace summary
        ↓
User can open the full Langfuse trace
        ↓
User can inspect LLM calls, tool calls, prompts, latency, cost, scores, and failure reason
```

---

# 2. Project Goals

## 2.1 Primary Goals

1. Deploy or connect Langfuse to the existing Mission Control server environment.
2. Add Langfuse configuration support to Mission Control.
3. Add Langfuse trace IDs and observability metadata to Mission Control tasks.
4. Add a Langfuse / Observability tab inside Mission Control task detail views.
5. Add an `Inspect Trace` action to failed Mission Control tasks.
6. Ensure OpenClaw agents can report task state to Mission Control and trace execution to Langfuse using shared IDs.
7. Provide a clean foundation for future agents to plug into the same observability pattern.

## 2.2 Secondary Goals

1. Add trace health indicators to Mission Control task cards.
2. Show trace cost, latency, model name, prompt version, and score summary inside Mission Control.
3. Support deep links from Mission Control to the full Langfuse trace UI.
4. Optionally support iframe embedding of Langfuse trace pages if authentication and browser security allow it.
5. Provide a future-safe path for migrating Mission Control from SQLite to PostgreSQL.

## 2.3 Non-Goals

This project must not attempt to:

1. Replace GoHighLevel CRM functionality.
2. Replace GoHighLevel opportunity pipelines.
3. Rebuild Langfuse inside Mission Control from scratch.
4. Merge Mission Control and Langfuse databases into one schema.
5. Fork Langfuse deeply unless absolutely necessary.
6. Convert Mission Control to PostgreSQL in the first implementation pass unless the codebase already makes this easy.
7. Build a complete native Langfuse trace viewer in the first version.

---

# 3. Target Architecture

## 3.1 Recommended Architecture

Mission Control and Langfuse should run as separate services. Mission Control should become Langfuse-aware.

```text
OpenClaw / AI Agents
        │
        ├── Task lifecycle events → Mission Control
        │
        └── Trace / observation / score events → Langfuse

Mission Control
        │
        ├── Stores task status
        ├── Stores linked Langfuse trace IDs
        ├── Displays trace health summaries
        └── Deep-links or embeds Langfuse trace views

Langfuse
        │
        ├── Stores traces
        ├── Stores observations
        ├── Stores scores
        ├── Stores prompt versions
        ├── Tracks latency/cost/model usage
        └── Provides debugging and eval tools
```

## 3.2 Service Layout

Preferred deployment pattern:

```text
mission-control.yourdomain.com  → Mission Control UI/API
observe.yourdomain.com          → Langfuse UI/API
```

Alternative path-based deployment:

```text
yourdomain.com/mission-control  → Mission Control
yourdomain.com/langfuse         → Langfuse
```

Subdomains are preferred because they are easier to configure and avoid path-routing issues.

## 3.3 Database Strategy

Short-term:

```text
Mission Control DB        → existing database, likely SQLite
Langfuse transactional DB → PostgreSQL
Langfuse analytics DB     → ClickHouse
Langfuse cache/queue      → Redis or Valkey
Langfuse blob/events      → S3-compatible storage or MinIO
```

Medium-term:

```text
PostgreSQL server
  ├── mission_control database
  └── langfuse database

ClickHouse
  └── langfuse observability data
```

Important: do not merge Mission Control tables into the Langfuse schema. Keep them separate even if they run on the same database server.

---

# 4. User Stories

## 4.1 Failed Task Trace Inspection

As an operator, when an agent task fails in Mission Control, I want to click `Inspect Trace` so I can see why the agent failed.

Acceptance criteria:

* Failed tasks display an `Inspect Trace` button when a Langfuse trace ID is available.
* Clicking the button opens the task detail page with the Langfuse / Observability tab selected.
* The tab displays trace ID, status, failure reason, cost, latency, model, prompt version, and eval score summary when available.
* The tab includes an `Open Full Trace in Langfuse` button.

## 4.2 Trace Health Badge

As an operator, I want every task to show trace health so I can quickly identify which task needs debugging.

Acceptance criteria:

* Task cards or task rows display a trace health state.
* Supported states:

  * `No Trace`
  * `Healthy`
  * `Warning`
  * `Failed`
  * `Needs Eval`
* Failed or warning states should be visually distinct.

## 4.3 Agent Run Correlation

As a developer, I want every agent task to use shared IDs across Mission Control and Langfuse so task failures can be traced reliably.

Acceptance criteria:

* Each Langfuse trace includes `task_id` in metadata.
* Each Langfuse trace includes `agent_id` in metadata.
* Mission Control stores the corresponding `langfuseTraceId`.
* If a GHL contact or opportunity ID exists, these IDs are included in Langfuse metadata.

## 4.4 Prompt Debugging

As a developer/operator, I want to know which prompt version was used during a failed task so I can fix or evaluate it.

Acceptance criteria:

* Mission Control can display `promptName` and `promptVersion` if provided by Langfuse or the agent.
* The Observability tab shows prompt version metadata when available.
* A future action can deep-link to Langfuse prompt management.

## 4.5 Future Agent Compatibility

As a platform owner, I want future agents to connect to the same Mission Control + Langfuse observability pattern.

Acceptance criteria:

* Provide a reusable helper/wrapper for agents to create Langfuse traces and update Mission Control.
* Document required metadata fields.
* Document environment variables.
* Document task lifecycle flow.

---

# 5. Functional Requirements

## 5.1 Langfuse Configuration

Mission Control must support Langfuse configuration through environment variables.

Required environment variables:

```env
LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=https://observe.example.com
LANGFUSE_PUBLIC_KEY=pk-lf-REPLACE_ME
LANGFUSE_SECRET_KEY=sk-lf-REPLACE_ME
LANGFUSE_PROJECT_ID=REPLACE_ME
LANGFUSE_TRACE_DEEPLINK_BASE=https://observe.example.com
```

Optional environment variables:

```env
LANGFUSE_EMBED_ENABLED=false
LANGFUSE_FETCH_SUMMARY_ENABLED=true
LANGFUSE_TIMEOUT_MS=8000
LANGFUSE_DEFAULT_ENVIRONMENT=production
```

Implementation notes:

* Never expose `LANGFUSE_SECRET_KEY` to client-side code.
* Server-side API routes should use the secret key.
* Client-side UI should only receive safe trace summary data and deep-link URLs.

## 5.2 Mission Control Task Model Updates

Add fields directly to the task model or create an observability-link table.

Preferred short-term approach: create a separate observability link model/table so the integration is less invasive.

Recommended table/model:

```sql
CREATE TABLE observability_links (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT,
  workflow_run_id TEXT,
  provider TEXT NOT NULL DEFAULT 'langfuse',
  langfuse_trace_id TEXT NOT NULL,
  langfuse_session_id TEXT,
  langfuse_project_id TEXT,
  langfuse_url TEXT,
  trace_status TEXT,
  trace_health TEXT,
  trace_score NUMERIC,
  trace_cost_usd NUMERIC,
  trace_latency_ms INTEGER,
  prompt_name TEXT,
  prompt_version TEXT,
  model_provider TEXT,
  model_name TEXT,
  failure_reason TEXT,
  metadata_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

If the current Mission Control database abstraction does not make a new table easy, add nullable fields to the existing task record:

```ts
langfuseTraceId?: string;
langfuseSessionId?: string;
langfuseProjectId?: string;
langfuseUrl?: string;
traceStatus?: string;
traceHealth?: 'no_trace' | 'healthy' | 'warning' | 'failed' | 'needs_eval';
traceScore?: number;
traceCostUsd?: number;
traceLatencyMs?: number;
promptName?: string;
promptVersion?: string;
modelProvider?: string;
modelName?: string;
failureReason?: string;
```

## 5.3 API Endpoints

Add or update Mission Control API endpoints.

### 5.3.1 Create or Update Langfuse Link

```http
POST /api/tasks/:taskId/observability/langfuse
```

Request body:

```json
{
  "agentId": "vehicle_scout",
  "workflowRunId": "workflow_123",
  "langfuseTraceId": "trace_abc123",
  "langfuseSessionId": "session_abc123",
  "langfuseProjectId": "project_abc123",
  "langfuseUrl": "https://observe.example.com/project/.../traces/trace_abc123",
  "traceStatus": "failed",
  "traceHealth": "failed",
  "traceScore": 0.42,
  "traceCostUsd": 0.11,
  "traceLatencyMs": 8400,
  "promptName": "vehicle-scout",
  "promptVersion": "v7",
  "modelProvider": "openai",
  "modelName": "gpt-5-mini",
  "failureReason": "MarketCheck API returned empty result set",
  "metadata": {
    "ghlContactId": "abc123",
    "ghlOpportunityId": "opp456",
    "vehicleId": "VIN_OR_LISTING_ID"
  }
}
```

Response:

```json
{
  "ok": true,
  "observabilityLink": {
    "taskId": "task_123",
    "langfuseTraceId": "trace_abc123",
    "traceHealth": "failed"
  }
}
```

### 5.3.2 Get Langfuse Link / Trace Summary

```http
GET /api/tasks/:taskId/observability/langfuse
```

Response:

```json
{
  "enabled": true,
  "hasTrace": true,
  "summary": {
    "traceId": "trace_abc123",
    "traceHealth": "failed",
    "traceStatus": "failed",
    "costUsd": 0.11,
    "latencyMs": 8400,
    "score": 0.42,
    "promptName": "vehicle-scout",
    "promptVersion": "v7",
    "modelProvider": "openai",
    "modelName": "gpt-5-mini",
    "failureReason": "MarketCheck API returned empty result set",
    "url": "https://observe.example.com/project/.../traces/trace_abc123"
  }
}
```

### 5.3.3 Optional: Refresh Trace Summary from Langfuse

```http
POST /api/tasks/:taskId/observability/langfuse/refresh
```

Purpose:

* Fetch latest trace details from Langfuse.
* Update Mission Control summary fields.
* Return updated summary.

This endpoint may be stubbed in the MVP if direct Langfuse API integration is not implemented yet.

## 5.4 Langfuse Tab in Task Detail UI

Add a new tab to task detail pages:

```text
Overview | Logs | Agent Events | Langfuse Trace
```

The tab should display:

* Trace Health
* Trace ID
* Trace Status
* Failure Reason
* Agent ID
* Workflow ID
* Cost
* Latency
* Model Provider
* Model Name
* Prompt Name
* Prompt Version
* Eval Score Summary
* Link to full Langfuse trace

Empty state:

```text
No Langfuse trace is attached to this task yet.
```

Error state:

```text
Langfuse is configured, but the trace summary could not be loaded.
```

Disabled state:

```text
Langfuse integration is not enabled. Set LANGFUSE_ENABLED=true and configure Langfuse keys.
```

## 5.5 Failed Task UI Changes

Failed tasks should display:

* Failure reason if available
* Trace health badge
* `Inspect Trace` button if Langfuse trace exists
* `No Trace Attached` indicator if not

Example UI text:

```text
Task Failed
Reason: MarketCheck API returned no matching listings.
Trace Health: Failed
Cost: $0.11
Latency: 8.4s
[Inspect Trace]
```

## 5.6 Agent Instrumentation Contract

Every agent that connects to Mission Control should follow this lifecycle:

```text
1. Agent receives task from Mission Control.
2. Agent starts Langfuse trace.
3. Agent writes trace metadata including Mission Control task ID.
4. Agent logs LLM calls, tool calls, and key steps as Langfuse observations.
5. Agent reports task progress to Mission Control.
6. On completion, agent finalizes trace and reports summary to Mission Control.
7. On failure, agent finalizes trace with error details and reports failed status to Mission Control.
```

Required Langfuse trace metadata:

```json
{
  "task_id": "mc_task_123",
  "agent_id": "vehicle_scout",
  "workflow_id": "vehicle_match",
  "environment": "production",
  "business": "virtual-carhub"
}
```

Recommended Langfuse trace metadata:

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

---

# 6. Technical Implementation Instructions for AI Coding Assistant

## 6.1 Initial Repository Inspection

Before writing code, inspect the Mission Control repository and identify:

1. Framework version and routing structure.
2. Database layer.
3. Task model/schema.
4. Agent model/schema.
5. Task detail UI component.
6. Task list/card UI component.
7. API route structure.
8. Environment variable handling.
9. Authentication/session pattern.
10. Existing webhook or event ingestion endpoints.

Search for these terms:

```text
task
agent
workflow
run
event
log
sqlite
prisma
dizzle
db
schema
api/tasks
env
settings
```

Note: If the repo uses a specific ORM, follow the existing pattern. Do not introduce a second ORM.

## 6.2 Implementation Rules

1. Make the smallest safe changes needed for the MVP.
2. Preserve existing Mission Control behavior.
3. Do not remove SQLite support.
4. Do not require PostgreSQL for the initial Langfuse integration.
5. Keep Langfuse secret keys server-side only.
6. Add clear error handling when Langfuse is not configured.
7. Add TypeScript types for all new data structures.
8. Follow existing UI component patterns.
9. Avoid hardcoding Virtual CarHub-specific names unless placed in configuration or metadata examples.
10. Keep Langfuse as optional. Mission Control must run without Langfuse.

---

# 7. Suggested File/Module Additions

Actual paths should follow the existing repo structure.

Possible additions:

```text
/lib/langfuse/config.ts
/lib/langfuse/client.ts
/lib/langfuse/types.ts
/lib/langfuse/links.ts
/components/tasks/LangfuseTraceTab.tsx
/components/tasks/TraceHealthBadge.tsx
/components/tasks/InspectTraceButton.tsx
/app/api/tasks/[taskId]/observability/langfuse/route.ts
/app/api/tasks/[taskId]/observability/langfuse/refresh/route.ts
```

If the repo uses `pages/api`, adapt accordingly:

```text
/pages/api/tasks/[taskId]/observability/langfuse.ts
/pages/api/tasks/[taskId]/observability/langfuse/refresh.ts
```

---

# 8. Langfuse Config Module

Create a server-safe config helper.

Example TypeScript shape:

```ts
export type LangfuseConfig = {
  enabled: boolean;
  baseUrl: string | null;
  publicKey: string | null;
  secretKey: string | null;
  projectId: string | null;
  embedEnabled: boolean;
  fetchSummaryEnabled: boolean;
  timeoutMs: number;
};

export function getLangfuseConfig(): LangfuseConfig {
  return {
    enabled: process.env.LANGFUSE_ENABLED === 'true',
    baseUrl: process.env.LANGFUSE_BASE_URL ?? null,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? null,
    secretKey: process.env.LANGFUSE_SECRET_KEY ?? null,
    projectId: process.env.LANGFUSE_PROJECT_ID ?? null,
    embedEnabled: process.env.LANGFUSE_EMBED_ENABLED === 'true',
    fetchSummaryEnabled: process.env.LANGFUSE_FETCH_SUMMARY_ENABLED !== 'false',
    timeoutMs: Number(process.env.LANGFUSE_TIMEOUT_MS ?? 8000),
  };
}

export function isLangfuseConfigured(config = getLangfuseConfig()): boolean {
  return Boolean(
    config.enabled &&
    config.baseUrl &&
    config.publicKey &&
    config.secretKey
  );
}
```

---

# 9. Trace Health Mapping

Implement this trace health mapping:

```ts
export type TraceHealth =
  | 'no_trace'
  | 'healthy'
  | 'warning'
  | 'failed'
  | 'needs_eval'
  | 'unknown';
```

Rules:

```text
No trace ID                           → no_trace
Task failed                           → failed
Trace score below configured threshold → warning
Trace exists but no scores             → needs_eval
Trace exists and score acceptable      → healthy
Unknown/unsupported state              → unknown
```

Default thresholds:

```ts
const DEFAULT_SCORE_WARNING_THRESHOLD = 0.7;
const DEFAULT_SCORE_FAILED_THRESHOLD = 0.4;
```

---

# 10. UI Requirements

## 10.1 TraceHealthBadge Component

Create a reusable badge.

Props:

```ts
type TraceHealthBadgeProps = {
  health: TraceHealth;
  label?: string;
};
```

Display labels:

```text
no_trace   → No Trace
healthy    → Healthy
warning    → Warning
failed     → Failed
needs_eval → Needs Eval
unknown    → Unknown
```

## 10.2 InspectTraceButton Component

Props:

```ts
type InspectTraceButtonProps = {
  taskId: string;
  hasTrace: boolean;
  traceUrl?: string;
};
```

Behavior:

* If `hasTrace` is true, route to the task detail view with Langfuse tab active.
* If the app supports direct external links, include a secondary option to open Langfuse in a new tab.
* If no trace exists, disable button or show `No Trace Attached`.

## 10.3 LangfuseTraceTab Component

Props:

```ts
type LangfuseTraceTabProps = {
  taskId: string;
};
```

Behavior:

* Fetch `/api/tasks/:taskId/observability/langfuse`.
* Display loading, empty, disabled, error, and success states.
* Render summary fields.
* Render `Open Full Trace in Langfuse` button.
* If `LANGFUSE_EMBED_ENABLED=true` and a URL exists, optionally show iframe.

---

# 11. Langfuse Deep Link Strategy

Preferred deep link generation:

```ts
function buildLangfuseTraceUrl(baseUrl: string, projectId: string, traceId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/project/${projectId}/traces/${traceId}`;
}
```

If the actual Langfuse route differs in the deployed version, inspect the Langfuse UI after installation and update the path builder accordingly.

Store the generated URL in Mission Control where possible.

---

# 12. Agent Wrapper Example

Create or document an agent helper.

Pseudo-code:

```ts
async function runObservedTask(task, agent, handler) {
  const trace = await langfuse.trace({
    name: task.name,
    id: task.langfuseTraceId,
    metadata: {
      task_id: task.id,
      agent_id: agent.id,
      workflow_id: task.workflowId,
      business: 'virtual-carhub',
      environment: process.env.NODE_ENV,
      ghl_contact_id: task.ghlContactId,
      ghl_opportunity_id: task.ghlOpportunityId,
    },
  });

  await missionControl.attachLangfuseTrace(task.id, {
    langfuseTraceId: trace.id,
    traceHealth: 'needs_eval',
  });

  try {
    const result = await handler({ task, agent, trace });

    await langfuse.score({
      traceId: trace.id,
      name: 'task_success',
      value: 1,
    });

    await missionControl.completeTask(task.id, {
      langfuseTraceId: trace.id,
      traceHealth: 'healthy',
    });

    return result;
  } catch (error) {
    await langfuse.score({
      traceId: trace.id,
      name: 'task_success',
      value: 0,
      comment: error.message,
    });

    await missionControl.failTask(task.id, {
      failureReason: error.message,
      langfuseTraceId: trace.id,
      traceHealth: 'failed',
    });

    throw error;
  } finally {
    await langfuse.flushAsync?.();
  }
}
```

Adapt the actual code to the Langfuse SDK and the existing OpenClaw/Mission Control agent pattern.

---

# 13. Langfuse Source Repository and Deployment Requirements

## 13.1 Langfuse Source Repository

Langfuse should be treated as a separate upstream open-source service, not copied directly into the Mission Control source tree during the MVP.

Official repository:

```text
https://github.com/langfuse/langfuse
```

Clone location recommendation:

```bash
mkdir -p /opt/agentops
cd /opt/agentops

git clone https://github.com/langfuse/langfuse.git
```

Suggested server layout:

```text
/opt/agentops/
  mission-control/        # existing Mission Control install/repo
  langfuse/               # cloned Langfuse repo
  docker-compose.override.yml or deployment files
  .env                    # server-level env file if used
```

Important implementation rule:

```text
Do not vendor Langfuse into Mission Control for the MVP.
Run Langfuse beside Mission Control and integrate through URL/API/deep links.
```

Langfuse describes itself as an open-source LLM engineering platform for observability, prompt management, evaluations, datasets, and debugging. Its GitHub repository includes `web`, `worker`, `packages`, Docker Compose files, environment examples, and self-hosting links.

## 13.2 Clone and Keep Upstream-Friendly

Preferred clone command:

```bash
git clone https://github.com/langfuse/langfuse.git /opt/agentops/langfuse
```

If custom changes are ever needed later:

```bash
cd /opt/agentops/langfuse
git remote rename origin upstream
git remote add origin <YOUR_PRIVATE_LANGFUSE_FORK_URL>
```

For the MVP, do not modify Langfuse core. Use it as an external observability service.

## 13.3 Langfuse Deployment Options

Preferred MVP deployment options:

### Option A — Langfuse Cloud

Use Langfuse Cloud first if speed is more important than data-control or local customization.

Mission Control only needs:

```env
LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=pk-lf-REPLACE_ME
LANGFUSE_SECRET_KEY=sk-lf-REPLACE_ME
LANGFUSE_PROJECT_ID=REPLACE_ME
```

### Option B — Self-hosted Langfuse on same VPS

Use the official Langfuse repo and Docker Compose files.

Recommended initial server folder:

```bash
cd /opt/agentops/langfuse
cp .env.prod.example .env
# edit .env with secure values
```

Then run using the deployment method recommended by the current Langfuse docs/repo.

Implementation note for the coding agent:

```text
Before writing deployment commands, inspect the current Langfuse README and docker-compose files in the cloned repo. Use the current official instructions rather than assuming older commands.
```

## 13.4 Mission Control Integration Target

Mission Control should point to Langfuse through environment variables:

```env
LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=https://observe.example.com
LANGFUSE_PUBLIC_KEY=pk-lf-REPLACE_ME
LANGFUSE_SECRET_KEY=sk-lf-REPLACE_ME
LANGFUSE_PROJECT_ID=REPLACE_ME
LANGFUSE_TRACE_DEEPLINK_BASE=https://observe.example.com
```

The Mission Control code should not depend on the Langfuse source code existing locally. It should only depend on:

```text
1. Langfuse URL
2. Langfuse API keys
3. Langfuse trace IDs
4. Langfuse API/deep-link format
```

---

# 14. Deployment Requirements

## 13.1 Docker Compose

If using Docker Compose, add Langfuse and its dependencies as a separate stack or compose profile.

Recommended service grouping:

```text
mission-control
langfuse-web
langfuse-worker
postgres
clickhouse
redis or valkey
minio or S3-compatible storage
reverse-proxy
```

## 13.2 Reverse Proxy

Configure reverse proxy for:

```text
mission-control.example.com
observe.example.com
```

Use HTTPS.

## 13.3 Secrets

Secrets required:

```text
LANGFUSE_PUBLIC_KEY
LANGFUSE_SECRET_KEY
LANGFUSE_SALT
NEXTAUTH_SECRET or Langfuse auth secret if required
DATABASE_URL for Langfuse Postgres
CLICKHOUSE credentials
REDIS credentials
S3/MinIO credentials
```

Never commit secrets.

---

# 14. PostgreSQL Migration Plan for Mission Control

This is a future phase unless current Mission Control storage is already easily configurable.

## 14.1 Goal

Allow Mission Control to use PostgreSQL in production while preserving SQLite support for local/simple deployments.

## 14.2 Approach

1. Inspect current database layer.
2. Identify whether an ORM is used.
3. Add a database provider abstraction if needed.
4. Preserve existing SQLite adapter.
5. Add PostgreSQL adapter.
6. Use environment variable:

```env
MISSION_CONTROL_DATABASE_PROVIDER=postgres
MISSION_CONTROL_DATABASE_URL=postgres://user:password@localhost:5432/mission_control
```

SQLite fallback:

```env
MISSION_CONTROL_DATABASE_PROVIDER=sqlite
MISSION_CONTROL_SQLITE_PATH=./data/mission-control.sqlite
```

## 14.3 Do Not Do This

Do not store Mission Control operational tables inside the Langfuse database schema.

Acceptable:

```text
Same PostgreSQL server, separate databases.
```

Not acceptable:

```text
Mission Control tables mixed into Langfuse schema.
```

## 14.4 Migration Priority

Migrate in this order:

1. Tasks
2. Agents
3. Task events
4. Workflow runs
5. Observability links
6. Settings
7. Skills
8. Audit logs
9. Webhooks
10. Cron jobs

---

# 15. Testing Requirements

## 15.1 Unit Tests

Add tests for:

* Langfuse config parsing.
* Trace URL builder.
* Trace health mapping.
* API request validation.
* Missing Langfuse config handling.

## 15.2 Integration Tests

Add tests for:

* Creating an observability link for a task.
* Fetching trace summary for a task.
* Failed task displays trace health.
* Langfuse tab displays empty state when no trace exists.
* Langfuse tab displays summary when trace exists.

## 15.3 Manual QA Checklist

1. Mission Control starts without Langfuse configured.
2. Mission Control starts with Langfuse configured.
3. Existing tasks still load.
4. Failed task without trace displays `No Trace`.
5. Failed task with trace displays `Inspect Trace`.
6. Inspect Trace opens Langfuse tab.
7. Full trace link opens Langfuse in a new tab.
8. Langfuse secret key is not exposed in browser network payloads.
9. OpenClaw agent can attach a trace ID to a task.
10. Failed agent task creates/update observability summary.

---

# 16. Acceptance Criteria for MVP

The MVP is complete when:

1. Langfuse can run beside Mission Control or Mission Control can connect to an external Langfuse URL.
2. Mission Control has environment-variable configuration for Langfuse.
3. A Mission Control task can store a Langfuse trace ID.
4. A Mission Control task can return Langfuse observability data through an API endpoint.
5. Failed tasks display an `Inspect Trace` action.
6. Task detail pages include a Langfuse / Observability tab.
7. The Langfuse tab shows trace summary and a full trace deep link.
8. The OpenClaw agent can create or pass a Langfuse trace ID into Mission Control.
9. Mission Control remains functional when Langfuse is disabled.
10. No Langfuse secret keys are exposed client-side.

---

# 17. Future Enhancements

After MVP:

1. Native Langfuse trace tree renderer inside Mission Control.
2. `Create Eval Case` action from failed Mission Control tasks.
3. `Edit Prompt` action that opens Langfuse prompt management.
4. `Replay Task` action using same input and revised prompt.
5. Automatic failure categorization.
6. Agent reliability score.
7. Tool reliability dashboard.
8. Cost-per-agent dashboard.
9. Prompt-version performance dashboard.
10. GHL opportunity timeline integration.
11. PostgreSQL migration for Mission Control.
12. Multi-tenant workspace mapping between Mission Control and Langfuse.
13. SSO between Mission Control and Langfuse.
14. Human review queue driven by Langfuse eval thresholds.

---

# 18. Suggested Implementation Prompt for VS Code AI Agent

Use the following prompt inside VS Code connected to the Mission Control repository:

```text
You are working inside the existing Mission Control repository. Your task is to add a Langfuse observability integration to Mission Control.

Context:
- Mission Control is the central dashboard for AI agents and tasks.
- Langfuse will run as a separate observability service.
- Mission Control should remain the main operational UI.
- Langfuse should provide trace, eval, prompt, cost, latency, and debugging insight.
- The first goal is not to fully merge Langfuse into Mission Control.
- The first goal is to make Mission Control Langfuse-aware.

Primary requirements:
1. Inspect the existing repository structure before making changes.
2. Identify the task model, task detail UI, task list UI, API route structure, database layer, and environment variable pattern.
3. Add optional Langfuse configuration through environment variables.
4. Add a way to associate a Mission Control task with a Langfuse trace ID.
5. Add server-side API endpoints to create/update and fetch Langfuse observability links for tasks.
6. Add a Trace Health badge to task cards or task rows.
7. Add an Inspect Trace button for failed tasks that have a Langfuse trace ID.
8. Add a Langfuse / Observability tab to the task detail page.
9. The Langfuse tab should display trace summary fields and a button to open the full Langfuse trace in a new browser tab.
10. Mission Control must continue to work if Langfuse is disabled or not configured.
11. Never expose the Langfuse secret key to the browser.
12. Follow the existing codebase style, routing conventions, database conventions, and UI patterns.
13. Do not migrate Mission Control from SQLite to PostgreSQL in this first pass unless the repository already supports a clean provider switch.
14. Add clear comments and minimal tests where appropriate.

Required environment variables:
LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=https://observe.example.com
LANGFUSE_PUBLIC_KEY=pk-lf-REPLACE_ME
LANGFUSE_SECRET_KEY=sk-lf-REPLACE_ME
LANGFUSE_PROJECT_ID=REPLACE_ME
LANGFUSE_EMBED_ENABLED=false
LANGFUSE_FETCH_SUMMARY_ENABLED=true
LANGFUSE_TIMEOUT_MS=8000

Data to store for each task when available:
- langfuseTraceId
- langfuseSessionId
- langfuseProjectId
- langfuseUrl
- traceStatus
- traceHealth
- traceScore
- traceCostUsd
- traceLatencyMs
- promptName
- promptVersion
- modelProvider
- modelName
- failureReason
- metadata

Preferred implementation:
- If the database layer makes it easy, create an observability_links table/model.
- If not, add nullable fields to the existing task model.
- Keep the integration optional.
- Add graceful empty/error states in the UI.

UI behavior:
- Failed task with trace: show Inspect Trace.
- Failed task without trace: show No Trace Attached.
- Task detail page has Langfuse / Observability tab.
- Tab shows summary and Open Full Trace button.
- Optional iframe should only be enabled when LANGFUSE_EMBED_ENABLED=true.

Acceptance criteria:
- Existing Mission Control functionality still works.
- A task can be linked to a Langfuse trace.
- Failed tasks expose the Inspect Trace workflow.
- Langfuse tab displays trace data or useful empty/error states.
- Full trace opens in Langfuse.
- No secrets are leaked client-side.

Begin by inspecting the repository and reporting the relevant files you found. Then implement the smallest safe MVP.
```

---

# 19. Suggested Commit Plan

Use small commits:

```text
commit 1: add Langfuse config and types
commit 2: add observability link storage and APIs
commit 3: add trace health badge and inspect trace button
commit 4: add Langfuse tab to task detail view
commit 5: wire failed task workflow and documentation
commit 6: add tests and cleanup
```

---

# 20. Final Notes

The correct product direction is:

```text
Mission Control owns operations.
Langfuse owns observability.
Agents write to both.
Mission Control displays Langfuse insight where operational decisions happen.
```

The system should be designed so future Virtual CarHub agents can plug into the same pattern without custom one-off integrations.

The first implementation should be simple, stable, and upgrade-safe:

```text
Deep link first.
Iframe second.
Native trace rendering later.
PostgreSQL migration later.
```
