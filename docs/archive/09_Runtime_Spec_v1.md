# VCH Agent Runtime Specification — v1

**Version:** 1.0 | May 2026
**Companion docs:** `VCH_Agent_Fleet_Plan_v5.md`, `01_DannyAgent_PRD_v4.md` + addendum, `02_NegotiatorAgent_PRD_v4.md` + addendum, `08_Observability_Architecture_v3.md`
**Status:** Approved for build

This document defines the **Python agent worker runtime** that replaces the v4 "OpenClaw Python framework" assumption. The runtime is a custom-built service deployed from the shared `vch-backend` codebase. Each agent VPS runs an instance of this runtime, configured for its specific agent role (Danny, Negotiator, or future specialists).

The architectural and behavioral content of the agent PRDs (workflows, personas, tools, rate limits, untrusted content rules, extraction patterns, HITL rules, eval suites, acceptance criteria) sits *on top of* this runtime. This spec is concerned only with the runtime mechanics.

---

## 1. PURPOSE

Provide a Python service per agent VPS that:

1. **Receives tasks** from Mission Control over HTTP
2. **Processes tasks** through an asyncio worker pool, fresh context per task
3. **Calls LLMs, MCPs, and the backend** using shared Python libraries (OpenAI SDK, MCP client, httpx)
4. **Reports back** to MC via webhook, and to Langfuse via SDK
5. **Heartbeats** to MC for health monitoring
6. **Drains cleanly** for graceful shutdown during deployments

The runtime is **stateless across tasks** — durable state lives in GHL (conversations), backend Postgres (deals/threads/strategy reports), and Graphiti (shared knowledge). Each task invocation loads context fresh, processes, writes back, exits.

This matches the "parallel subagent spawn" model: many concurrent task invocations on one worker, all loading their own context, all running independently, all writing through the same backend policy layer.

---

## 2. SCOPE — WHAT THIS SPEC COVERS

| In scope | Out of scope (covered elsewhere) |
|---|---|
| Worker process structure | Agent personas (in agent PRDs) |
| Task ingestion HTTP API | Workflows / behaviors (in agent PRDs) |
| Worker pool concurrency model | Tool definitions (in agent PRDs) |
| Per-task lifecycle | Persona content / AGENTS.md (in agent PRDs) |
| Context preload from GHL/Graphiti | Rate limits / intent threads (in agent PRDs + agent_actions_service) |
| LLM invocation pattern | Untrusted content rules (in agent PRDs) |
| Heartbeat + health protocol | Eval suites (in agent PRDs) |
| Drain protocol | Mission Control UI design (in MC product spec) |
| Config schema | Webhook handler logic (in orchestrator service) |
| Deployment (systemd) | Database schemas (in backend models) |
| MC ↔ worker HTTP contract | |
| Langfuse integration | |

---

## 3. PROCESS STRUCTURE

Each agent worker is a single Python process running as a systemd service. One process per VPS. Inside that process:

