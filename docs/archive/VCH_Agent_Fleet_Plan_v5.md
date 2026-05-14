# VirtualCarHub Agent Fleet Plan — v5

**Version:** 5.0 | May 2026
**Supersedes:** Fleet Plan v4 (this is a meaningful architectural revision based on OpenClaw runtime correction and fleet-control-plane elevation)
**Status:** Approved for build

## 0. WHAT CHANGED FROM v4 AND WHY

v4 was built on three assumptions that turned out to be wrong:

1. **OpenClaw is a Python agent framework.** It isn't. OpenClaw is a Node CLI tool for ad-hoc AI assistance — useful as an operator-facing AI on each VPS, but not the production runtime.
2. **Mission Control's main job is task orchestration.** It is — but its larger role is **fleet control plane**, especially as the fleet grows beyond the initial two agents into specialized roles (Logistics, F&I, etc.).
3. **Each agent should be an independent codebase.** Not needed. One Python codebase deployed to multiple VPSs with different entry points solves the same problem with much less complexity.

v5 corrects all three. Architectural content (workflows, personas, tools, rate limits, untrusted-content handling, extraction patterns, HITL rules, eval suites, acceptance criteria) **carries forward unchanged** — that work is sound. What changes is the runtime layer and the deployment/topology spec.

If you previously read v4 documents, the **persona, workflow, and tool sections are fully reusable**. Only this Fleet Plan and the runtime-related sections of the agent PRDs are revised. The agent PRD v5 addenda explicitly list which v4 sections still apply and which are replaced.

---

## 1. EXECUTIVE SUMMARY

VirtualCarHub deploys a **two-agent fleet at launch** with **architectural headroom for 6-8 specialized agents** over time. Both initial agents run as Python services from a shared codebase, deployed as systemd processes on dedicated VPSs. A **fleet control plane** (Mission Control) coordinates task dispatch, version management, deployment, knowledge-graph operations, cost governance, and incident response across the fleet.

### 1.1 Agents at Launch

- **DannyAgent** — dual-mode (buyer-facing + admin-facing) conversational agent
- **NegotiatorAgent** — multi-channel pre-negotiator that produces strategy reports, conducts dealer outreach, pre-negotiates within bounds, and hands off ready deals to human closers

### 1.2 Future Specialized Agents (Architectural Headroom — Not in MVP Scope)

Designed for but not built at launch:

| Agent | Domain | Why a specialist |
|---|---|---|
| LogisticsAgent | Transport coordination, carrier ops, ETA management | Different toolset (carrier APIs), different SLAs, different escalation patterns |
| F&I Agent | RouteOne workflow, credit app coordination, lender routing | Complex compliance surface; very different from sales-facing agents |
| TitleClerkAgent | Title transfers, DMV interaction, registration | State-by-state knowledge, document handling |
| ComplianceAgent | OFAC, audit review, regulatory reporting | Read-only specialist with judgment |
| CustomerSuccessAgent | Post-delivery follow-up, return facilitation | Long-tail buyer relationship management |
| MarketingAgent | Lead-gen orchestration, campaign execution | Heavy GHL workflow integration |

Each future agent follows the same pattern: same codebase, different entry point, dedicated VPS, dedicated persona (`AGENTS.md`), dedicated tool set. Fleet control plane (MC) absorbs each new agent without architectural change.

### 1.3 Supporting Infrastructure

- **VCH Python/FastAPI backend** — deal state machine, matching engine, sourcing, audit, GHL integration. Hosts the new `agent_actions_service` (write policy layer), `orchestration` module (state router, stall detector, etc.), and the agent runtime library (`app/agents/`).
- **Mission Control** (forked from `builderz-labs/mission-control`) — fleet control plane UI. Deployed and running.
- **Two real MCPs** — GHL MCP (existing connection) and MarketCheck MCP (hosted). Reads only.
- **Langfuse** — agent observability, co-located on Mission Control VPS.
- **Graphiti + FalkorDB** — shared cross-agent behavioral knowledge graph. Co-located on Mission Control VPS. Connected to from Python via `graphiti-core` library.
- **OpenClaw CLI** — installed on each VPS as the operator's ad-hoc AI assistant. Not the production runtime. Coordinated through Mission Control's OpenClaw dispatcher UI.

