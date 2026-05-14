# VCH Agent Fleet — Observability Architecture v2

**Version:** 2.0 | May 2026
**Companion docs:** `VCH_Agent_Fleet_Plan_v4.md`, `01_DannyAgent_PRD_v4.md`, `02_NegotiatorAgent_PRD_v4.md`
**Supersedes:** v1 (March 2026), v1.1 (May 2026 working draft)

This v2 reflects the v4 architectural correction: real services only (GHL MCP, MarketCheck MCP, VCH backend HTTP, Browser Use), no fabricated MCP servers. Trace tags, dashboards, and alerts are updated to match the surfaces agents actually call.

---

## 1. PURPOSE

Provide complete operational, security, and quality visibility into agent behavior across both dual-mode Danny (buyer + admin) and wholesale Negotiator. Visibility goals:

- **Operational** — agents up, queue moving, no stuck tasks
- **Quality** — outputs meet rubrics; extraction confidence calibrated; rate limits respected
- **Security** — admin Tier-2 actions audited; prompt injection attempts surfaced; tool gating not bypassed
- **Cost** — model spend, MarketCheck usage, infra footprint
- **Forensics** — every agent decision reconstructable from traces + audit log + GHL notes

Two complementary observability stacks:

1. **Langfuse** — agent traces, LLM decisions, tool calls, evaluations. Hosted at `traces.virtualcarhub.com`. Already deployed on Mission Control VPS.
2. **Prometheus + Loki + Grafana** — backend infrastructure metrics, FastAPI request logs, system health. Already deployed (per existing `docs/OBSERVABILITY_GRAFANA.md`).

The two stacks are complementary, not redundant. Langfuse owns "what did the agent decide and why?" Prometheus/Loki owns "is the backend healthy and serving requests?"

---

## 2. ARCHITECTURE

```
┌──────────────────────────────────────────────────────────────────────────┐
│ DannyAgent VPS              NegotiatorAgent VPS                           │
│  • OpenClaw runtime          • OpenClaw runtime                           │
│  • Langfuse SDK (Python)     • Langfuse SDK (Python)                      │
│  • Mode-aware tagging        • Constant mode:wholesale tag                │
└──────────┬───────────────────────────┬──────────────────────────────────┘
           │ HTTPS over private net    │
           ▼                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Mission Control VPS — co-located observability stack                      │
│                                                                            │
│  Langfuse (agent traces)       Prometheus (metrics)      Loki (logs)      │
│   • PostgreSQL backend          • Backend FastAPI scrape  • Backend logs  │
│   • ClickHouse for traces       • MC Node.js metrics      • MC logs       │
│   • S3 for blob storage         • Agent VPS node_exporter • Agent logs    │
│   • API at :3002 (HTTP int)     • Hetzner-hosted          • Promtail      │
│   • Public TLS via Caddy                                                  │
│                                                                            │
│  Grafana (unified UI) — http://mc.virtualcarhub.com/grafana               │
│   Embeds Langfuse trace links for agent investigations                    │
└──────────────────────────────────────────────────────────────────────────┘
```

Agents post traces to Langfuse over the **private network** (port 3002, internal). Public TLS endpoint at `traces.virtualcarhub.com` is for human users (engineers, ops) viewing the UI, not agents.

---

## 3. TRACE STRUCTURE

### 3.1 One Root Trace Per Agent Task

Every OpenClaw task assignment to an agent creates exactly one Langfuse root trace.

