# NegotiatorAgent — v5 Addendum to PRD v4

**Version:** v5 Addendum | May 2026
**Companion docs:** `VCH_Agent_Fleet_Plan_v5.md`, `09_Runtime_Spec_v1.md`, `02_NegotiatorAgent_PRD_v4.md` (still active for unchanged sections)
**Status:** Approved for build

This addendum applies the v5 architectural correction (Python custom runtime, MC fleet control plane) to the NegotiatorAgent PRD. **It does not re-emit unchanged content** — those sections of v4 remain authoritative.

---

## 1. WHAT'S STILL ACTIVE IN v4 (USE THESE SECTIONS AS-IS)

All of the following sections from `02_NegotiatorAgent_PRD_v4.md` carry forward unchanged:

| v4 Section | Content | Status |
|---|---|---|
| §1 | Purpose & scope, hard limits, "pre-negotiator" framing | **Active** |
| §3 | Agent persona & system prompt (AGENTS.md content) | **Active** |
| §3.2 | Visual identity (no buyer-facing identity) | **Active** |
| §4 | The negotiation strategy report (full structure, markdown companion, storage, trigger) | **Active** |
| §5 | Tools registered with the LLM (full bundle) | **Active** |
| §6 | Tool subset gating | **Active** |
| §7 | Dealer database integration (read/write patterns, stub creation, Graphiti behavioral intel, initial population) | **Active** |
| §8 | All core workflows (strategy report, initial outreach, decision-maker discovery, chat widget via Browser Use, respond to dealer inbound, voice handoff, handoff to human closer) | **Active** |
| §9 | Rate limits — dealer correspondence (per-thread limits, per-dealer ceiling, global ceiling, mass-outreach forbidden, loop detector, implementation) | **Active** |
| §10 | Untrusted content isolation (sources, wrapping, tool routing, output validation) | **Active** |
| §11 | HITL escalations (HITL-N01 through HITL-N12) | **Active** |
| §12 | Evaluation suite | **Active** |
| §15 | Capability rollout plan (N1-N6) | **Active** |
| §17, §18, §19 | Sample strategy report, dealer outreach email, chat widget disclosure | **Active** |

---

## 2. WHAT'S REPLACED (V4 SECTIONS NO LONGER VALID)

| v4 Section | What it was | Why replaced |
|---|---|---|
| §2 (entire section) | "OpenClaw instance configuration" — gateway, model tiers, heartbeat, memory, Browser Use config, Langfuse | OpenClaw is not a Python framework. See Runtime Spec v1 and §3 of this addendum. |
| §13 | Dependencies | Updated in §5 of this addendum |
| §14 | Acceptance criteria (AC-N01 through AC-N21) | Wording updated. List in §6 of this addendum. |
| §16 | Implementation checklist (Phases A through J) | Phase A and B replaced; C through J carry forward with adjusted file references |

---

## 3. RUNTIME CONFIGURATION (REPLACES v4 §2)

NegotiatorAgent runs as the `negotiator-worker.service` systemd service on the Negotiator VPS. The service runs `python -m app.agents.negotiator.entrypoint` from the shared `vch-backend` codebase. Configuration in `/etc/vch-agent.env`.

### 3.1 Negotiator-Specific .env Values

```bash
AGENT_ID=negotiator
VPS_HOSTNAME=vch-agent-negotiator
WORKER_POOL_SIZE=6                      # Lower than Danny — Browser Use sessions are heavier
HEARTBEAT_INTERVAL_SECONDS=30           # Slower than Danny — accommodates browser session pauses
HEARTBEAT_MISSING_TOLERANCE_SECONDS=300  # 5 min — Browser Use can briefly stall
GRAPHITI_NAMESPACE=vch_wholesale        # Constant — Negotiator only writes to wholesale namespace

# Browser Use (Negotiator-specific)
BROWSER_USE_ENABLED=true
BROWSER_USE_USER_DATA_DIR=/opt/negotiator-agent/browser_profiles
BROWSER_USE_HEADLESS=true
BROWSER_USE_VIEWPORT_WIDTH=1280
BROWSER_USE_VIEWPORT_HEIGHT=800
BROWSER_SESSION_MAX_MINUTES=15
BROWSER_SESSION_MAX_TURNS=10
```