---

## 2. THE RUNTIME — SHIFT FROM v4

### 2.1 What v4 Specified (Now Replaced)

v4 specified `pip install openclaw` + `python -m openclaw.runtime --config config.yaml`. That framework does not exist in Python.

### 2.2 What v5 Specifies

A custom Python agent runtime lives in `vch-backend/app/agents/`. Deployed to each agent VPS as a systemd service. Detailed specification: **`09_Runtime_Spec_v1.md`**.

Key shape:
- Python service (FastAPI-based) on each agent VPS
- HTTP endpoint receives task dispatch from Mission Control
- asyncio worker pool processes tasks concurrently (one fresh "context" per task, stateless across tasks)
- Each task: preload context (GHL + Graphiti), run LLM loop with OpenAI SDK, execute tool calls, write back to backend + GHL, exit, log to Langfuse
- Heartbeat back to MC every 15-30s
- Drain protocol for graceful shutdown during deploys

This matches the "spawn parallel subagents, all stateless, all context-aware via stored memories" model — each task is a fresh worker invocation that loads what it needs from durable stores.

### 2.3 OpenClaw CLI — Operator Tool, Not Production Runtime

OpenClaw CLI is installed on each VPS as the operator's AI assistant for ad-hoc work — debug a problem, run a one-off query, investigate logs, examine browser state. Three things to know:

1. **Separate from the production agent runtime.** OpenClaw doesn't serve buyers or dealers. It serves operators.
2. **Coordinated through Mission Control.** MC exposes a UI to send prompts to a specific VPS's OpenClaw CLI rather than SSH-ing into each one.
3. **Per-VPS scope.** Each VPS's OpenClaw has access only to that VPS's logs, processes, and local state. Not a fleet-wide privilege.

The shared YAML config schema from the shelved bootstrap doc (model tiers, heartbeat intervals, memory tiers, Langfuse redact patterns) is preserved as design input for the Python runtime spec, even though the OpenClaw framework that was supposed to consume it isn't real.

---

## 3. SYSTEM TOPOLOGY

```
                 ┌────────────────────────────────────────────────┐
                 │  MISSION CONTROL VPS (CPX41, existing)         │
                 │  Fleet Control Plane (Next.js, customized)     │
                 │  Co-located:                                   │
                 │    • Langfuse (agent traces)                   │
                 │    • Graphiti + FalkorDB (shared brain)        │
                 │    • Caddy + TLS                               │
                 │  + OpenClaw CLI (operator's ad-hoc AI)         │
                 └──────┬──────┬──────┬──────────────────┬────────┘
                        │      │      │                  │
            ┌───────────┘      │      └──────────────┐   │
            │                  │                     │   │
            ▼                  ▼                     ▼   ▼
   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
   │ BACKEND VPS      │ │ DANNY VPS        │ │ NEGOTIATOR VPS   │
   │ (existing)       │ │ (CPX31, new)     │ │ (CPX31, new)     │
   │                  │ │                  │ │                  │
   │ api.service      │ │ danny-worker.    │ │ negotiator-      │
   │ (FastAPI)        │ │   service        │ │   worker.service │
   │                  │ │ (Python runtime) │ │ (Python runtime) │
   │ orchestrator.    │ │                  │ │                  │
   │   service        │ │ Persona: dual    │ │ + Browser Use    │
   │ (state router,   │ │   mode (buyer +  │ │   (headless      │
   │  stall detector, │ │   admin)         │ │   Chrome)        │
   │  exception       │ │                  │ │                  │
   │  triage)         │ │ + OpenClaw CLI   │ │ + OpenClaw CLI   │
   │                  │ └──────────────────┘ └──────────────────┘
   │ Postgres:        │
   │  • Deals         │ ─────────────────────────────────────┐
   │  • Dealers       │ Future additions:                    │
   │  • Threads       │   • Logistics VPS  → logistics-worker│
   │  • Strategy      │   • F&I VPS        → fni-worker      │
   │    Reports       │   • Title VPS      → title-worker    │
   │  • Audit         │ (Each follows same pattern)          │
   │  • Custom Fields │ ─────────────────────────────────────┘
   │                  │
   │ + OpenClaw CLI   │
   └──────────────────┘

         All VPSs on the existing private Hetzner network (vch-private-net).
         Single Python codebase (vch-backend) deployed with different entry
         points per VPS. Future agent VPSs follow the same pattern.
```