```
Trace: <task_id>
├── attributes:
│     trace_id        : <uuid>
│     task_id         : <openclaw_task_id>
│     agent_id        : "danny" | "negotiator"
│     mode            : "buyer" | "admin" | "wholesale"
│     channel         : "widget" | "ghl_sms" | "ghl_email" | "telegram" |
│                       "telnyx_admin_voice" | "mc_internal" | "wholesale_email" |
│                       "wholesale_sms" | "wholesale_chat"
│     admin_auth_tier : 1 | 2 | null   (null when mode != admin)
│     admin_identity  : <telegram user id | telnyx CID> | null
│     contact_id      : <ghl contact id> | null
│     deal_id         : <vch deal id> | null
│     vin             : <vin> | null
│     intent_thread_id: <thread key> | null   (Danny only)
│     deal_thread_id  : <(dealer_id,vin) key> | null   (Negotiator only)
│     model_tier_used : "nano" | "mini" | "full"
│     allowed_tools   : [<tool names from task allowlist>]
│
├── spans:
│   ├── preload_context        ← getContact, conversationHistory pulls
│   │   ├── span: ghl_mcp.get_contact
│   │   ├── span: ghl_mcp.get_conversation_thread
│   │   └── span: tier2_memory.query (Graphiti)
│   │
│   ├── llm_invocation         ← root model call
│   │   ├── input: full prompt assembly
│   │   ├── output: structured response with tool calls
│   │   └── tokens, latency, cost
│   │
│   ├── tool_calls (children, one span each)
│   │   ├── span: marketcheck_mcp.predict_price_with_comparables
│   │   ├── span: backend.matching_run
│   │   ├── span: backend.send_email
│   │   │       ├── intent_thread_id (or deal_thread_id)
│   │   │       ├── policy_check_result: pass | reject
│   │   │       └── audit_log_event_id (from backend audit_service)
│   │   └── span: browser_use.chat_widget_session  (Negotiator only)
│   │
│   ├── extraction_events (Danny buyer mode)
│   │   ├── span: extract_structured_data
│   │   │       ├── field, value, confidence, decision
│   │   │       └── source_text_hash (NOT raw)
│   │
│   └── completion             ← task close span
│         ├── status: success | hitl_created | error
│         ├── hitl_task_id     (if any)
│         └── handoff_target   (if handoff workflow)
```

### 3.2 Default Tags

Set on every trace at agent runtime:

| Tag | Value Source |
|---|---|
| `agent:danny` or `agent:negotiator` | Agent identity |
| `mode:buyer` / `mode:admin` / `mode:wholesale` | From task |
| `env:production` / `env:staging` | Per-environment |
| `model_tier:nano` / `mini` / `full` | Per LLM call |
| `channel:<value>` | From task |
| `admin_auth_tier:1` / `:2` | Admin tasks only |
| `task_type:<value>` | From task |

### 3.3 Sensitive-Data Hygiene

- Source text from buyer/dealer messages is **hashed** (SHA-256) when stored in metadata
- Full conversation transcripts stored once in GHL, not duplicated in Langfuse spans
- PINs, tokens, API keys NEVER reach Langfuse metadata (filtered at SDK init)
- Custom field values written by `update-contact-custom-field` are span attributes; financial fields are pre-filtered out of any field write that wouldn't pass the agent allowlist

### 3.4 Span Naming Convention

`<source>.<operation>` — e.g.:

| Source | Examples |
|---|---|
| `ghl_mcp` | `ghl_mcp.get_contact`, `ghl_mcp.search_contacts` |
| `marketcheck_mcp` | `marketcheck_mcp.predict_price`, `marketcheck_mcp.search_active_cars` |
| `backend` | `backend.matching_run`, `backend.payment_estimate`, `backend.send_email`, `backend.add_contact_note`, `backend.update_custom_field`, `backend.create_task`, `backend.send_dealer_email` |
| `tier2_memory` | `tier2_memory.query`, `tier2_memory.write` |
| `browser_use` | `browser_use.chat_widget_session`, `browser_use.navigate` |
| `mc` | `mc.get_agent_queue`, `mc.search_traces` |

This means dashboards and queries can filter on `span.name LIKE 'backend.%'` to see all backend-bound activity, or on `'marketcheck_mcp.%'` to see MarketCheck usage. There are no fabricated MCP namespaces — span names map 1:1 to real services.

---

## 4. DEEP-LINK INTEGRATION