```
┌─────────────────────────────────────────────────────────────────┐
│ Worker process (e.g. danny-worker.service)                       │
│                                                                  │
│  ┌──────────────────┐  ┌───────────────────┐  ┌───────────────┐ │
│  │ FastAPI server   │  │ Worker pool       │  │ Heartbeat     │ │
│  │ (uvicorn)        │  │ (asyncio)         │  │ task          │ │
│  │                  │  │                   │  │               │ │
│  │ POST /tasks      │  │ N concurrent      │  │ Every 15-30s  │ │
│  │ POST /drain      │  │ task coroutines   │  │ POST to MC    │ │
│  │ GET /health      │  │                   │  │               │ │
│  │ GET /version     │  │                   │  │               │ │
│  └────────┬─────────┘  └────────┬──────────┘  └───────────────┘ │
│           │                     │                                │
│           └──────────►  Task queue (asyncio.Queue)               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

- **FastAPI server**: receives task dispatches from MC, queues them
- **Worker pool**: N asyncio coroutines pulling tasks from queue, processing concurrently
- **Heartbeat task**: background coroutine sending health pings to MC
- **Shared state**: minimal — just the queue, active task count, drain flag

### 3.1 Why One Process, Multiple Workers

Python asyncio handles I/O-bound concurrency well. Agent tasks are overwhelmingly I/O-bound (waiting on LLM, MCP, backend HTTP). One process with N=8 concurrent worker coroutines can handle 8 in-flight tasks where most are awaiting external responses.

If CPU work becomes bottleneck (rare — would require heavy local computation), scale horizontally: add another VPS, not more workers in one process.

### 3.2 Worker Pool Sizing

Default `WORKER_POOL_SIZE=8` per VPS. Tunable per agent based on observed load:

- Danny buyer mode: I/O-heavy. 8-12 is reasonable for one CPX31 VPS.
- Negotiator with Browser Use: each browser session consumes more memory. Start at 4-6 — Browser Use sessions are heavier than pure HTTP tasks.

The orchestrator dispatches tasks; if a worker is at capacity, MC routes to a different VPS or queues (see §4.3). At MVP with one VPS per agent, queueing is the path — at scale, add VPSs and load-balance.

---

## 4. HTTP API — MC ↔ WORKER CONTRACT

### 4.1 POST /tasks

Mission Control dispatches a task to a specific worker.

**Request:**
```json
{
  "task_id": "task_abc123",
  "task_type": "present_recommendations",
  "agent_id": "danny",
  "mode": "buyer",
  "channel": "widget",
  "admin_auth_tier": null,
  "admin_identity": null,
  "contact_id": "ghl_contact_456",
  "deal_id": "deal_789",
  "vin": null,
  "intent_thread_id": "present_recommendations_initial",
  "allowed_tools": ["ghl.get_contact", "ghl.get_conversation_thread", "marketcheck.predict_price", "backend.matching_run", "backend.matching_results", "backend.send_email", "backend.add_contact_note"],
  "payload": {
    "trigger": "deal_state_change",
    "from_state": "MATCHING",
    "to_state": "PROFILED"
  },
  "callback_url": "https://mc.virtualcarhub.com/api/orchestration/task-callback",
  "deadline_seconds": 600
}
```

**Auth:** `X-Service-Token` header — shared secret between MC and worker.

**Response (immediate, before processing):**
```json
{
  "task_id": "task_abc123",
  "accepted_at": "2026-05-09T14:23:00Z",
  "queue_depth": 3,
  "estimated_start_seconds": 12
}
```

**Failure modes:**
- 503 if worker is in drain mode → MC retries to a different worker or queues
- 429 if worker queue is full (configurable cap, default 50) → MC retries elsewhere
- 401 if `X-Service-Token` invalid → security alert

### 4.2 POST /drain

Mission Control requests a worker to stop accepting new tasks. Used during deploys.

**Request:** empty body, `X-Service-Token` auth.

**Response:**
```json
{
  "drain_initiated_at": "2026-05-09T14:30:00Z",
  "tasks_in_flight": 6,
  "estimated_drain_completion_seconds": 180
}
```

Behavior:
- Worker stops accepting new POST /tasks (returns 503)
- In-flight tasks complete normally
- Heartbeat continues, status flag changes to `draining`
- When in-flight count reaches 0, worker calls `POST /api/orchestration/drained` to MC
- MC can then safely restart/redeploy the worker

### 4.3 GET /health

Simple health endpoint for MC heartbeat monitoring.

**Response:**
```json
{
  "status": "online",
  "agent_id": "danny",
  "version": "v5.0.0",
  "workers_total": 8,
  "workers_active": 3,
  "queue_depth": 1,
  "uptime_seconds": 14422,
  "memory_usage_mb": 412,
  "drain_mode": false
}
```

### 4.4 GET /version

Returns AGENTS.md version, Python code version, dependency versions.

**Response:**
```json
{
  "agent_id": "danny",
  "code_version": "v5.0.0",
  "agents_md_version": "v5.0.0",
  "agents_md_sha256": "a4b8...",
  "python_version": "3.12.3",
  "key_deps": {
    "openai": "1.x.y",
    "langfuse": "2.x.y",
    "httpx": "0.x.y"
  }
}
```

### 4.5 Worker → MC Callbacks

Workers POST status updates to `callback_url` from the task dispatch:

```json
POST <callback_url>
{
  "task_id": "task_abc123",
  "status": "in_progress" | "completed" | "failed" | "hitl_created",
  "langfuse_trace_id": "trace_xyz",
  "started_at": "2026-05-09T14:23:12Z",
  "completed_at": "2026-05-09T14:24:08Z",
  "result_summary": "Sent 5-vehicle recommendation email; 3 follow-ups expected.",
  "hitl_task_id": null,
  "error": null
}
```

Worker emits at minimum:
1. `in_progress` when task starts processing (out of queue)
2. `completed` | `failed` | `hitl_created` when task ends

### 4.6 Worker → MC Heartbeats

Background coroutine in each worker:

```
Every 15-30 seconds:
  POST https://mc.virtualcarhub.com/api/orchestration/heartbeat
  Body: {agent_id, vps_hostname, workers_total, workers_active, queue_depth, version, drain_mode, uptime_seconds}