### 3.1 What Each VPS Runs

| VPS | Primary service | Secondary services | OpenClaw CLI |
|---|---|---|---|
| Mission Control | Next.js (MC admin UI) | Langfuse, Graphiti+FalkorDB | Yes — fleet-wide operator |
| Backend | FastAPI api.service | orchestrator.service, audit, deal state machine | Yes — backend operator |
| Danny | danny-worker.service (Python) | — | Yes — Danny VPS operator |
| Negotiator | negotiator-worker.service (Python) | Headless Chrome (Browser Use) | Yes — Negotiator VPS operator |
| *(Future)* Logistics | logistics-worker.service (Python) | — | Yes |
| *(Future)* F&I | fni-worker.service (Python) | — | Yes |

### 3.2 Deployment Inventory

| Component | Status | Hetzner Tier | Approx. Cost/mo |
|---|---|---|---|
| Mission Control VPS | **Existing** | CPX41 | ~$30 |
| Backend VPS | **Existing** | (existing) | (existing) |
| Danny VPS | **Existing (provisioned)** | CPX31 | $15 |
| Negotiator VPS | **Existing (provisioned)** | CPX31 | $15 |
| *(Future)* Logistics, F&I, Title, etc. | Per-agent provisioning | CPX31 each | $15 each |

**Total new infra at MVP (this plan):** $30/month for two agent VPSs.

### 3.3 Mission Control as Fleet Control Plane

MC is no longer "the orchestration system that talks to agents." Orchestration logic moved into the backend (`orchestrator.service` from the shared codebase). MC's revised job is the **fleet control plane** — the human-facing UI that coordinates and manages the fleet.

Distinct responsibilities (none of these are covered by GHL, Langfuse, or Grafana):

| Function | Description |
|---|---|
| **Fleet inventory** | Live view of all agent workers — health, current load, version, available capacity |
| **OpenClaw dispatcher** | Send ad-hoc operator AI prompts to any VPS's OpenClaw CLI from one UI. Replaces "SSH into each VPS." |
| **Deploy / version management** | Track which AGENTS.md version on which VPS. Roll out new persona versions, roll back |
| **Graphiti management** | View, edit, and purge episodic memory in the shared knowledge graph |
| **Cost governance with action** | Not just view spending — act on it: switch a task type's model tier, throttle a worker's outbound, disable a costly tool |
| **Incident response** | Pause all outbound, drain a specific worker, switch to fallback mode, coordinated controls during outage |
| **Eval orchestration** | Trigger eval runs, compare two persona versions head-to-head, view trend lines |
| **Cross-agent audit / compliance** | Aggregate audit views across the fleet — what each agent did across deals over a period |

What MC explicitly does **not** show (use the right tool):
- Customer/deal data → GHL
- LLM reasoning chains → Langfuse (link out from MC task views)
- Infrastructure metrics → Grafana (link out from MC)
- Conversation history → GHL
- HITL human tasks → GHL tasks

MC is the **fleet/operations** view. GHL is the **customer/deal** view. Langfuse is the **agent reasoning** view. Grafana is the **infrastructure** view. Four tools, four distinct slices, minimal duplication.

---

## 4. ENTRY POINTS & MODE DETERMINATION