### 3.2 Constant Mode Tagging

Unlike Danny (which determines mode at task ingestion), Negotiator always operates in `mode='wholesale'`. The runtime's task_handler enforces this — any inbound task with a different mode value is rejected with 400.

### 3.3 Hard Namespace Restriction

Negotiator's memory layer can read/write only `vch_wholesale` in Graphiti. Attempts to query `vch_buyer` or `vch_admin` are rejected at the memory client layer. This is **structurally enforced**, not just policy — the Graphiti client in this worker is initialized with a namespace whitelist of `["vch_wholesale"]`.

### 3.4 AGENTS.md Deployment

The Negotiator persona file (v4 §3) is deployed to `/opt/negotiator-agent/AGENTS.md`, typically symlinked from `/opt/vch-backend/app/agents/negotiator/AGENTS.md`.

### 3.5 Browser Use Integration

Browser Use is initialized at worker startup via `app/agents/negotiator/browser_use_session.py`. Configuration per §3.1 above. Sessions are created on-demand per task — each `browser_chat_widget_session` tool call creates a fresh headless Chrome context inside the worker process.

Memory and CPU implications: each browser session can consume 200-400MB of RAM. With `WORKER_POOL_SIZE=6` and 1-2 concurrent browser sessions per worker, this fits within the CPX31's 8GB RAM with headroom.

### 3.6 Task Type Registration

Worker accepts task types from v4 §8 (also enumerated in v4 §6.1 by allowlist): `generate_strategy_report`, `initial_dealer_outreach`, `respond_to_dealer_inbound`, `discover_decision_maker`, `dealer_chat_outreach`, `dispatch_voice_call`, `negotiate_within_bounds`, `handoff_to_human_closer`. The workflow router in `app/agents/negotiator/workflows.py` dispatches each to its handler.

### 3.7 Worker Pool Behavior

6 concurrent worker coroutines on one VPS. Negotiator tasks are longer-running than Danny's (strategy report generation: ~60-90s; chat widget session: 5-15 min) but vastly less frequent. At any moment, only a handful of deals out of hundreds in-flight are actively being processed.

Most deals are idle:
- Awaiting dealer response (cooldown enforced by rate limits)
- Awaiting human closer (after handoff)
- Awaiting SourcingSupervisor review (HITL escalation)

Per `DealerThread` state in backend Postgres, the orchestrator knows which deals are eligible to resume processing and dispatches tasks accordingly.

Horizontal scaling: add a second Negotiator VPS when one is consistently above 70% capacity. Sticky routing per `dealer_id` to keep dealer conversations on the same worker is helpful but not required.

---

## 4. INVOLVED FILES IN THE SHARED CODEBASE

```
vch-backend/app/agents/negotiator/
├── AGENTS.md                  (persona — from v4 §3)
├── entrypoint.py              (deployed as negotiator-worker.service)
├── workflows.py               (workflow handlers for all 7 task types in v4 §8)
├── tools.py                   (registers Negotiator's tool subset from v4 §5)
└── browser_use_session.py     (Browser Use wrapper for chat widgets)
```

Plus shared utilities and runtime library.

---

## 5. DEPENDENCIES (REPLACES v4 §13)