```

MC tracks last_seen per worker. If no heartbeat for `2 * interval`, worker marked as offline.

---

## 5. PER-TASK LIFECYCLE

Inside a worker coroutine, processing one task:

```
1. Pull task from asyncio queue
2. Open Langfuse trace; tag (agent, mode, channel, task_type, intent_thread_id, worker_vps, agent_version)
3. Send callback {status: in_progress}
4. Preload context (parallel where possible):
   ├── If contact_id present: GHL MCP get_contact, get_conversation_thread (last 30d)
   ├── If deal_id present:    backend HTTP GET /v1/admin/deals/{deal_id}
   ├── If vin present:        backend HTTP GET /v1/inventory/{vin} + GET /v1/strategy-reports/{deal_id}
   └── Graphiti query (if applicable to task_type)
5. Wrap untrusted content in fenced tags (per agent PRD §10)
6. Assemble system prompt:
   ├── Load /opt/<agent>-agent/AGENTS.md (cached in memory)
   ├── Append mode-specific block (Danny only)
   ├── Append task-specific instructions
   └── Append loaded context
7. Register tool subset with LLM:
   ├── Filter to task.allowed_tools
   ├── Build OpenAI function-call definitions
   └── Verify each tool has a Python implementation
8. LLM call loop:
   ├── OpenAI call (model tier per task config — nano/mini/full)
   ├── If tool_calls in response:
   │     For each tool_call:
   │       ├── Execute via shared client (ghl_mcp_client, marketcheck_mcp_client, backend_http_client, browser_use_session)
   │       ├── Span the call in Langfuse
   │       ├── Append result to messages
   │     Loop back to OpenAI call
   └── If final response: proceed to step 9
9. Output validation:
   ├── No raw injected content from earlier turns
   ├── No leaked credentials/tokens
   └── Format matches expected schema for task_type
10. Final actions:
    ├── For workflows that send outbound: it's already been called as a tool in step 8
    ├── Add GHL contact note via /v1/agent-actions/add-contact-note (with langfuse trace deep link)
    └── Write any persisted facts to Graphiti
11. Close trace
12. Send callback {status: completed | hitl_created | failed, langfuse_trace_id, result_summary}
13. Worker coroutine returns to pulling next task
```

### 5.1 Cold Start vs. Warm Worker

The worker process stays warm across tasks — AGENTS.md cached, tool clients reused, HTTP connection pools warm. Per-task overhead is small (loading context from GHL/backend/Graphiti — those are real HTTP calls but bounded).

A fresh task on a warm worker should start LLM-calling within 200-500ms of pulling from queue. The dominant latency is the LLM call itself + external API calls.

### 5.2 Concurrency Within a Worker Process

N=8 worker coroutines, asyncio. Each coroutine is independent — its own task, its own context, its own LLM session. Shared resources within the process:

- HTTP connection pools (httpx)
- AGENTS.md (loaded once at startup)
- Tool client instances (thread-safe / async-safe)
- Langfuse SDK
- Task queue

No shared mutable state across tasks. Each task's working memory dies when the coroutine completes.

---

## 6. CONFIG SCHEMA

Per-VPS config file at `/etc/vch-agent.env`. Loaded by the worker via `python-dotenv`. Schema validated with Pydantic Settings at startup.

```bash
# Identity
AGENT_ID=danny                          # or negotiator, logistics, etc.
VCH_ENV=production                      # production | staging
VPS_HOSTNAME=vch-agent-danny            # for trace tagging