Unchanged from v4. Listed here for completeness.

| Entry Point | Default Mode | Auth | Handler |
|---|---|---|---|
| Website widget (`danny.virtualcarhub.com`) | Buyer | JWT (15-min TTL) | MC widget service |
| GHL inbound (chat/SMS/email/DM) | Buyer | GHL contact ID | GHL webhook → orchestrator |
| Public Twilio # (Phase 2) | Buyer | Caller ID | orchestrator |
| Telegram admin bot | Admin (Tier 2) | Telegram user ID allowlist | orchestrator |
| Admin Twilio # | Admin (Tier 2 after PIN) | CID allowlist + bcrypt PIN | orchestrator |
| Mission Control internal | Admin (Tier 2) | MC user session | MC → orchestrator |

Mode determination happens in the backend's `orchestrator` module. Workers receive tasks with mode/auth already determined.

---

## 5. VCH BACKEND ADDITIONS

### 5.1 New Code Modules in vch-backend

```
vch-backend/
├── app/
│   ├── api/                         (existing)
│   ├── services/
│   │   ├── audit_service.py         (existing — canonical audit)
│   │   ├── agent_actions_service.py (NEW — write policy layer)
│   │   ├── dealer_service.py        (NEW — dealer DB operations)
│   │   ├── strategy_report_service.py (NEW)
│   │   └── ... (existing services)
│   ├── models/
│   │   ├── dealer.py                (NEW)
│   │   ├── dealer_thread.py         (NEW)
│   │   ├── intent_thread.py         (NEW)
│   │   ├── strategy_report.py       (NEW)
│   │   └── ... (existing models)
│   ├── orchestration/               (NEW MODULE — runs as orchestrator.service)
│   │   ├── state_router.py          (GHL state changes → agent task dispatch)
│   │   ├── stall_detector.py        (cron, 5-min SLA breach detection)
│   │   ├── health_monitor.py        (cron, 60s, agent online check)
│   │   ├── exception_triage.py      (HITL escalation routing)
│   │   ├── cancellation_router.py   (stage-aware refund/unwind logic)
│   │   ├── webhook_handlers.py      (GHL, RouteOne, Montway, Telegram, Twilio)
│   │   └── widget_service.py        (JWT issuer + WS bridge)
│   └── agents/                      (NEW MODULE — Python runtime library)
│       ├── runtime/                 (see Runtime Spec v1)
│       │   ├── worker.py            (worker process entry point)
│       │   ├── task_handler.py      (per-task lifecycle)
│       │   ├── context_loader.py    (preload from GHL/Graphiti)
│       │   ├── tool_registry.py     (tool subset gating)
│       │   ├── llm_client.py        (OpenAI wrapper)
│       │   ├── memory.py            (Tier 1 SQLite + Tier 2 Graphiti)
│       │   └── observability.py     (Langfuse integration)
│       ├── danny/
│       │   ├── AGENTS.md            (persona — from Danny PRD v4 §3)
│       │   ├── workflows.py
│       │   ├── tools.py
│       │   └── entrypoint.py        (deployed as danny-worker.service)
│       ├── negotiator/
│       │   ├── AGENTS.md            (persona — from Negotiator PRD v4 §3)
│       │   ├── workflows.py
│       │   ├── tools.py
│       │   ├── browser_use_session.py
│       │   └── entrypoint.py        (deployed as negotiator-worker.service)
│       └── shared/                  (shared across all current and future agents)
│           ├── ghl_mcp_client.py
│           ├── marketcheck_mcp_client.py
│           ├── backend_http_client.py
│           ├── extraction.py
│           ├── untrusted_content.py
│           └── rate_limits.py
```

This structure scales cleanly to future agents — each new specialist gets its own subdirectory under `agents/` with its own AGENTS.md, workflows, tools, and entrypoint, all importing the shared runtime and shared utilities.

### 5.2 `agent_actions_service` (Policy Layer for Writes)