| Dependency | Status | Required Before |
|---|---|---|
| Mission Control + Langfuse + Graphiti deployed | ✅ Existing | All |
| VCH FastAPI backend with existing `/v1/*` endpoints | ✅ Existing | All |
| Backend `agent_actions_service` with dealer outreach endpoints | New | Phase 6 |
| Backend `Dealer` / `DealerContact` / `DealerGroup` tables | New | Phase 6 |
| Backend `StrategyReport` table + endpoints | New | Phase 6 |
| Backend `DealerThread` / `OutboundLog` tables | New | Phase 6 |
| Backend orchestration module deployed | New | Phase 6 |
| Agent runtime library | New | Phase 6 |
| Shared utilities | New | Phase 6 |
| Negotiator-specific code | New | Phase 6 |
| `vch-agent` user on Negotiator VPS | New | Phase 6 |
| `/etc/vch-agent.env` on Negotiator VPS, populated | New | Phase 6 |
| `negotiator-worker.service` systemd unit | New | Phase 6 |
| Browser Use library (`pip install browser-use`) | New (in requirements.txt) | Phase 6 |
| Headless Chromium on Negotiator VPS | New | Phase 6 |
| GHL MCP plugin connectivity | ✅ Existing | All |
| MarketCheck MCP API key | ✅ Existing | All |
| OpenAI API key (gpt-5.4 family) | ✅ Existing | All |
| Existing Telnyx voice agents (Phase 1 voice handoff) | ✅ Existing | All |
| Initial dealer DB data | OQ-V5-01 | Phase 6 |
| Strategy-report HITL out-of-bounds threshold | OQ-V5-06 | Phase 6 |

---

## 6. ACCEPTANCE CRITERIA (REPLACES v4 §14)

Wording updated to reference Python runtime. Behavioral substance unchanged.

| # | Criteria |
|---|---|
| AC-N01 | `negotiator-worker.service` registers heartbeat with MC within 30s of `systemctl start` |
| AC-N02 | `generate_strategy_report` task produces JSON + GHL note + SourcingSupervisor task within 90s of `ACQUISITION_PENDING` |
| AC-N03 | Strategy report references real MarketCheck comparables and dealer DB intelligence |
| AC-N04 | Strategy report walk-away threshold respected — out-of-bounds counter creates HITL-N02 |
| AC-N05 | Initial dealer outreach never exposes acquisition target |
| AC-N06 | Dealer thread state machine: 4th attempt blocked, HITL-N04 created |
| AC-N07 | Per-dealer 24h ceiling (5 msgs) enforced server-side |
| AC-N08 | Global 24h ceiling (200 msgs) enforced server-side |
| AC-N09 | All actions logged via backend `audit_service.log_event` |
| AC-N10 | Langfuse trace tagged `mode:wholesale` constant |
| AC-N11 | Agent refuses general-assistant / admin-style requests (10 test cases; 100% refusal) |
| AC-N12 | Prompt injection in dealer reply has no effect (50 patterns; 100% pass) |
| AC-N13 | Tool subset gating: task without `send-dealer-sms` cannot send SMS |
| AC-N14 | Backend agent-actions policy: rate limit enforced server-side independent of agent |
| AC-N15 | Browser Use chat widget session: 100% disclosure of AI nature on first message |
| AC-N16 | Browser Use session: 15-min hard timeout enforced |
| AC-N17 | Decision-maker discovery: captured contact persisted to `DealerContact` |
| AC-N18 | Voice task created via GHL task with full briefing payload |
| AC-N19 | Handoff-to-human task includes complete transcript and recommended close action |
| AC-N20 | Tier-2 memory writes queryable in Graphiti `vch_wholesale` namespace |
| AC-N21 | Dealer DB stub auto-created when working unfamiliar dealer (`source='marketcheck_stub'`) |
| AC-N22 | Negotiator memory layer rejects queries to `vch_buyer` or `vch_admin` namespaces |
| AC-N23 | Worker handles ≥6 concurrent Negotiator tasks (including ≥2 Browser Use sessions) without queue blocking |
| AC-N24 | Worker survives MC unreachable for 5+ min (queue, retry callbacks) |
| AC-N25 | Browser session memory footprint stays under 500MB per session |

---

## 7. IMPLEMENTATION CHECKLIST (REPLACES v4 §16 PHASES A AND B)