### 4.1 In Mission Control

Each MC task row carries `langfuse_trace_id`. UI surfaces a "View Trace" button:

```
https://traces.virtualcarhub.com/project/{project}/traces/{langfuse_trace_id}
```

### 4.2 In GHL Notes

Every agent action that writes a GHL contact note via `add-contact-note` includes the trace deep-link as the final line:

```
2026-05-08 14:23 — Sent recommendation email with 5 vehicles to Sarah.
Trace: https://traces.virtualcarhub.com/.../trace/abc123
```

This makes any historical conversation note instantly traceable to the underlying agent decision.

### 4.3 In Audit Log

The backend `audit_service.log_event` records include a `trace_id` field. Audit log inspector UI surfaces the link.

### 4.4 In HITL Tasks

Every HITL task (created via `/v1/agent-actions/create-task`) carries `trace_id` in its payload. GHL task view includes the link.

---

## 5. DASHBOARDS

Six core Grafana dashboards. All draw from Langfuse data via its query API; some pull additionally from Prometheus.

### 5.1 Fleet Health

**Audience:** Ops, on-call
**Refresh:** 30s

Panels:
- Agent online status (Danny + Negotiator) — heartbeat last 60s
- Active tasks per agent
- Task completion rate (last 1h, 24h)
- Error rate per agent
- Median latency per task type
- Queue depth per board (Buyer Experience, Admin Console, Wholesale Acquisition)
- Mode breakdown over last 24h (buyer / admin / wholesale)

Alert lines on this dashboard:
- Agent offline > 2 min → page on-call
- Error rate > 5% over 15 min → page on-call
- Queue depth > 50 for any board > 30 min → notify ops

### 5.2 Buyer Mode (Danny)

**Audience:** Product, ops
**Refresh:** 60s

Panels:
- Buyer task volume by type (last 7d, 30d)
- Match presentation latency p50/p95/p99
- HITL escalation rate by trigger (HITL-01 through HITL-13)
- Intent-thread state (open / satisfied / escalated / dismissed) by thread key
- Per-contact daily ceiling proximity (count contacts at >40 outbound/24h)
- Loop detector trips (count, recent traces)
- Widget session metrics (sessions opened, avg duration, abandonment rate)
- Top 20 intent-thread keys by volume

### 5.3 Admin Mode (Danny)

**Audience:** Joe, security
**Refresh:** 30s

Panels:
- Admin commands by entry point (Telegram / Telnyx admin / MC internal)
- Tier-2 actions log (every Tier-2 action is a row — no aggregation; full audit detail)
- Failed PIN attempts (last 24h, last 7d)
- Admin allowlist changes
- Voice call duration distribution
- Admin command response time
- Out-of-tier refusals (Tier-1 attempting Tier-2)
- Admin scope-violation refusals (e.g., delete attempts)

Alert lines:
- 3 failed PINs in 1h from same CID → page on-call
- Telegram non-allowlisted attempt at admin function → notify security
- Any Tier-2 admin action → log at full detail (visible here in real time)
- Out-of-allowlist admin command (e.g., "delete Sarah's contact") → notify security

### 5.4 Wholesale Mode (Negotiator)

**Audience:** Joe, SourcingSupervisor
**Refresh:** 60s

Panels:
- Strategy reports generated (last 7d, 30d)
- Outreach volume by channel (email / SMS / chat)
- Per-dealer 24h ceiling proximity
- Negotiator global 24h ceiling progress
- Decision-maker discovery success rate (rolling 30d)
- Browser Use chat session metrics (sessions opened, avg turns, success rate)
- Out-of-bounds counter rate (HITL-N02)
- Dealer thread state breakdown (open / won / lost / unresponsive / escalated)
- Average time from `ACQUISITION_PENDING` → human handoff
- Voice tasks dispatched to Telnyx (Phase 1 interim metric)

### 5.5 Rate Limits

**Audience:** Ops, engineering
**Refresh:** 60s