Path: `vch-backend/app/services/agent_actions_service.py`
HTTP routes: `/v1/agent-actions/*`
Auth: `X-Service-Token`

Function: single enforcement layer for every agent write. Wraps existing `GHLClient`, calls existing `audit_service.log_event` on every write, enforces field allowlists, topic-aware rate limits via `intent_thread_id` (Danny) and `deal_thread_id` (Negotiator), loop detection, mode/tier authorization.

Endpoints unchanged from v4 §5.1. See v4 Fleet Plan §5.1 for the full list.

### 5.3 New Tables

Alembic migration adds:

- `Dealer`, `DealerContact`, `DealerGroup` — dealer database
- `StrategyReport` — Negotiator's vehicle-specific strategy reports
- `IntentThread` — Danny's topic-aware outreach state
- `DealerThread` — Negotiator's per-(dealer, VIN) thread state
- `OutboundLog` — message-level outbound audit
- `AgentVersion` (NEW for v5) — tracks which AGENTS.md / persona version is deployed on which VPS
- `WorkerHealth` (NEW for v5) — heartbeat and health metrics from each agent worker
- `OpenClawDispatchLog` (NEW for v5) — record of operator OpenClaw prompts dispatched via MC

Field-level details in v4 Fleet Plan §5.1-5.2 (unchanged) and Runtime Spec v1 (for the new v5 tables).

---

## 6. AGENT TOOLING — REAL SERVICES ONLY (UNCHANGED FROM v4)

The tool surfaces are exactly as v4 specified:

| Service | How agents connect | Read or Write |
|---|---|---|
| GHL MCP | Hosted plugin via `services.leadconnectorhq.com/mcp/` | **Reads only** |
| MarketCheck MCP | Hosted | **Reads/data only** |
| VCH backend `/v1/*` (existing endpoints) | HTTP, `X-Service-Token` | Read |
| VCH backend `/v1/agent-actions/*` | HTTP, `X-Service-Token` | **All writes** |
| VCH backend `/v1/dealers/*` | HTTP, `X-Service-Token` | Reads + Negotiator contact writes |
| Browser Use library | In-process on Negotiator VPS | Browser automation |

Tool registration with the LLM uses OpenAI function calling. Subset gating enforced at two layers: agent runtime (registers only allowed subset) + backend endpoints (independently verify). Identical to v4 §6 and §7.

---

## 7. INFRASTRUCTURE & DEPLOYMENT

### 7.1 Hetzner — Current State

```
hcloud server list
# All four VPSs already exist on vch-private-net:
#   vch-mission-control   (CPX41)
#   vch-backend           (existing — sizing in your infra)
#   vch-agent-danny       (CPX31)
#   vch-agent-negotiator  (CPX31)
```

No new VPS provisioning needed for MVP.

### 7.2 Domain Setup (unchanged from v4)

| Domain | Points To | Purpose |
|---|---|---|
| `app.virtualcarhub.com` | Public website | Buyer-facing site |
| `api.virtualcarhub.com` | Backend VPS | Backend API |
| `mc.virtualcarhub.com` | MC VPS | Fleet control plane UI |
| `traces.virtualcarhub.com` | MC VPS (Langfuse) | Observability |
| `danny.virtualcarhub.com` | MC VPS (widget service) | Buyer chat widget |

### 7.3 Revised Deployment Phases