# Concurrency
WORKER_POOL_SIZE=8                      # Danny default; Negotiator default 6
TASK_QUEUE_MAX=50                       # reject new tasks if queue exceeds this
TASK_DEADLINE_SECONDS_DEFAULT=600       # 10 min default per task

# Heartbeat
HEARTBEAT_INTERVAL_SECONDS=15           # Danny; Negotiator: 30
HEARTBEAT_MISSING_TOLERANCE_SECONDS=120 # Danny; Negotiator: 300

# Models
OPENAI_API_KEY=sk-...
MODEL_NANO=gpt-5.4-nano
MODEL_MINI=gpt-5.4-mini
MODEL_FULL=gpt-5.4

# Tool destinations
VCH_BACKEND_URL=https://api.virtualcarhub.com
VCH_BACKEND_SERVICE_TOKEN=...
GHL_MCP_URL=https://services.leadconnectorhq.com/mcp/
GHL_PRIVATE_INTEGRATION_TOKEN=pit-...
GHL_LOCATION_ID=...
MARKETCHECK_MCP_URL=...
MARKETCHECK_API_KEY=...

# Mission Control
MC_URL=https://mc.virtualcarhub.com
MC_WORKER_AUTH_TOKEN=...                # for /tasks dispatch verification
MC_CALLBACK_AUTH_TOKEN=...              # for worker → MC callbacks

# Memory
TIER1_MEMORY_PATH=/var/lib/vch-agent/memory.db
GRAPHITI_API_URL=http://10.50.0.5:8001
GRAPHITI_NAMESPACE=vch_buyer            # Danny buyer; Danny admin → vch_admin; Negotiator → vch_wholesale

# Observability
LANGFUSE_BASE_URL=http://10.50.0.5:3002
LANGFUSE_PUBLIC_KEY=pk_...
LANGFUSE_SECRET_KEY=sk_...
LANGFUSE_REDACT_PATTERNS=OPENAI_API_KEY,LANGFUSE_SECRET_KEY,.*_TOKEN,.*_SECRET,Bearer\s+\S+

# Browser Use (Negotiator only)
BROWSER_USE_ENABLED=false               # true on Negotiator VPS
BROWSER_USE_USER_DATA_DIR=/opt/negotiator-agent/browser_profiles
BROWSER_USE_HEADLESS=true
BROWSER_USE_VIEWPORT_WIDTH=1280
BROWSER_USE_VIEWPORT_HEIGHT=800
BROWSER_SESSION_MAX_MINUTES=15
BROWSER_SESSION_MAX_TURNS=10
```

Each VPS gets its own `.env` matching its agent role. Most values are shared across all agent VPSs; the differences are `AGENT_ID`, `VPS_HOSTNAME`, `GRAPHITI_NAMESPACE`, `WORKER_POOL_SIZE`, `BROWSER_USE_*`.

---

## 7. PERSONA LOADING

At worker startup, the runtime loads `/opt/<agent>-agent/AGENTS.md` (e.g., `/opt/danny-agent/AGENTS.md`). Content matches the persona block from the agent's v4 PRD §3 (shared preamble + mode blocks for Danny, single persona for Negotiator).

Persona file is deployed alongside the worker — `vch-backend/app/agents/<agent>/AGENTS.md` in the repo, symlinked or copied to `/opt/<agent>-agent/AGENTS.md` at deploy time.

Versioning: AGENTS.md changes are tracked. The MC `AgentVersion` table records SHA-256 of currently-deployed AGENTS.md per worker. Updates require a deploy + drain cycle.

---

## 8. SHARED CODEBASE STRUCTURE

The runtime lives in `vch-backend/app/agents/`. Single repo, single Python codebase, multiple deployable services:

```
vch-backend/
├── app/
│   ├── api/                    # FastAPI api.service (existing)
│   ├── services/               # existing services + new agent_actions_service
│   ├── models/                 # existing + new dealer/thread/strategy_report
│   ├── orchestration/          # NEW — runs as orchestrator.service
│   └── agents/                 # NEW
│       ├── __init__.py
│       ├── runtime/            # Shared runtime library
│       │   ├── __init__.py
│       │   ├── server.py       # FastAPI server (POST /tasks, /drain, /health)
│       │   ├── worker.py       # asyncio worker pool
│       │   ├── task_handler.py # per-task lifecycle (§5)
│       │   ├── context_loader.py
│       │   ├── tool_registry.py
│       │   ├── llm_client.py
│       │   ├── memory.py
│       │   ├── observability.py
│       │   ├── heartbeat.py
│       │   ├── drain.py
│       │   └── config.py       # Pydantic settings
│       ├── shared/             # Shared tool clients + utilities
│       │   ├── ghl_mcp_client.py
│       │   ├── marketcheck_mcp_client.py
│       │   ├── backend_http_client.py
│       │   ├── extraction.py
│       │   ├── untrusted_content.py
│       │   ├── rate_limits.py
│       │   └── prompts.py
│       ├── danny/              # Danny-specific
│       │   ├── AGENTS.md
│       │   ├── workflows.py
│       │   ├── tools.py        # registers Danny's tool subset with LLM
│       │   └── entrypoint.py   # `python -m app.agents.danny.entrypoint`
│       ├── negotiator/         # Negotiator-specific
│       │   ├── AGENTS.md
│       │   ├── workflows.py
│       │   ├── tools.py
│       │   ├── browser_use_session.py
│       │   └── entrypoint.py
│       └── (future agents follow same pattern)
└── deploy/
    ├── systemd/
    │   ├── api.service              # Backend VPS
    │   ├── orchestrator.service     # Backend VPS
    │   ├── danny-worker.service     # Danny VPS
    │   ├── negotiator-worker.service # Negotiator VPS
    │   └── (future)
    └── README.md