Panels:
- Intent thread attempts distribution (Danny, by thread key)
- Dealer thread attempts distribution (Negotiator)
- Per-thread cooldown blocks (count, by thread)
- Per-contact daily ceiling breaches (Danny)
- Per-dealer daily ceiling breaches (Negotiator)
- Global daily ceiling progress (200/day Negotiator)
- Loop detector trip count

### 5.6 Extraction Calibration (Danny)

**Audience:** Product, eval team
**Refresh:** Daily

Panels:
- Confidence distribution histogram (all extractions, last 7d/30d)
- Auto-write rate (≥0.9) vs. confirm-first rate (0.7-0.9) vs. HITL rate (<0.7)
- Confirmation override rate (buyer says "no, that's wrong" after a confirm)
- Per-field confidence quality (which fields have miscalibrated confidence?)
- HITL low-confidence outcomes (resolved / dismissed / persistent)
- Confidence drift over time (model regression detection)

This dashboard powers calibration improvements: if a field's auto-write rate is high but human-correction rate is also high, confidence calibration for that field needs adjustment.

### 5.7 Cost

**Audience:** Joe, finance
**Refresh:** Daily

Panels:
- Total LLM cost per day (Danny + Negotiator)
- Cost by model tier (nano / mini / full)
- Cost by mode
- MarketCheck API call volume (against contracted limits)
- GHL MCP call volume
- Browser Use session count (proxy for any third-party browser API costs if Browserbase is later swapped in)
- Token usage trends
- Cost per task type
- Hetzner infra cost (static)

---

## 6. ALERTS

### 6.1 Operational

| Alert | Condition | Severity | Routes To |
|---|---|---|---|
| Agent offline | No heartbeat > 2 min | P1 | On-call (PagerDuty) |
| High error rate | Errors > 5% over 15 min | P1 | On-call |
| Stuck queue | Queue depth > 50 for > 30 min | P2 | Ops |
| Slow task latency | p95 > 5x baseline for 30 min | P2 | Ops |
| Langfuse SDK failure | SDK errors > 10/min | P3 | Engineering |
| Backend service unhealthy | Prometheus alert from existing infra | P1 | On-call |

### 6.2 Security

| Alert | Condition | Severity | Routes To |
|---|---|---|---|
| Admin PIN brute force | 3 failed PINs in 1h same CID | P1 | On-call + Joe |
| Tier-2 admin action | Any Tier-2 action | INFO (logged) | Audit dashboard real-time |
| Telegram non-allowlist attempt | Any | P2 | Security review |
| Admin scope violation | Refusal in `out_of_scope_admin_*` category | P2 | Security review |
| Tool subset bypass attempt | Backend rejects with `tool_not_allowed_for_task` | P2 | Engineering |
| Field allowlist bypass attempt | Backend rejects custom field write | P2 | Engineering |
| Suspected prompt injection | Classifier flags injection pattern | P3 | Security review (batch) |
| Loop detector trip | 3+ identical tool calls in 60s | P2 | Engineering |

### 6.3 Quality

| Alert | Condition | Severity | Routes To |
|---|---|---|---|
| HITL escalation spike | HITL rate > 2x baseline for 1h | P3 | Product |
| Low confidence flood | <0.7 extraction rate > 30% for 1h | P3 | Product / eval team |
| Match presentation slow | p95 > 4 min | P3 | Engineering |
| Strategy report regen storm | Same deal regenerated > 3x in 24h | P3 | Engineering |

### 6.4 Cost

| Alert | Condition | Severity | Routes To |
|---|---|---|---|
| Daily LLM cost > 2x avg | Rolling 7d avg | P3 | Joe |
| MarketCheck API approaching contract limit | > 80% used | P3 | Joe + Eng |
| Per-contact ceiling breach | Hard 50/day breach for any contact | P3 | Ops |
| Negotiator global ceiling | > 80% of 200/day | P3 | Ops |

---

## 7. EVAL DATASETS IN LANGFUSE