| Phase | Scope | Duration |
|---|---|---|
| **1. Backend additions** | `agent_actions_service`, dealer DB tables + Alembic migration, dealer DB import script, new v5 tables | 1 week |
| **2. Orchestration module** | `app/orchestration/` — state router, stall detector, health monitor, exception triage, cancellation router. Deployed as `orchestrator.service` on backend VPS | 1 week |
| **3. Runtime library + MC↔runtime contract** | `app/agents/runtime/` — see Runtime Spec v1. Update Mission Control to dispatch tasks to worker HTTP endpoints + render fleet inventory. | 1.5 weeks |
| **4. Admin entry points + widget** | Telegram handler, Twilio admin handler, widget service, JWT issuer, allowlist management | 4 days |
| **5. Danny worker deployment** | `app/agents/danny/` — persona, workflows, tools. Deploy to Danny VPS as systemd service. Validate end-to-end. | 1.5 weeks |
| **6. Negotiator worker deployment** | `app/agents/negotiator/` — persona, workflows, tools, Browser Use. Deploy to Negotiator VPS. Validate. | 1.5 weeks |
| **7. MC fleet console features** | OpenClaw dispatcher UI, deploy/version management UI, Graphiti management UI, cost governance | 2 weeks |
| **8. End-to-end staging test** | Full deal cycle + admin-mode scenarios + Negotiator outreach test | 4 days |
| **9. Production cutover** | DNS, first real lead, first real admin command | 1 day |

**Total: ~9.5 weeks** from Phase 1 start to production.

Phase 7 (MC fleet console expansion) can run in parallel with Phases 5 and 6 if you split the work across agents.

### 7.4 Deployment Pattern — One Codebase, Multiple Targets

```
# Each VPS clones vch-backend repo, checks out the same release tag.
git clone https://github.com/<org>/vch-backend.git
cd vch-backend
git checkout v5.0.0
pip install -r requirements.txt

# Different systemd unit per VPS role:
#   On Backend VPS:    api.service + orchestrator.service
#   On Danny VPS:      danny-worker.service
#   On Negotiator VPS: negotiator-worker.service
#   On MC VPS:         (no Python worker; MC runs Next.js + Langfuse + Graphiti)
```

Future specialist agents add a new entrypoint and a new systemd unit to the same codebase — no separate repo.

---

## 8. OBSERVABILITY (REFERENCE)

Full spec in `08_Observability_Architecture_v3.md`. Summary:

- Langfuse already deployed at `traces.virtualcarhub.com`
- Every agent task = one root trace
- Tags: `agent:danny|negotiator|...`, `mode:buyer|admin|wholesale`, `channel:*`, `admin_auth_tier:1|2`, `intent_thread_id:*`, `worker_vps:*`, `agent_version:*`
- MC fleet console surfaces "View Trace" button via `langfuse_trace_id`
- Dashboards: Fleet Health, Buyer-mode, Admin-mode, Wholesale-mode, Rate Limits, Extraction Calibration, Cost
- Tier-2 admin actions audit-logged with full detail; alert on each
- Existing Prometheus + Loki + Grafana stack handles backend infra observability (separate from Langfuse, complementary)

---

## 9. SECURITY & COMPLIANCE (UNCHANGED FROM v4)

All v4 §9 provisions carry forward. Summary:

- HMAC verification on all webhook endpoints
- Agent ↔ MC over private network only
- Buyer PII inside VCH backend + GHL only
- Existing `audit_service.log_event()` is canonical audit
- GHL contact notes are narrative trail
- Untrusted-content wrapping (all inbound content wrapped in fenced tags before reaching prompts)
- Admin-mode dual-channel auth (Telegram + Twilio with CID + bcrypt PIN)
- Tier-2 admin actions require Tier-2 auth
- Widget JWT 15-min TTL; revocation polling every 60s
- No agent has direct access to financial credentials, RouteOne tokens, payment data
- OFAC screening at QUALIFIED state via existing automation

