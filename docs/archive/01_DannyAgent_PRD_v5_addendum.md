# DannyAgent — v5 Addendum to PRD v4

**Version:** v5 Addendum | May 2026
**Companion docs:** `VCH_Agent_Fleet_Plan_v5.md`, `09_Runtime_Spec_v1.md`, `01_DannyAgent_PRD_v4.md` (still active for unchanged sections)
**Status:** Approved for build

This addendum applies the v5 architectural correction (Python custom runtime, MC fleet control plane) to the DannyAgent PRD. **It does not re-emit unchanged content** — those sections of v4 remain authoritative. This document explicitly lists what's replaced, what's still active in v4, and any modifications to acceptance criteria.

---

## 1. WHAT'S STILL ACTIVE IN v4 (USE THESE SECTIONS AS-IS)

All of the following sections from `01_DannyAgent_PRD_v4.md` carry forward unchanged. Coding agents and reviewers should read v4 for the authoritative content:

| v4 Section | Content | Status |
|---|---|---|
| §1 | Purpose & dual mode | **Active** |
| §3 | Agent persona & system prompt (AGENTS.md content for shared preamble + buyer block + admin block) | **Active** |
| §3.2 | Visual identity | **Active** |
| §4 | Mode determination & authentication | **Active** |
| §4.1 | Entry point matrix | **Active** |
| §4.2 | Two-number voice architecture | **Active** |
| §4.3 | Telegram authentication | **Active** |
| §4.4 | Twilio admin voice authentication | **Active** |
| §5 | Website widget integration (end-to-end flow, JWT, allowed actions, listings deep-link pattern) | **Active** |
| §6 | Tools registered with the LLM (buyer-mode bundle + admin-mode bundle) | **Active** |
| §7 | Tool subset gating (allowlist by task type + field-level allowlist) | **Active** |
| §8 | Task types & workflows (all subsections: match presentation, pricing question, transport status, pipeline report, re-engagement dispatch, voice status check) | **Active** |
| §9 | Rate limits — topic-aware (intent thread concept, per-thread limits, daily ceiling, loop detector) | **Active** |
| §10 | Untrusted content isolation | **Active** |
| §11 | Structured extraction & confidence thresholds | **Active** |
| §12 | Explainability generation | **Active** |
| §13 | HITL escalations (HITL-01 through HITL-13 + admin HITL-A1-A3) | **Active** |
| §14 | Evaluation suite | **Active** |
| §17 | Capability rollout plan (C1-C8) | **Active** |
| §19, §20, §21 | Sample conversations (Buyer / Admin Telegram / Admin Voice) | **Active** |

---

## 2. WHAT'S REPLACED (V4 SECTIONS NO LONGER VALID)

| v4 Section | What it was | Why replaced |
|---|---|---|
| §2 (entire section) | "OpenClaw instance configuration" — YAML schema for gateway, models, heartbeat, memory, Langfuse | OpenClaw is not a Python framework. See Runtime Spec v1 for the actual runtime spec. |
| §15 | Dependencies | Updated below in §5 of this addendum |
| §16 | Acceptance criteria (AC-B01 through AC-A12) | Wording updated to reference the Python runtime, not OpenClaw. List below in §6 of this addendum. |
| §18 | Implementation checklist (Phase A through Phase H) | Phases A and B replaced; C through H mostly carry forward with adjusted references |

---

## 3. RUNTIME CONFIGURATION (REPLACES v4 §2)

DannyAgent runs as the `danny-worker.service` systemd service on the Danny VPS. The service runs `python -m app.agents.danny.entrypoint` from the shared `vch-backend` codebase. Configuration lives in `/etc/vch-agent.env` on the VPS.

### 3.1 Danny-Specific .env Values

The values below are Danny-specific. Most other config (OPENAI_API_KEY, GHL credentials, MarketCheck credentials, MC URL, Langfuse credentials) is the same as for any agent — see Runtime Spec v1 §6 for the full schema.

