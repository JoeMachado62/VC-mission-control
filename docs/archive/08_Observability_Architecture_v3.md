# VCH Agent Fleet — Observability Architecture v3

**Version:** 3.0 | May 2026
**Companion docs:** `VCH_Agent_Fleet_Plan_v5.md`, `09_Runtime_Spec_v1.md`, `01_DannyAgent_PRD_v5_addendum.md`, `02_NegotiatorAgent_PRD_v5_addendum.md`
**Supersedes:** Observability v2

This v3 is a targeted update to v2. The observability stack itself (Langfuse + Graphiti + Prometheus + Loki + Grafana) is unchanged. What changes is terminology (Python runtime instead of OpenClaw runtime), a few additional trace tags introduced by the v5 architecture, and integration points with Mission Control as fleet control plane.

---

## 1. WHAT'S STILL ACTIVE IN v2

The following sections from `08_Observability_Architecture_v2.md` carry forward unchanged. Use v2 as the authoritative source for these:

| v2 Section | Content | Status |
|---|---|---|
| §1 | Purpose, two complementary observability stacks | **Active** |
| §2 | Architecture (Langfuse + Prometheus/Loki/Grafana) | **Active** |
| §3.1 | One root trace per agent task | **Active** |
| §3.3 | Sensitive-data hygiene | **Active** |
| §3.4 | Span naming convention | **Active** |
| §4 | Deep-link integration (MC, GHL notes, audit log, HITL tasks) | **Active** |
| §5 | Dashboards (six core Grafana dashboards) | **Active** with minor additions per §3 of this doc |
| §6 | Alerts (operational, security, quality, cost) | **Active** |
| §7 | Eval datasets in Langfuse | **Active** |
| §8 | Retention | **Active** |
| §9 | Security of the observability stack | **Active** |
| §11 | Implementation checklist | **Active** with one path adjustment |

---

## 2. WHAT'S REPLACED

| v2 Section | What changes |
|---|---|
| §3.2 | Default trace tags — additional tags introduced in v5; revised list in §3 of this doc |
| §5 | Dashboard panels — minor additions for fleet/version visibility; see §4 of this doc |
| §10 | Acceptance criteria — wording updated for Python runtime; see §5 |
| §11 | Implementation checklist — Phase A reference updated; see §6 |

---

## 3. UPDATED TRACE TAGS (REPLACES v2 §3.2)

Set on every Langfuse trace at agent runtime startup and per-task:

| Tag | Value Source | New in v3? |
|---|---|---|
| `agent:danny` / `agent:negotiator` / *(future agents)* | Agent identity from `AGENT_ID` env | No |
| `mode:buyer` / `mode:admin` / `mode:wholesale` | From task | No |
| `env:production` / `env:staging` | Per-environment | No |
| `model_tier:nano` / `mini` / `full` | Per LLM call | No |
| `channel:<value>` | From task | No |
| `admin_auth_tier:1` / `:2` | Admin tasks only | No |
| `task_type:<value>` | From task | No |
| **`worker_vps:vch-agent-danny`** | From `VPS_HOSTNAME` env | **Yes — new in v5** |
| **`agent_version:v5.0.0`** | From code version + AGENTS.md SHA-256 | **Yes — new in v5** |
| **`worker_pool_size:8`** | From config | **Yes — new in v5** |

The new tags enable:
- Filtering traces by which VPS handled the task (debugging an issue on one VPS)
- Comparing performance across two AGENTS.md versions during a rollout
- Correlating trace anomalies with worker pool configuration

---

## 4. ADDITIONAL DASHBOARD PANELS (ADDITIONS TO v2 §5)

### 4.1 Fleet Health Dashboard — Add

- **Workers per VPS** — live count + capacity utilization per VPS
- **AGENTS.md version per VPS** — quick view to detect deployment drift
- **Drain status** — flag if any worker is in drain mode

### 4.2 Cost Dashboard — Add