Each agent maintains versioned eval datasets in Langfuse. Run on every config change, prompt change, or model upgrade.

### 7.1 Dataset Repos

| Repo Path | Contents |
|---|---|
| `vch-eval-datasets/danny/buyer/` | Match presentation, pricing transparency, voice consistency, HITL triggers, tool calls, process education, extraction calibration, rate-limit thread handling |
| `vch-eval-datasets/danny/admin/` | Pipeline reports, agent stats, voice brevity, dispatch confirmation, tier-aware refusal |
| `vch-eval-datasets/danny/security/` | Prompt injection (50+), tool subset gating bypass attempts (40+), field allowlist bypass attempts (30+) |
| `vch-eval-datasets/negotiator/strategy/` | Strategy report accuracy + quality |
| `vch-eval-datasets/negotiator/outreach/` | Initial outreach quality, response handling, tone |
| `vch-eval-datasets/negotiator/discovery/` | Decision-maker discovery success |
| `vch-eval-datasets/negotiator/chat/` | Browser Use chat widget conversation quality + safety |
| `vch-eval-datasets/negotiator/security/` | Prompt injection in dealer correspondence, tool gating |
| `vch-eval-datasets/negotiator/rate_limits/` | Thread state machine handling |

### 7.2 Run Schedule

- **CI on every prompt change** — full security suite + sampled quality suite
- **Weekly** — full quality suites
- **Monthly** — full eval (security + quality + extraction calibration)
- **Pre-deploy** — full security suite must pass 100% before deploy

### 7.3 Regression Tracking

Every eval run posts results back to Langfuse with the dataset version, agent version, and a delta vs. previous run. Grafana panel surfaces eval pass-rate trends over time.

---

## 8. RETENTION

| Data | Retention | Notes |
|---|---|---|
| Langfuse traces | 90 days hot, 1 year cold (S3) | After 1 year, summaries kept; full payloads deleted |
| Backend audit log (`audit_service`) | 7 years (compliance) | Existing policy; immutable |
| GHL contact notes | Indefinite | Customer data |
| Prometheus metrics | 30 days at full resolution, 90 days downsampled | Existing infra |
| Loki logs | 14 days | Existing infra |
| Eval results | 1 year | For trend analysis |
| Extraction `report-extraction` events | 1 year | For calibration analysis (hashed source text only) |
| PinAttempt records | 90 days | Then aggregated for analytics, raw deleted |

---

## 9. SECURITY OF THE OBSERVABILITY STACK

### 9.1 Access Control

- Langfuse UI — Joe + engineering team only (SSO if available, otherwise per-user accounts)
- Grafana — Joe, ops, engineering (separate Grafana org from any external access)
- Prometheus + Loki — internal only, no public ingress (private network access via SSH tunnel or VPN)

### 9.2 Trace Data Sensitivity

- Source text from buyer messages: **hashed** (SHA-256) in trace metadata, never stored raw
- Source text from dealer correspondence: same — hashed
- PII in spans: filtered at SDK level (Langfuse Python SDK config `redaction_patterns`)
- Token strings, API keys, PINs, JWTs: stripped before any span emission (regex filter at SDK init)

### 9.3 Network Path

- Agents → Langfuse: private network only (10.0.0.0/8) on port 3002
- Langfuse → external storage: S3 with proper IAM
- Public access: only via TLS-terminated `traces.virtualcarhub.com` with auth gate

### 9.4 Audit-Log Distinction

The `audit_service.log_event` records in the VCH backend are the **canonical record-of-truth.** Langfuse traces are the **investigative tool** — rich, queryable, but ultimately ephemeral (90-day hot retention).

For any compliance question, the answer comes from `audit_log` table, not from Langfuse. Langfuse is for understanding *why* the agent did what it did; audit log is for proving *that* it did.

---

## 10. ACCEPTANCE CRITERIA