```bash
AGENT_ID=danny
VPS_HOSTNAME=vch-agent-danny
WORKER_POOL_SIZE=8                      # Danny is I/O-bound, scales well
HEARTBEAT_INTERVAL_SECONDS=15           # tighter than Negotiator
HEARTBEAT_MISSING_TOLERANCE_SECONDS=120  # 2 min
GRAPHITI_NAMESPACE=vch_buyer            # default — switched to vch_admin per-task for admin-mode work

BROWSER_USE_ENABLED=false               # Danny doesn't need Browser Use at MVP
```

### 3.2 Per-Task Graphiti Namespace Switching

Buyer-mode tasks query/write to `vch_buyer`. Admin-mode tasks query/write to `vch_admin`. The runtime's memory layer respects the task's `mode` field to select namespace at task ingestion. Buyer-mode tasks **cannot** read admin namespace data and vice versa — enforced in `app/agents/runtime/memory.py`.

### 3.3 AGENTS.md Deployment

The Danny persona file (v4 §3 — shared preamble + buyer block + admin block) is deployed to `/opt/danny-agent/AGENTS.md` on the Danny VPS, typically symlinked from `/opt/vch-backend/app/agents/danny/AGENTS.md`.

Updates to the persona:
1. Edit `app/agents/danny/AGENTS.md` in the vch-backend repo
2. Commit, push, tag a release
3. Mission Control initiates drain + redeploy on the Danny VPS
4. Worker restarts with new AGENTS.md, reports new SHA-256 to MC

### 3.4 Task Type Registration

The worker accepts the task types listed in v4 §8.1 (buyer-mode) and §8.2 (admin-mode). The `workflow_router` in `app/agents/danny/workflows.py` dispatches each `task_type` to its corresponding workflow handler.

### 3.5 Worker Pool Behavior

8 concurrent worker coroutines on one VPS. Each handles one buyer or admin task at a time. With Danny's I/O-bound profile (waiting on LLM, GHL MCP, MarketCheck MCP, backend HTTP), this comfortably serves hundreds of concurrent buyer sessions at scale — because at any moment most sessions are idle (buyer typing, agent awaiting LLM response).

Horizontal scaling: when one Danny VPS isn't enough, provision a second one. MC's fleet inventory tracks both; the orchestrator distributes new tasks via least-loaded routing. Sticky routing per `contact_id` is implemented at orchestrator level to keep a buyer's conversation hitting the same worker when possible (for warm tier-1 memory hits) — not required for correctness (state lives externally), but improves cache hits.

---

## 4. INVOLVED FILES IN THE SHARED CODEBASE

```
vch-backend/app/agents/danny/
├── AGENTS.md             (persona — from v4 §3)
├── entrypoint.py         (deployed as danny-worker.service)
├── workflows.py          (workflow handlers for buyer + admin task types from v4 §8)
└── tools.py              (registers buyer-mode + admin-mode tool subsets from v4 §6)
```

Plus shared utilities from `vch-backend/app/agents/shared/` and runtime library from `vch-backend/app/agents/runtime/` (see Runtime Spec v1).

---

## 5. DEPENDENCIES (REPLACES v4 §15)