- **Cost per task_type per agent** — granular view to find expensive workflows
- **Cost per worker_vps** — should be roughly equal; large skew suggests routing imbalance

### 4.3 New Dashboard — Mission Control Fleet Console (Implementation Note)

MC fleet console (Fleet Plan v5 §3.3) draws from Langfuse + Prometheus + backend. Specific panels:

- Live fleet inventory (each worker, status, version, queue depth) — sourced from `WorkerHealth` table populated by heartbeats
- Recent task callbacks per agent — sourced from MC's callback receiver
- OpenClaw dispatch history — sourced from `OpenClawDispatchLog` table
- Active drain operations
- Deploy/rollout status

This is the home for "what is the fleet doing right now" — Grafana for metrics depth, Langfuse for trace depth, MC for action-oriented fleet state.

---

## 5. ACCEPTANCE CRITERIA (REPLACES v2 §10)

| # | Criteria |
|---|---|
| OBS-01 | Every agent task creates exactly one root Langfuse trace |
| OBS-02 | Trace tagged with `agent`, `mode`, `channel`, `task_type`, `worker_vps`, `agent_version`; admin tasks additionally tagged `admin_auth_tier` |
| OBS-03 | Mission Control fleet console surfaces "View Trace" button for every task |
| OBS-04 | GHL notes written by agents include trace deep-link as final line |
| OBS-05 | Backend `audit_log` records carry `trace_id` field |
| OBS-06 | All six core dashboards live and refreshing; MC fleet console live |
| OBS-07 | Admin Tier-2 action triggers audit row + dashboard update within 60s |
| OBS-08 | Failed PIN brute-force triggers P1 alert within 60s |
| OBS-09 | Loop detector trip surfaces in dashboard within 60s |
| OBS-10 | Extraction confidence histograms populated daily |
| OBS-11 | Eval datasets versioned in Langfuse; CI runs on prompt change |
| OBS-12 | No raw buyer/dealer message text in any Langfuse span (sample-based audit) |
| OBS-13 | Token strings, API keys, PINs absent from all spans (regex audit) |
| OBS-14 | Cost dashboard accurate within 5% of OpenAI/MarketCheck billing |
| OBS-15 | Backend Prometheus + Loki + Grafana stack separate from Langfuse, with Grafana cross-linking to Langfuse traces |
| OBS-16 | **New:** Traces from different worker VPSs distinguishable via `worker_vps` tag (test by filtering) |
| OBS-17 | **New:** Trace tags include `agent_version` matching deployed AGENTS.md SHA-256 |
| OBS-18 | **New:** AGENTS.md SHA-256 reported by `GET /version` matches `agent_version` tag on traces |

---

## 6. IMPLEMENTATION CHECKLIST (UPDATES TO v2 §11)

**Phase A — Langfuse SDK in agents (UPDATED)**
- [ ] Install Langfuse Python SDK in vch-backend `requirements.txt` (single install — reaches all workers via shared codebase)
- [ ] Configure with private-network endpoint
- [ ] Configure default tags per agent (in `app/agents/runtime/observability.py`)
- [ ] Configure redaction patterns (PINs, tokens, JWTs, API keys) per `LANGFUSE_REDACT_PATTERNS` env
- [ ] Configure dynamic tagging: `mode` from task, `worker_vps` from `VPS_HOSTNAME`, `agent_version` from code version + AGENTS.md SHA-256

**Phase B-G** — see v2 §11 Phases B through G. Path references should resolve to `vch-backend/app/agents/runtime/observability.py` instead of separate per-VPS SDK install.

---

## 7. WHAT YOU CAN IGNORE FROM v2

When reading v2 Observability doc, treat the following as **stale / replaced**:

- §3.2 default tags list (use §3 of this doc)
- §10 acceptance criteria (use §5 of this doc)
- Any phrasing like "Install Langfuse SDK in DannyAgent VPS / NegotiatorAgent VPS" implying separate per-VPS Python installs — now installed once via shared codebase

Everything else in v2 is authoritative.

---

**END OF OBSERVABILITY v3**