```

---

## 9. AGENT-SPECIFIC ENTRYPOINTS

Each agent has a thin entrypoint that wires the agent's persona, tools, and workflows into the shared runtime:

```python
# app/agents/danny/entrypoint.py
from app.agents.runtime.server import run_runtime
from app.agents.danny.tools import build_danny_tool_registry
from app.agents.danny.workflows import build_danny_workflow_router

if __name__ == "__main__":
    run_runtime(
        agent_id="danny",
        agents_md_path="/opt/danny-agent/AGENTS.md",
        tool_registry_builder=build_danny_tool_registry,
        workflow_router=build_danny_workflow_router(),
    )
```

```python
# app/agents/negotiator/entrypoint.py
from app.agents.runtime.server import run_runtime
from app.agents.negotiator.tools import build_negotiator_tool_registry
from app.agents.negotiator.workflows import build_negotiator_workflow_router
from app.agents.negotiator.browser_use_session import init_browser_use

if __name__ == "__main__":
    init_browser_use()
    run_runtime(
        agent_id="negotiator",
        agents_md_path="/opt/negotiator-agent/AGENTS.md",
        tool_registry_builder=build_negotiator_tool_registry,
        workflow_router=build_negotiator_workflow_router(),
    )
```

Future agents add a new subdirectory with the same pattern. No changes to the shared runtime library.

---

## 10. OBSERVABILITY INTEGRATION

Each worker integrates with Langfuse via the Python SDK. On task start:

```python
trace = langfuse.trace(
    id=task.task_id,
    name=task.task_type,
    tags=[
        f"agent:{config.AGENT_ID}",
        f"mode:{task.mode}",
        f"channel:{task.channel}",
        f"task_type:{task.task_type}",
        f"worker_vps:{config.VPS_HOSTNAME}",
        f"agent_version:{config.code_version}",
    ],
    metadata={...},
)
```

Each tool call, LLM call, and context preload is a span under the trace. Pattern matches Observability v3 spec §3.

---

## 11. DEPLOYMENT (SYSTEMD)

Each VPS provisioned with:

```bash
# Common setup (run on every agent VPS)
apt update && apt install -y python3.12 python3.12-venv git
useradd -r -s /bin/false vch-agent
mkdir -p /opt/vch-backend /opt/danny-agent /var/lib/vch-agent
chown -R vch-agent:vch-agent /opt/vch-backend /var/lib/vch-agent

# Clone backend repo (same repo on all VPSs)
cd /opt
git clone https://github.com/<org>/vch-backend.git
cd vch-backend
git checkout v5.0.0

# Python venv
python3.12 -m venv /opt/vch-backend/venv
source /opt/vch-backend/venv/bin/activate
pip install -r requirements.txt