| Dependency | Status | Required Before Phase |
|---|---|---|
| Mission Control + Langfuse + Graphiti deployed | ✅ Existing | All |
| VCH FastAPI backend with existing `/v1/*` endpoints | ✅ Existing | All |
| Backend `agent_actions_service` (new) | New | Phase 5 |
| Backend `Dealer` / `DealerContact` / `DealerGroup` / `StrategyReport` tables (new) | New | Phase 5 (admin tools touch these) |
| Backend orchestration module deployed | New | Phase 5 |
| Agent runtime library (`app/agents/runtime/`) | New | Phase 5 |
| Shared utilities (`app/agents/shared/`) | New | Phase 5 |
| Danny-specific code (`app/agents/danny/`) | New | Phase 5 |
| `vch-agent` system user on Danny VPS | New | Phase 5 |
| `/etc/vch-agent.env` on Danny VPS, populated | New | Phase 5 (requires OQ-V5-02, V5-03 for admin entries) |
| `danny-worker.service` systemd unit | New | Phase 5 |
| GHL MCP plugin connectivity | ✅ Existing | All |
| MarketCheck MCP API key | ✅ Existing | All |
| OpenAI API key (gpt-5.4 family) | ✅ Existing | All |
| Telegram bot provisioned | New | Phase 4 |
| Twilio admin number provisioned | New | Phase 4 |
| STT/TTS providers configured | OQ-V5-04, V5-05 | Phase 4 |

---

## 6. ACCEPTANCE CRITERIA (REPLACES v4 §16)

Wording updated to reference the Python runtime. The behavioral substance of every criterion is unchanged from v4 — same conditions, same thresholds.

### Buyer Mode

| # | Criteria |
|---|---|
| AC-B01 | `danny-worker.service` registers heartbeat with MC within 30s of `systemctl start` |
| AC-B02 | `present_recommendations` task completes within 2 min for 5-vehicle output |
| AC-B03 | Each presented vehicle has all 3 price points (Retail, VCH Target, OTD) |
| AC-B04 | Danny Savings calculated and visible |
| AC-B05 | Explainability mentions buyer's #1 priority |
| AC-B06 | Quick Match results include full-profile upgrade nudge |
| AC-B07 | Pricing question answered with sold comparables |
| AC-B08 | Transport status read from GHL custom fields and paraphrased |
| AC-B09 | Legal threat triggers HITL-02 within 30s |
| AC-B10 | Buyer requests human → HITL-03 |
| AC-B11 | Conversation summary added to GHL contact note via `add-contact-note` |
| AC-B12 | All writes audited via backend `audit_service.log_event` |
| AC-B13 | Langfuse trace ID returned on task completion callback to MC |
| AC-B14 | Tier 2 memory writes queryable in Graphiti `vch_buyer` namespace |
| AC-B15 | Danny does NOT quote unverified prices (adversarial test) |
| AC-B16 | Widget JWT validated on every WS message; replay invalid → 401 |
| AC-B17 | Tool subset gating: task without `update-contact-custom-field` cannot call it |
| AC-B18 | Field allowlist: cannot write `deal_stage` even with tool access |
| AC-B19 | Extraction confidence ≥0.9 auto-writes |
| AC-B20 | Extraction confidence 0.7-0.9 confirms first |
| AC-B21 | Extraction confidence <0.7 creates HITL |
| AC-B22 | 4th attempt on same intent thread blocked at backend |
| AC-B23 | Loop detector trips on same tool 3x in 60s |
| AC-B24 | Untrusted content isolation: 50 injection patterns; 100% pass |
| AC-B25 | Worker handles ≥8 concurrent buyer-mode tasks without queue blocking dispatch |
| AC-B26 | Worker survives MC unreachable for 5+ min (queue, retry callbacks) |

### Admin Mode

| # | Criteria |
|---|---|
| AC-A01 | Telegram allowlist match → admin Danny task with `mode='admin'` |
| AC-A02 | Telegram non-allowlist → silent drop (no response) |
| AC-A03 | Twilio admin CID match + correct PIN → Tier 2 task |
| AC-A04 | Twilio admin CID + 3 wrong PINs → 1h lockout + Ops alert |
| AC-A05 | Pipeline report numbers match source data (cross-check 5 reports) |
| AC-A06 | Tier-1 admin attempting Tier-2 action: refused |
| AC-A07 | Voice response ≤30s spoken time for status checks |
| AC-A08 | Admin dispatch creates buyer-Danny task with correct payload |
| AC-A09 | Admin actions logged at full detail in audit log |
| AC-A10 | Admin mode trace tagged `mode:admin` and `admin_auth_tier:N` in Langfuse |
| AC-A11 | Admin cannot write non-admin GHL fields without justification field |
| AC-A12 | Admin cannot delete contacts/deals (refused) |
| AC-A13 | Graphiti namespace correctly switches between `vch_buyer` (buyer task) and `vch_admin` (admin task) within same worker process |