| # | Criteria |
|---|---|
| OBS-01 | Every agent task creates exactly one root Langfuse trace |
| OBS-02 | Trace tagged with `agent`, `mode`, `channel`, `task_type`; admin tasks additionally tagged `admin_auth_tier` |
| OBS-03 | Mission Control surfaces "View Trace" button for every task |
| OBS-04 | GHL notes written by agents include trace deep-link as final line |
| OBS-05 | Backend `audit_log` records carry `trace_id` field |
| OBS-06 | All six dashboards live and refreshing |
| OBS-07 | Admin Tier-2 action triggers audit row + dashboard update within 60s |
| OBS-08 | Failed PIN brute-force triggers P1 alert within 60s |
| OBS-09 | Loop detector trip surfaces in dashboard within 60s |
| OBS-10 | Extraction confidence histograms populated daily |
| OBS-11 | Eval datasets versioned in Langfuse; CI runs on prompt change |
| OBS-12 | No raw buyer/dealer message text in any Langfuse span (sample-based audit) |
| OBS-13 | Token strings, API keys, PINs absent from all spans (regex audit) |
| OBS-14 | Cost dashboard accurate within 5% of OpenAI/MarketCheck billing |
| OBS-15 | Backend Prometheus + Loki + Grafana stack remains separate from Langfuse, with Grafana cross-linking to Langfuse traces for investigations |

---

## 11. IMPLEMENTATION CHECKLIST

**Phase A — Langfuse SDK in agents**
- [ ] Install Langfuse Python SDK in DannyAgent VPS
- [ ] Install Langfuse Python SDK in NegotiatorAgent VPS
- [ ] Configure with private-network endpoint (`http://10.0.0.5:3002`)
- [ ] Configure default tags per agent
- [ ] Configure redaction patterns (PINs, tokens, JWTs, API keys)
- [ ] Configure mode-tag injection at task ingestion

**Phase B — Span instrumentation**
- [ ] Wrap GHL MCP read calls with spans (`ghl_mcp.*`)
- [ ] Wrap MarketCheck MCP calls with spans (`marketcheck_mcp.*`)
- [ ] Wrap VCH backend HTTP calls with spans (`backend.*`)
- [ ] Wrap Tier-2 memory operations with spans (`tier2_memory.*`)
- [ ] Wrap Browser Use sessions with spans (`browser_use.*`) — Negotiator only
- [ ] Add structured extraction event spans — Danny only
- [ ] Add policy-check result attributes to backend write spans

**Phase C — Mission Control integration**
- [ ] Pass `langfuse_trace_id` field on every task (already in schema; ensure populated)
- [ ] Render "View Trace" button on task detail UI
- [ ] Pass `trace_id` to all `/v1/agent-actions/*` calls so backend audit_log captures it

**Phase D — GHL note formatting**
- [ ] Update `add-contact-note` payload assembly to append trace deep-link
- [ ] Verify deep-link renders correctly in GHL UI

**Phase E — Dashboards**
- [ ] Build Fleet Health dashboard
- [ ] Build Buyer Mode dashboard
- [ ] Build Admin Mode dashboard
- [ ] Build Wholesale Mode dashboard
- [ ] Build Rate Limits dashboard
- [ ] Build Extraction Calibration dashboard
- [ ] Build Cost dashboard

**Phase F — Alerts**
- [ ] Configure all P1/P2/P3 alerts per §6
- [ ] Wire to PagerDuty (P1) and Slack (P2/P3)
- [ ] Test each alert end-to-end

**Phase G — Evals**
- [ ] Build initial eval datasets per §7
- [ ] Configure CI hook for prompt changes
- [ ] Schedule weekly + monthly eval runs
- [ ] Build eval-trend Grafana panel

**Phase H — Security audits**
- [ ] Sample-audit traces for raw PII (none should leak)
- [ ] Sample-audit traces for token/key leaks (none should leak)
- [ ] Verify access control on Langfuse + Grafana

---

**END OF OBSERVABILITY ARCHITECTURE v2**