# Place AGENTS.md for this VPS's agent
ln -s /opt/vch-backend/app/agents/danny/AGENTS.md /opt/danny-agent/AGENTS.md
# (or negotiator, etc. — depending on which agent this VPS serves)

# Place .env
cp /opt/vch-backend/deploy/dotenv-templates/danny.env.example /etc/vch-agent.env
# Fill in secrets per OQ-V5-02, OQ-V5-03, etc.
chmod 400 /etc/vch-agent.env

# Install systemd unit
cp /opt/vch-backend/deploy/systemd/danny-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable danny-worker
systemctl start danny-worker
```

Example systemd unit:

```ini
# /etc/systemd/system/danny-worker.service
[Unit]
Description=DannyAgent Python runtime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=vch-agent
Group=vch-agent
EnvironmentFile=/etc/vch-agent.env
WorkingDirectory=/opt/vch-backend
ExecStart=/opt/vch-backend/venv/bin/python -m app.agents.danny.entrypoint
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### 11.1 Deploy / Update Flow

```
1. Push new commit to vch-backend repo
2. CI runs eval suite + tests; passes
3. Git tag a release (e.g., v5.0.1)
4. For each agent VPS:
   a. MC sends POST /drain to worker
   b. Worker stops accepting new tasks; finishes in-flight
   c. Worker reports drained
   d. Deploy script: git pull, pip install -r, systemctl restart
   e. Worker comes up, registers heartbeat, version reported to MC
   f. MC removes drain flag
   g. Next worker VPS
```

Rolling deploy across the fleet — no global downtime.

---

## 12. SECURITY

- All inter-VPS communication over `vch-private-net` (Hetzner private network)
- `X-Service-Token` shared between MC and each worker — unique per worker
- `MC_WORKER_AUTH_TOKEN` verifies incoming MC→worker dispatches
- `MC_CALLBACK_AUTH_TOKEN` verifies worker→MC callbacks
- AGENTS.md SHA-256 verified at worker startup against expected hash in MC
- No public network exposure on worker VPSs (worker FastAPI bound to private IP only)
- Pin Python deps via `requirements.txt`; lockfile in repo

---

## 13. MISSION CONTROL OPENCLAW DISPATCHER (FORWARD REFERENCE)

OQ-V5-10 — how MC talks to the per-VPS OpenClaw CLIs — is unresolved. Two candidate approaches:

| Approach | Pros | Cons |
|---|---|---|
| **MC ↔ OpenClaw over HTTP API per VPS** | Cleaner architecture; can be over private network only; same auth pattern as worker runtime | Requires OpenClaw to expose an HTTP submission endpoint; needs verification |
| **MC ↔ OpenClaw via SSH dispatch** | Works regardless of OpenClaw's surface area; doesn't require modifying OpenClaw | SSH key management; harder to capture streaming output |

Decision deferred to Phase 7. Runtime spec is unaffected — OpenClaw dispatcher runs on a different path from worker task dispatch.

---

## 14. ACCEPTANCE CRITERIA

| # | Criteria |
|---|---|
| RT-01 | Worker process starts via `systemctl start <agent>-worker.service` |
| RT-02 | Worker registers heartbeat with MC within 30s of startup |
| RT-03 | `GET /health` returns 200 with current state |
| RT-04 | `GET /version` returns code + AGENTS.md SHA-256 |
| RT-05 | `POST /tasks` accepts valid task and queues it |
| RT-06 | `POST /tasks` rejects with 401 on missing `X-Service-Token` |
| RT-07 | `POST /tasks` rejects with 503 if drain mode active |
| RT-08 | `POST /tasks` rejects with 429 if queue depth ≥ `TASK_QUEUE_MAX` |
| RT-09 | Worker emits `in_progress` callback when task starts |
| RT-10 | Worker emits `completed/failed/hitl_created` callback when task ends |
| RT-11 | Worker handles 8 concurrent tasks without blocking new dispatch |
| RT-12 | Langfuse trace opened per task with correct tags |
| RT-13 | `POST /drain` stops accepting new tasks, allows in-flight to complete |
| RT-14 | Drain completion callback received by MC when in-flight = 0 |
| RT-15 | Worker reloads AGENTS.md only at startup (not per-task) |
| RT-16 | Tool subset gating: tool not in `allowed_tools` is unavailable to LLM |
| RT-17 | Untrusted content wrapping applied to all preloaded GHL conversation content |
| RT-18 | Memory writes to Graphiti use correct namespace per agent_id |
| RT-19 | Langfuse SDK redacts credentials per `LANGFUSE_REDACT_PATTERNS` |
| RT-20 | Worker survives MC unreachable for 5+ min (queue, retry callbacks) |