---

## 7. IMPLEMENTATION CHECKLIST (REPLACES v4 §18 PHASE A AND B)

Phases C through H from v4 §18 carry forward with adjusted file/path references. The implementation order:

**Phase A (REPLACES v4 §18 Phase A) — Danny VPS provisioning**
- [ ] Confirm `vch-agent-danny` exists on Hetzner, joined to `vch-private-net` (existing)
- [ ] `vch-agent` system user created
- [ ] Install python3.12, git, ufw
- [ ] UFW: deny inbound public, allow private network ingress on FastAPI worker port (default 8080)
- [ ] Install OpenClaw CLI on the VPS (Node-based — per OpenClaw README)
- [ ] Place `/etc/vch-agent.env` with Danny-specific values per §3.1

**Phase B (REPLACES v4 §18 Phase B) — Codebase deploy**
- [ ] Clone `vch-backend` repo to `/opt/vch-backend`
- [ ] Checkout target release tag
- [ ] Create Python venv at `/opt/vch-backend/venv`
- [ ] `pip install -r requirements.txt`
- [ ] Symlink `/opt/danny-agent/AGENTS.md` → `/opt/vch-backend/app/agents/danny/AGENTS.md`
- [ ] Install `/etc/systemd/system/danny-worker.service` unit
- [ ] `systemctl daemon-reload && systemctl enable danny-worker && systemctl start danny-worker`
- [ ] Verify heartbeat in MC dashboard within 30s
- [ ] Verify `GET /health` returns 200 (private network only)
- [ ] Verify `GET /version` reports correct SHA-256 of AGENTS.md

**Phase C through H** — see v4 §18 Phases C through H. Adjust file paths:
- "Configure GHL MCP connection" → `app/agents/shared/ghl_mcp_client.py`
- "Configure MarketCheck MCP" → `app/agents/shared/marketcheck_mcp_client.py`
- "Configure VCH backend HTTP" → `app/agents/shared/backend_http_client.py`
- "Implement task router" → `app/agents/danny/workflows.py`
- "Workflows §8.3–§8.8" → still authoritative in v4; implement in `app/agents/danny/workflows.py`
- "Structured extraction" → `app/agents/shared/extraction.py`
- "HITL triggers" → in workflows.py
- "Intent thread management" → handled in `agent_actions_service` backend-side; agent reports thread close via `/v1/agent-actions/close-intent-thread`
- "Untrusted content wrapping" → `app/agents/shared/untrusted_content.py`
- "OpenAI function calling" → `app/agents/runtime/llm_client.py` enforces structured outputs
- "Widget service" → in `app/orchestration/widget_service.py` on backend VPS (NOT on Danny VPS — MC routes widget messages to Danny via task dispatch)
- "Admin entry points" → in `app/orchestration/webhook_handlers.py` (Telegram, Twilio admin)
- "Eval datasets" → unchanged
- "AC-B and AC-A criteria" → use the revised list in §6 of this addendum

---

## 8. WHAT YOU CAN IGNORE FROM v4

When reading v4 PRD, treat the following content as **stale / replaced**:

- §2 in its entirety (the YAML config block, gateway settings, OpenClaw memory tier syntax, etc.)
- Any references to `pip install openclaw` or `python -m openclaw.runtime`
- The implementation checklist Phase A and B (use this addendum's §7 instead)
- The dependencies table (use this addendum's §5 instead)
- The acceptance criteria table (use this addendum's §6 instead)

Everything else in v4 is authoritative and should be implemented as written.

---

**END OF DANNY PRD v5 ADDENDUM**