**New for v5 — OpenClaw CLI security:**
- Per-VPS scope (each VPS's OpenClaw has access only to that VPS)
- Dispatcher in MC authenticates operator via existing MC session auth
- OpenClaw prompts logged to `OpenClawDispatchLog`
- OpenClaw cannot access financial credentials, payment data, or sensitive PII

---

## 10. OPEN QUESTIONS

| # | Question | Owner | Required By |
|---|---|---|---|
| OQ-V5-01 | Format and size of Joe's existing dealer databases for import script (carried over from OQ-V4-01) | Joe | Phase 1 |
| OQ-V5-02 | Initial Telegram admin allowlist | Joe | Phase 4 |
| OQ-V5-03 | Initial Twilio admin allowlist + PIN seed | Joe | Phase 4 |
| OQ-V5-04 | STT provider for admin voice (Whisper, Twilio VI, Deepgram) | Joe + Eng | Phase 4 |
| OQ-V5-05 | TTS voice for admin voice (Polly, ElevenLabs) | Joe | Phase 4 |
| OQ-V5-06 | Negotiator strategy-report HITL out-of-bounds threshold (dollar or %) | Joe | Phase 6 |
| OQ-V5-07 | Phase 2 voice provider | Joe + Eng | Phase 2 build |
| OQ-V5-08 | Worker pool sizing per VPS (start with 8 concurrent workers per VPS — tune from there?) | Eng | Phase 3 |
| OQ-V5-09 | Browser Use vs. Lux (OAGI) revisit at scale | Eng | Phase 5 retrospective |
| OQ-V5-10 | Mission Control OpenClaw dispatcher — over HTTP API to each VPS's OpenClaw, or SSH-based dispatch? | Eng | Phase 7 |

---

## 11. APPENDIX A — DEAL STATE MACHINE (UNCHANGED FROM v4)

```
LEAD → PRE_QUALIFYING → QUALIFIED → ENGAGED → PROFILED → MATCHING
  → VEHICLE_SELECTED → FUNDING → ACQUISITION_PENDING → ACQUIRED
  → IN_TRANSIT → DELIVERED → CLOSED_WON

Side branches:
  any → DISQUALIFIED (PRE_QUALIFYING, QUALIFIED only)
  any → EXCEPTION
  any → CLOSED_LOST (cancellation)
  DELIVERED → RETURN_PENDING → CLOSED_LOST | CLOSED_WON
```

State transitions are owned by VCH backend (`deal_service.transition_deal_state`). Orchestrator reads transitions and dispatches; never modifies state directly. Cancellation router calls backend state machine API.

---

## 12. APPENDIX B — ROLE MATRIX

| Component | Owns Deal State? | Owns Tasks? | Talks to Buyers? | Talks to Dealers? | Talks to Admins? |
|---|---|---|---|---|---|
| GHL CRM | Reflects | Owns HITL tasks | Yes (templated workflows) | Yes (dealer Contact records) | No |
| VCH Backend | **Owns state** | No | No | No | No |
| Backend orchestrator | No (reads state) | **Owns agent tasks** | No (mediates widget) | No | No (mediates) |
| Mission Control | No (reads) | No (reads, dispatches commands) | No | No | **Yes (admin UI)** |
| DannyAgent (buyer) | No | Consumes | **Yes** | No | No |
| DannyAgent (admin) | No | Consumes + dispatches | No | No | **Yes** |
| NegotiatorAgent | No | Consumes | No | **Yes** | No |
| Website | Reflects state | No | Yes (UI surfaces) | No | No |
| OpenClaw CLI on each VPS | No | No | No | No | **Yes (ad-hoc operator)** |

---

## 13. APPENDIX C — MIGRATION FROM v4 DOCS

For teams that began against v4 PRDs:

1. **Archive (do not delete):** v4 documents → `docs/archive/v4/`
2. **Authoritative going forward:** v5 documents (Fleet Plan v5, agent PRD v5 addenda, Runtime Spec v1, Observability v3)
3. **What's still valid from v4 PRDs:** persona blocks (Danny §3, Negotiator §3), all workflows, tool surfaces (read/write distinction), tool subset gating concept, untrusted content rules, rate-limit design, extraction confidence model, HITL escalation matrix, eval suites, acceptance criteria for behavior
4. **What's superseded by v5:** §2 (OpenClaw runtime config) in both PRDs → see Runtime Spec v1. Implementation checklist Phase A/B in both PRDs → see Runtime Spec v1 §11. Fleet Plan v4 § §4 + §7 → see Fleet Plan v5 §3 + §7.

---

**END OF FLEET PLAN v5**