---

## 15. IMPLEMENTATION CHECKLIST

**Phase 3 (Runtime library + MC↔runtime contract) — see Fleet Plan v5 §7.3**

- [ ] Implement `app/agents/runtime/server.py` (FastAPI endpoints per §4)
- [ ] Implement `app/agents/runtime/worker.py` (asyncio worker pool per §3)
- [ ] Implement `app/agents/runtime/task_handler.py` (per-task lifecycle per §5)
- [ ] Implement `app/agents/runtime/context_loader.py`
- [ ] Implement `app/agents/runtime/tool_registry.py` (with subset gating)
- [ ] Implement `app/agents/runtime/llm_client.py` (OpenAI SDK wrapper with tier routing)
- [ ] Implement `app/agents/runtime/memory.py` (Tier 1 SQLite + Tier 2 Graphiti)
- [ ] Implement `app/agents/runtime/observability.py` (Langfuse SDK integration with redaction)
- [ ] Implement `app/agents/runtime/heartbeat.py`
- [ ] Implement `app/agents/runtime/drain.py`
- [ ] Implement `app/agents/runtime/config.py` (Pydantic settings per §6)
- [ ] Implement `app/agents/shared/ghl_mcp_client.py`
- [ ] Implement `app/agents/shared/marketcheck_mcp_client.py`
- [ ] Implement `app/agents/shared/backend_http_client.py`
- [ ] Implement `app/agents/shared/extraction.py` (per agent PRD §11)
- [ ] Implement `app/agents/shared/untrusted_content.py`
- [ ] Implement `app/agents/shared/rate_limits.py`
- [ ] Build MC task dispatcher (POST /tasks to worker URLs)
- [ ] Build MC callback receiver (`/api/orchestration/task-callback`)
- [ ] Build MC heartbeat receiver (`/api/orchestration/heartbeat`)
- [ ] Build MC drain coordinator
- [ ] Build MC fleet inventory UI (workers + health + version per VPS)
- [ ] Write systemd unit templates
- [ ] Write deploy script (drain + git pull + restart cycle)
- [ ] All RT-01 through RT-20 acceptance criteria verified on staging

Agent-specific entrypoints (Danny, Negotiator) come in Phases 5 and 6 of the Fleet Plan — they consume this shared runtime library.

---

## 16. APPENDIX A — TASK TYPES ACCEPTED BY THE RUNTIME

The runtime is agnostic to task type — the workflow router (provided by each agent's entrypoint) dispatches the task to the correct handler. The runtime only ensures:

1. Task has a valid `task_type` registered for this agent
2. `allowed_tools` is a non-empty list
3. `mode` matches one of the agent's supported modes
4. Required identifiers (`contact_id`, `deal_id`, etc.) are present per task_type schema

The list of task types per agent lives in:
- Danny: PRD v4 §8.1-§8.2 (buyer + admin task types) — still authoritative
- Negotiator: PRD v4 §8.1-§8.7 — still authoritative

---

## 17. APPENDIX B — WHAT WILL CHANGE WHEN A NEW SPECIALIST AGENT IS ADDED

For a future LogisticsAgent (illustrative):

1. New subdirectory: `vch-backend/app/agents/logistics/`
2. Files: `AGENTS.md`, `workflows.py`, `tools.py`, `entrypoint.py`
3. New entry in `agent_actions_service` for any logistics-specific writes
4. New Graphiti namespace `vch_logistics`
5. Provision new VPS, install codebase, place `.env`, install systemd unit
6. MC fleet inventory automatically picks up the new worker on heartbeat
7. Orchestrator gains routing for logistics-related tasks (transport milestones, carrier exceptions)

No runtime library changes needed.

---

**END OF RUNTIME SPEC v1**