Phases C through J from v4 §16 carry forward with adjusted file/path references.

**Phase A (REPLACES v4 §16 Phase A) — Negotiator VPS provisioning**
- [ ] Confirm `vch-agent-negotiator` exists on Hetzner, joined to `vch-private-net` (existing)
- [ ] `vch-agent` system user created
- [ ] Install python3.12, git, ufw, headless Chromium (for Browser Use)
- [ ] UFW: deny inbound public, allow private network ingress on worker port
- [ ] Install OpenClaw CLI on the VPS (per OpenClaw README)
- [ ] Place `/etc/vch-agent.env` with Negotiator-specific values per §3.1

**Phase B (REPLACES v4 §16 Phase B) — Codebase deploy**
- [ ] Clone `vch-backend` repo to `/opt/vch-backend`
- [ ] Checkout target release tag
- [ ] Create Python venv at `/opt/vch-backend/venv`
- [ ] `pip install -r requirements.txt` (includes `browser-use`)
- [ ] Symlink `/opt/negotiator-agent/AGENTS.md` → `/opt/vch-backend/app/agents/negotiator/AGENTS.md`
- [ ] Create `/opt/negotiator-agent/browser_profiles/` directory (writable by `vch-agent`)
- [ ] Install `/etc/systemd/system/negotiator-worker.service` unit
- [ ] `systemctl daemon-reload && systemctl enable negotiator-worker && systemctl start negotiator-worker`
- [ ] Verify heartbeat in MC dashboard within 30s
- [ ] Verify `GET /health` returns 200
- [ ] Verify `GET /version` reports correct SHA-256 of AGENTS.md
- [ ] Verify Browser Use can launch a test session (`python -m app.agents.negotiator.browser_use_session --test`)

**Phase C through J** — see v4 §16 Phases C through J. Adjust file paths analogously to Danny PRD v5 addendum §7:
- "Configure GHL MCP" → `app/agents/shared/ghl_mcp_client.py`
- "Configure MarketCheck MCP" → `app/agents/shared/marketcheck_mcp_client.py`
- "Configure VCH backend HTTP" → `app/agents/shared/backend_http_client.py`
- "Browser Use integration with appropriate LLM provider" → `app/agents/negotiator/browser_use_session.py`
- "Generate strategy report workflow" → `app/agents/negotiator/workflows.py`
- "Initial dealer outreach workflow" → same file
- "Dealer chat outreach via Browser Use" → same file, calling browser_use_session
- "Respond to dealer inbound" → same file
- "Dispatch voice call (Phase 1 interim)" → same file
- "Handoff to human closer" → same file
- "Untrusted content wrapping" → `app/agents/shared/untrusted_content.py`
- "OpenAI function calling" → `app/agents/runtime/llm_client.py`
- "Dealer thread state machine in agent_actions_service" → `app/services/agent_actions_service.py` (backend, NOT on Negotiator VPS)
- "Loop detector" → in agent_actions_service
- "Test against 5 different dealer chat widget types" → testing checklist
- "Voice handoff: define GHL task format" → orchestration module on backend VPS
- "Eval datasets per §12" → unchanged
- "AC-N01 through AC-N25" → use revised list in §6 of this addendum

---

## 8. WHAT YOU CAN IGNORE FROM v4

When reading v4 PRD, treat the following as **stale / replaced**:

- §2 in its entirety (YAML config, OpenClaw memory tier syntax, browser_use config sub-block)
- Any references to `pip install openclaw` or `python -m openclaw.runtime`
- The implementation checklist Phase A and B (use this addendum's §7)
- The dependencies table (use this addendum's §5)
- The acceptance criteria table (use this addendum's §6)

Everything else in v4 — and especially §3 (persona), §4 (strategy report), §7 (dealer DB integration), §8 (workflows), §9 (rate limits) — is authoritative and implemented as written.

---

**END OF NEGOTIATOR PRD v5 ADDENDUM**
