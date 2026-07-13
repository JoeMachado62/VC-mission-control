# VCH Backend + Mission Control Implementation — v7.1

**Version:** 7.1 | May 2026
**Status:** Approved for build
**Prerequisite reading:** `01_VCH_Fleet_Architecture_v7.md` — every concept used here is defined there.
**Audience:** Two Claude Code sessions read this — the one on Backend VPS (`10.50.0.4`) and the one on Mission Control VPS (`10.50.0.1`). Each reads only their relevant Part below.

**Changelog v7.0 → v7.1 (Operational Reality Alignment):**

- §10.1 — OpenClaw gateway: deployment uses **loopback bind + socat relay** (not 0.0.0.0). Real systemd units included. `openclaw gateway status` CLI is unreliable on this build (stale-state anti-pattern); use `systemctl is-active` + `ss -tlnp` for verification.
- §10.2 / §17 — Pairing CLI is `openclaw devices` and `openclaw pairing`, NOT `openclaw operators` (the latter doesn't exist on OpenClaw 2026.4.14). Production deploys two operator devices (master + console identity).
- §11 — Caddyfile reflects actual deployment: serves from `virtualcarhub.cloud` root + `observe.virtualcarhub.cloud`. The `mc.virtualcarhub.com`, `danny.virtualcarhub.com`, and `app.virtualcarhub.com` references in v7.0 were speculative; only the first two are reserved-but-not-configured, and `app.*` is served off-VPS.
- §12 — Langfuse on port **3000** (not 3002 — v7.0's Caddyfile snippet contradicted its own §0.5 warning). Compose dir is `/opt/agentops/langfuse/` with an override pattern for loopback binding.
- §13 — Graphiti backed by **Neo4j 5.26** (not FalkorDB; both are supported by Graphiti, Neo4j is VCH's deployed choice). Three-container Docker deployment (`graphiti-neo4j`, `graphiti-rest`, `graphiti-mcp`).
- Doc 1 §5.4, §0.5 reference list, topology diagram, and acceptance criteria updated correspondingly.

No agent behavior, endpoint contracts, or acceptance criteria changed in v7.1. The changes are operational/deployment alignment with production reality.

---

## 0. WHAT THIS DOCUMENT IS

This document implements the infrastructure foundation that the production agents (Danny, Negotiator) depend on. It is split into two Parts:

- **Part 1 — Backend VPS** — FastAPI services, Postgres data layer, `agent_actions_service` (the policy enforcement boundary), audit logging, matching engine integration, deal state machine, orchestrator. **No OpenClaw installation.**
- **Part 2 — Mission Control VPS** — OpenClaw gateway hosting, Caddy TLS termination, Langfuse, Graphiti + Neo4j, fleet console Next.js UI, `admin-mc-hub` agent (which also owns all backend administration via HTTP), master pairing token management

A Backend VPS session reads Part 1. An MC VPS session reads Part 2. Cross-cutting concerns (§0.5, §20 open questions, §21 references) apply to both.

**Architectural note on backend administration:** The Backend VPS does not host an admin agent. All backend administration (database health, audit queries, service status, service restart, env verification, secret rotation) is owned by `admin-mc-hub` on Mission Control. admin-mc-hub calls the backend's `/v1/admin-actions/*` HTTP endpoints to perform these operations. Rationale: keep the database host conservative about what runs on it (no LLM agent runtime on the database server reduces attack surface), and admin-mc-hub serves as the unified operator interface for the entire fleet.

---

## 0.5 VERIFYING AGAINST CURRENT REALITY (READ THIS BEFORE PROCEEDING)

Full discussion and master reference list in `01_VCH_Fleet_Architecture_v7.md` §0.5. This section restates the rules and lists the tool-subset references most relevant to this doc.

### The Three Rules

**Rule 1:** If anything in this document conflicts with current behavior on the VPS, or with what the canonical references say, **current reality wins.** Surface the discrepancy to the operator.

**Rule 2:** Before assuming any capability, install pattern, file format, command syntax, or behavior for any named tool, **verify against the canonical reference first.**

**Rule 3:** When in doubt, run the command and read the output.

### Tool-Subset References for This Doc

**Backend stack:**
- FastAPI: https://fastapi.tiangolo.com
- SQLAlchemy 2.x async: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
- Alembic: https://alembic.sqlalchemy.org/en/latest/
- Pydantic v2: https://docs.pydantic.dev/latest/
- PostgreSQL 15+: https://www.postgresql.org/docs/current/
- httpx async: https://www.python-httpx.org
- argon2-cffi (token hashing): https://argon2-cffi.readthedocs.io
- Telnyx Python SDK: https://github.com/team-telnyx/telnyx-python
- Telnyx API: https://developers.telnyx.com/api

**Mission Control stack:**
- Next.js: https://nextjs.org/docs
- Mission Control upstream: https://github.com/builderz-labs/mission-control
- NextAuth.js: https://next-auth.js.org
- Caddy: https://caddyserver.com/docs/

**OpenClaw (MC only):**
- Main docs: https://docs.openclaw.ai
- Gateway hosting: https://docs.openclaw.ai/concepts/multi-agent
- Skill format: https://docs.openclaw.ai/tools/creating-skills
- Sub-agents: https://docs.openclaw.ai/tools/subagents
- Lobster: https://docs.openclaw.ai/tools/lobster

**Observability:**
- Langfuse self-hosted: https://langfuse.com/docs/deployment/self-host
- Langfuse Python SDK: https://langfuse.com/docs/sdk/python

**Shared knowledge graph:**
- Graphiti: https://github.com/getzep/graphiti
- Neo4j (VCH-deployed backend): https://neo4j.com/docs/
- FalkorDB (supported alternative): https://docs.falkordb.com

### Anti-Patterns Specific to This Doc

- **Installing OpenClaw on Backend VPS** — backend is pure FastAPI infrastructure; admin-mc-hub on MC owns all backend administration via HTTP
- **Assuming Twilio for voice/SMS** — Telnyx is the canonical provider
- **Assuming `api.virtualcarhub.com` is the backend URL** — that's NXDOMAIN; canonical is `http://backend-vps:8000` over WG
- **Treating `agent_actions_service` as something agents call to "ask permission"** — it's the policy enforcement boundary. Agents call it for every state change; the service either performs the operation or rejects it. There is no other write path.
- **Assuming Langfuse runs on port 3002** — it runs on `127.0.0.1:3000` (loopback) and is reached publicly through Caddy at `https://observe.virtualcarhub.cloud`. The "3002 myth" came from earlier drafts; the deployed reality is 3000.
- **Trusting `openclaw gateway status` lifecycle output** — on OpenClaw 2026.4.14 this command reads a different systemd unit than the one actually running the gateway and reports "stopped" even when the gateway is healthy. Use `systemctl is-active openclaw-gateway` + `ss -tlnp | grep 18789` instead.
- **Using `openclaw operators`** — that subcommand doesn't exist on OpenClaw 2026.4.14. Pairing surface is `openclaw devices` and `openclaw pairing`.
- **Treating MC as just an admin UI** — MC also hosts the OpenClaw gateway, Langfuse, Graphiti + Neo4j, Caddy. It's the fleet control plane.

---

# PART 1 — BACKEND VPS IMPLEMENTATION

Read this Part if you are the Claude Code session on the Backend VPS (`10.50.0.4`, hostname `backend-vps`).

---

## 1. AUDIT THE EXISTING SETUP

Before implementing, audit what's in place. Report findings concisely to the operator before making changes.

### 1.1 Infrastructure Audit

```bash
# WireGuard
wg show
ip addr show wg0
# Expected: peers for MC (10.50.0.1), Danny (10.50.0.2), Negotiator (10.50.0.3)
# Expected: local IP 10.50.0.4

# Hostname resolution
cat /etc/hosts | grep -E "mc-vps|danny-vps|negotiator-vps|backend-vps"
ping -c 1 mc-vps
ping -c 1 danny-vps
ping -c 1 negotiator-vps

# Existing services
systemctl list-units --type=service --state=running | grep -iE "vch|api|orchestr|postgres"

# Python environment
which python3 && python3 --version
ls /opt/vch-backend/ 2>/dev/null || echo "no vch-backend dir"
```

### 1.2 VCH Backend Codebase Audit

```bash
cd /opt/vch-backend 2>/dev/null && {
  git log --oneline -10
  git branch --show-current
  ls app/services/ 2>/dev/null
  ls app/models/ 2>/dev/null
  ls app/routes/ 2>/dev/null || ls app/api/ 2>/dev/null
  ls alembic/versions/ 2>/dev/null | wc -l
}
```

Identify:
- Does `app/services/agent_actions_service.py` exist? In what state (stub, partial, complete)?
- Does `app/orchestration/` exist?
- Which v7 Postgres tables (§3) already exist?
- Are there v2-era 11-agent stubs to archive?
- What's the FastAPI entry point and how is it currently started?

### 1.3 Database Audit

```bash
# Connect to VCH Postgres (credentials from /etc/vch-backend.env)
psql -h localhost -U vch -d vch_production -c "\dt"
psql -h localhost -U vch -d vch_production -c "SELECT version();"
```

Report which tables exist vs which v7 requires (§3.2).

### 1.4 OpenClaw Audit (Should Show NOT INSTALLED)

Backend VPS does NOT host OpenClaw. Verify this is the case, or plan removal if present.

```bash
# Should not be installed
which openclaw 2>/dev/null && echo "OPENCLAW PRESENT — should be removed" || echo "openclaw not installed (expected)"
systemctl --user status openclaw-node 2>/dev/null
ls /root/.openclaw 2>/dev/null && echo "OPENCLAW CONFIG PRESENT — should be removed"
```

If OpenClaw is present, plan its removal as part of v7 alignment.

### 1.5 Report Format

```
BACKEND VPS AUDIT SUMMARY (date: <YYYY-MM-DD>):

Infrastructure:
- WG mesh: <status> (peers reachable: <list>)
- Existing services running: <list>
- Python: <version>

VCH Backend code:
- Repo present: <yes/no, branch>
- agent_actions_service.py: <missing | stub | partial | complete>
- Existing tables in DB: <list>
- Missing v7 tables: <list>
- v2-era stub code present: <yes/no — paths>

OpenClaw (should be absent):
- Installed: <yes/no — if yes, plan removal>

Recommended deltas for v7 alignment:
1. <item>
2. <item>
...
```

---

## 2. agent_actions_service — THE POLICY ENFORCEMENT BOUNDARY

This is the single most important component the backend provides. Every state-changing operation any agent performs across the fleet routes through this service. Agents cannot bypass it.

### 2.1 Architecture

```
vch-backend/
├── app/
│   ├── services/
│   │   ├── agent_actions_service.py    # policy + dispatch entry point
│   │   ├── admin_actions_service.py    # admin endpoint handlers (called by admin-mc-hub)
│   │   ├── ghl_client.py                # GHL REST/MCP wrapper (server-side)
│   │   ├── telnyx_client.py             # Telnyx SDK wrapper
│   │   ├── matching_service.py          # match engine (existing)
│   │   ├── audit_service.py             # audit log writer
│   │   └── rate_limit_service.py        # rate limit checker
│   ├── routes/
│   │   ├── agent_actions.py             # /v1/agent-actions/*
│   │   └── admin_actions.py             # /v1/admin-actions/*
│   ├── models/
│   │   ├── audit_log.py
│   │   ├── intent_thread.py
│   │   ├── strategy_report.py
│   │   ├── dealer.py
│   │   ├── dealer_thread.py
│   │   ├── outbound_log.py
│   │   ├── hitl_task.py
│   │   ├── openclaw_dispatch_log.py
│   │   ├── fleet_state.py
│   │   ├── pending_approval.py
│   │   └── ...
│   ├── schemas/
│   │   ├── agent_actions/
│   │   └── admin_actions/
│   ├── auth/
│   │   └── service_token.py             # X-Service-Token validation + scoping
│   └── main.py                           # FastAPI app entry
```

### 2.2 Auth — X-Service-Token

Every `/v1/agent-actions/*` and `/v1/admin-actions/*` request requires header `X-Service-Token: <token>`. Tokens are per-agent (separate token for `danny`, `negotiator`, `admin-mc-hub`, `admin-danny`, `admin-negotiator`). Tokens are scoped — each token's permissions are checked against the requested action.

Token storage (DB):

```sql
CREATE TABLE agent_service_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scopes TEXT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_from UUID REFERENCES agent_service_tokens(id),
    revoked_at TIMESTAMPTZ,
    notes TEXT
);
```

Auth middleware (FastAPI dependency):
1. Extract `X-Service-Token` header
2. Hash (argon2) and look up in `agent_service_tokens` where `revoked_at IS NULL`
3. Check the requested endpoint's required scope is in `scopes`
4. Attach `agent_id` to request context
5. Return 401 on missing/invalid token; 403 on scope mismatch

### 2.3 `/v1/agent-actions/*` Endpoint Surface (Production Agents)

Every endpoint follows this lifecycle:
1. Auth via X-Service-Token
2. Pydantic schema validation
3. Business policy check
4. Rate limit check (where applicable)
5. Underlying operation (GHL call, Telnyx call, DB write, etc.)
6. `audit_service.log_event(...)` — audit row
7. Structured response

#### 2.3.1 `POST /v1/agent-actions/send-message`

Sends a message to a contact via the appropriate channel (Telnyx for SMS, GHL for email).

**Request:**
```json
{
  "trace_id": "string (Langfuse trace ID)",
  "contact_id": "string (GHL contact ID)",
  "channel": "sms | email | mms",
  "body": "string",
  "subject": "string (email only, optional)",
  "media_urls": ["string"],
  "context": {
    "intent_thread_id": "string (optional)",
    "deal_id": "string (optional)",
    "from_skill": "string",
    "mode": "buyer | admin | wholesale"
  }
}
```

**Policy:**
- Contact exists in GHL
- Channel enabled for contact (SMS requires phone + opt-in; email requires email)
- Rate limit: max 1 outbound per (contact_id, channel) per 4 hours unless contact replied within last 4h
- Body must not contain: agent service tokens, internal URLs, raw GHL contact IDs, unredacted financial data
- Length: SMS ≤ 1600 chars, email subject ≤ 200, email body ≤ 100KB
- Sub-account PIT auth: contact must belong to configured location

**Response (success):**
```json
{
  "status": "sent",
  "external_id": "telnyx_msg_<id> | ghl_msg_<id>",
  "audit_log_id": "uuid",
  "sent_at": "ISO 8601"
}
```

**Response (rejected):**
```json
{
  "status": "rejected",
  "reason": "rate_limit_exceeded | invalid_contact | policy_violation",
  "detail": "string",
  "audit_log_id": "uuid",
  "retry_after_seconds": 14400
}
```

#### 2.3.2 `POST /v1/agent-actions/add-contact-note`

**Request:**
```json
{
  "trace_id": "string",
  "contact_id": "string",
  "note_body": "string (max 5000 chars)",
  "tags": ["string"],
  "context": { "from_skill": "string", "intent_thread_id": "string (optional)" }
}
```

**Policy:** No raw tokens/keys/financial PII; ≤5000 chars; ≤10 tags
**Maps to:** GHL MCP tool `contacts_add-contact-note`

#### 2.3.3 `POST /v1/agent-actions/update-contact-field`

**Request:**
```json
{
  "trace_id": "string",
  "contact_id": "string",
  "field_name": "string (must be in allowlist)",
  "value": "string | number | bool",
  "context": { "from_skill": "string" }
}
```

**Policy:** `field_name` must be in `ALLOWED_AGENT_UPDATABLE_FIELDS` (initially: `buyer_intent_strength`, `last_match_presented_at`, `preferred_contact_method`, `vehicle_preference_summary`, `deal_stall_reason`, `agent_disposition`); value type must match field schema; buyer-mode agents can't update admin-only fields; wholesale-mode can't update buyer-facing fields.
**Maps to:** GHL MCP `contacts_update-contact`

#### 2.3.4 `POST /v1/agent-actions/create-opportunity`

**Request:**
```json
{
  "trace_id": "string",
  "contact_id": "string",
  "pipeline_id": "string",
  "stage_id": "string",
  "name": "string",
  "monetary_value": "number (optional)",
  "custom_fields": { "field_name": "value" },
  "context": { "from_skill": "string" }
}
```

**Policy:** Pipeline + stage exist; stage is a valid entry stage; no duplicate open opportunity for (contact_id, pipeline_id); custom fields pass per-field validation
**Maps to:** GHL MCP `opportunities_create-opportunity`

#### 2.3.5 `POST /v1/agent-actions/update-opportunity-stage`

**Request:**
```json
{
  "trace_id": "string",
  "opportunity_id": "string",
  "new_stage_id": "string",
  "transition_reason": "string",
  "context": { "from_skill": "string" }
}
```

**Policy:** Transition valid per deal state machine (§5); buyer-mode only forward-progresses; admin can reverse with reason; wholesale-mode only updates wholesale stages

#### 2.3.6 `POST /v1/agent-actions/schedule-followup`

**Request:**
```json
{
  "trace_id": "string",
  "contact_id": "string",
  "due_at": "ISO 8601 (future)",
  "title": "string",
  "body": "string",
  "assigned_to": "string (GHL user ID)",
  "context": { "from_skill": "string" }
}
```

**Policy:** Due in future, max 30 days out; no duplicate open task for (contact_id, title)
**Maps to:** GHL MCP `contacts_add-task`

#### 2.3.7 `POST /v1/agent-actions/hitl-escalate`

Opens a HITL task for human review.

**Request:**
```json
{
  "trace_id": "string",
  "trigger_code": "string (HITL-* code)",
  "summary": "string",
  "context_payload": { /* arbitrary JSON */ },
  "suggested_action": "string (optional)",
  "blocking": true,
  "urgency": "low | medium | high | urgent",
  "from_skill": "string",
  "contact_id": "string (optional)",
  "deal_id": "string (optional)",
  "intent_thread_id": "string (optional)"
}
```

**Behavior:**
- Creates `hitl_tasks` row
- Notifies operator via Telegram (admin-mc-hub channel)
- Surfaces in MC fleet console approval queue
- Returns `hitl_task_id` for polling

**Response:**
```json
{
  "status": "escalated",
  "hitl_task_id": "uuid",
  "notified_channels": ["telegram:ops-chat"],
  "audit_log_id": "uuid"
}
```

#### 2.3.8 `POST /v1/agent-actions/log-interaction`

Records buyer/dealer interaction for audit/analytics (not a state change).

**Request:**
```json
{
  "trace_id": "string",
  "interaction_type": "inbound_message | call_summary | meeting_note",
  "contact_id": "string",
  "channel": "string",
  "content_summary": "string (NOT raw content; sanitized)",
  "sentiment": "positive | neutral | negative | mixed",
  "key_entities": ["string"],
  "context": { "from_skill": "string" }
}
```

#### 2.3.9 `GET /v1/agent-actions/rate-limit-check`

Pre-check whether an outbound is allowed.

**Query:** `?contact_id=X&channel=Y&action_type=Z`

**Response:**
```json
{ "allowed": true, "reason": null, "next_allowed_at": null }
```
or
```json
{ "allowed": false, "reason": "max_outbound_per_4h", "next_allowed_at": "2026-05-13T15:30:00Z" }
```

#### 2.3.10 `POST /v1/agent-actions/strategy-report`

Persists a Negotiator strategy report.

**Request:**
```json
{
  "trace_id": "string",
  "contact_id": "string",
  "vehicle_target": { "year": 2024, "make": "Toyota", "model": "RAV4", "trim": "XLE" },
  "report_content": "string (markdown)",
  "key_data_points": { /* structured */ },
  "outreach_targets": [
    { "dealer_id": "string", "priority": 1, "rationale": "string" }
  ],
  "pricing_envelope": {
    "target_otd": 32500,
    "max_otd": 34000,
    "walk_away_otd": 35500
  },
  "context": { "from_skill": "string" }
}
```

**Behavior:** Creates `strategy_reports` row; returns `report_id` and viewer URL; may trigger downstream Lobster workflow `dispatch-dealer-outreach`

#### 2.3.11 `POST /v1/agent-actions/dealer-outreach`

Logs and dispatches a single dealer outreach attempt.

**Request:**
```json
{
  "trace_id": "string",
  "strategy_report_id": "string",
  "dealer_id": "string",
  "dealer_contact_id": "string",
  "channel": "email | sms | chat_widget",
  "subject": "string (email)",
  "body": "string",
  "context": { "from_skill": "string" }
}
```

**Policy:** Strategy report exists and is approved; dealer rate limit (1 per dealer per 24h unless replied); counter price within strategy envelope OR HITL escalation required

### 2.4 `/v1/admin-actions/*` Endpoint Surface (Called by admin-mc-hub)

admin-mc-hub on MC calls these endpoints to administer the backend. The backend is the actor; admin-mc-hub is the requester.

| Endpoint | Purpose | Required scope |
|---|---|---|
| `GET /v1/admin-actions/fleet-state` | Fleet inventory snapshot | `admin_actions.fleet_state.read` |
| `POST /v1/admin-actions/fleet-state-report` | Spoke admin reports VPS status | `admin_actions.fleet_state.write` |
| `POST /v1/admin-actions/openclaw-dispatch-log` | Admin action audit write | `admin_actions.dispatch_log.write` |
| `GET /v1/admin-actions/health/postgres` | Postgres connection + query health | `admin_actions.health.read` |
| `GET /v1/admin-actions/health/api` | api.service health (this endpoint itself confirms) | `admin_actions.health.read` |
| `GET /v1/admin-actions/health/orchestrator` | orchestrator.service status | `admin_actions.health.read` |
| `GET /v1/admin-actions/migration-status` | Alembic current vs heads | `admin_actions.migration.read` |
| `GET /v1/admin-actions/audit-query` | Query audit_log with filters | `admin_actions.audit.read` |
| `GET /v1/admin-actions/service-status` | systemctl status of backend services | `admin_actions.service.read` |
| `POST /v1/admin-actions/restart-service` | systemctl restart (Lobster-gated) | `admin_actions.service.restart` |
| `GET /v1/admin-actions/env-verify` | Verify env var presence (NOT contents) | `admin_actions.env.read` |
| `POST /v1/admin-actions/approval-request` | Open approval (from Lobster on MC) | `admin_actions.approval.create` |
| `POST /v1/admin-actions/approval-response` | Operator approval response | `admin_actions.approval.respond` |
| `POST /v1/admin-actions/rotate-service-token` | Rotate agent service token (Lobster-gated) | `admin_actions.token.rotate` |

**Each admin endpoint:**
1. Auth via X-Service-Token (admin-mc-hub's token)
2. Validate scope
3. Execute the requested admin operation locally on backend
4. Write to `openclaw_dispatch_log` table with full context
5. Return structured response

#### 2.4.1 `GET /v1/admin-actions/health/postgres`

**Returns:**
```json
{
  "status": "healthy | degraded | down",
  "connection_count": 12,
  "max_connections": 100,
  "long_running_queries": [
    { "pid": 12345, "duration_seconds": 67, "state": "active", "query_fingerprint": "SELECT ... FROM audit_log WHERE ..." }
  ],
  "database_size_gb": 4.2,
  "largest_tables": [
    { "table": "audit_log", "size_gb": 1.8 },
    { "table": "outbound_log", "size_gb": 0.9 }
  ],
  "replication_status": "not_replicated | healthy | lagging"
}
```

Query fingerprints redact actual values; only structure shown.

#### 2.4.2 `GET /v1/admin-actions/migration-status`

**Returns:**
```json
{
  "current_revision": "abc123",
  "head_revisions": ["abc123"],
  "in_sync": true,
  "pending_migrations": []
}
```
or
```json
{
  "current_revision": "abc123",
  "head_revisions": ["def456"],
  "in_sync": false,
  "pending_migrations": [
    { "revision": "def456", "description": "add fleet_state table" }
  ]
}
```

#### 2.4.3 `GET /v1/admin-actions/audit-query`

**Query params:**
- `start_at`, `end_at` (required, ISO 8601)
- `agent_id` (optional)
- `action_type` (optional)
- `outcome` (optional)
- `limit` (default 50, max 100)

**Returns:** Paginated rows from `audit_log`, with `payload_redacted` further sanitized if PII patterns detected.

**Policy:** Refuse queries spanning > 30 days without explicit `confirm=true`; never return more than 100 rows.

#### 2.4.4 `GET /v1/admin-actions/service-status`

**Query:** `?service=<api|orchestrator>`

**Returns:**
```json
{
  "service": "api.service",
  "active": true,
  "sub_state": "running",
  "uptime_seconds": 86400,
  "memory_mb": 245,
  "recent_log_lines": [
    { "ts": "...", "level": "INFO", "msg": "..." }
  ]
}
```

Log lines pass through secret-pattern redaction before return.

#### 2.4.5 `POST /v1/admin-actions/restart-service`

**Request:**
```json
{
  "service": "api | orchestrator",
  "reason": "string (required)",
  "approval_token": "string (Lobster resume token)"
}
```

**Policy:** Requires valid approval_token (verified against `pending_approvals` table on MC); restart logged to `openclaw_dispatch_log`; service status verified after restart; failure triggers automatic alert to admin-mc-hub.

#### 2.4.6 `GET /v1/admin-actions/env-verify`

**Query:** `?service=<api|orchestrator>&expected_vars=VAR1,VAR2,...`

**Returns:**
```json
{
  "service": "api.service",
  "vars_present": ["DATABASE_URL", "LANGFUSE_SECRET_KEY"],
  "vars_missing": [],
  "vars_unexpected": []
}
```

**Policy:** NEVER returns actual values; only presence/absence by name.

#### 2.4.7 `POST /v1/admin-actions/rotate-service-token`

**Request:**
```json
{
  "agent_id": "danny | negotiator | admin-* (excluding admin-mc-hub itself for safety)",
  "reason": "string",
  "approval_token": "string"
}
```

**Behavior:**
1. Generate new token + insert with `rotated_from = old_token_id`
2. Return new raw token to caller (admin-mc-hub propagates out-of-band to target VPS)
3. Schedule old token revocation for 24h later
4. Audit log to `openclaw_dispatch_log`

### 2.5 Audit Logging Pattern

Every `agent_actions` and `admin_actions` endpoint writes to `audit_log` or `openclaw_dispatch_log`. Pattern:

```python
async def some_endpoint(payload, agent_context):
    # ... policy checks, action execution ...
    await audit_service.log_event(
        trace_id=payload.trace_id,
        agent_id=agent_context.agent_id,
        action_type="send_message",
        target_type="contact",
        target_id=payload.contact_id,
        payload_redacted=redact(payload),
        outcome="success" | "policy_rejected" | "error",
        outcome_detail=str_or_none,
    )
    return response
```

`redact()` removes secrets, PII patterns. Audit is append-only.

---

## 3. DATABASE SCHEMA

### 3.1 Conventions

- Postgres 15+
- UUID primary keys (`gen_random_uuid()`)
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` on every table
- `updated_at TIMESTAMPTZ` on mutable tables with auto-update trigger
- All timestamps as `TIMESTAMPTZ`
- Indexes on FKs and commonly-queried fields
- Alembic-managed migrations only

### 3.2 Required Tables for v7

**`audit_log`** — append-only audit
```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    payload_redacted JSONB,
    outcome TEXT NOT NULL,
    outcome_detail TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_log_agent_id ON audit_log(agent_id);
CREATE INDEX idx_audit_log_trace_id ON audit_log(trace_id);
CREATE INDEX idx_audit_log_occurred_at ON audit_log(occurred_at DESC);
CREATE INDEX idx_audit_log_target ON audit_log(target_type, target_id);
```

**`agent_service_tokens`** — schema in §2.2

**`intent_threads`** — multi-turn intent state
```sql
CREATE TABLE intent_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id TEXT NOT NULL,
    intent_code TEXT NOT NULL,
    status TEXT NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    context_payload JSONB,
    resolution_summary TEXT
);
CREATE INDEX idx_intent_threads_contact ON intent_threads(contact_id);
CREATE INDEX idx_intent_threads_status ON intent_threads(status);
```

**`dealers`**
```sql
CREATE TABLE dealers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    location_city TEXT,
    location_state TEXT,
    location_zip TEXT,
    primary_brand TEXT,
    secondary_brands TEXT[],
    website_url TEXT,
    chat_widget_url TEXT,
    main_phone TEXT,
    reputation_score NUMERIC(3,2),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dealers_state ON dealers(location_state);
CREATE INDEX idx_dealers_primary_brand ON dealers(primary_brand);
```

**`dealer_contacts`**
```sql
CREATE TABLE dealer_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT,
    email TEXT,
    phone TEXT,
    decision_maker_score NUMERIC(3,2),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dealer_contacts_dealer ON dealer_contacts(dealer_id);
```

**`dealer_groups`** + **`dealer_group_members`**
```sql
CREATE TABLE dealer_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE dealer_group_members (
    dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
    dealer_group_id UUID NOT NULL REFERENCES dealer_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (dealer_id, dealer_group_id)
);
```

**`strategy_reports`**
```sql
CREATE TABLE strategy_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    vehicle_target JSONB NOT NULL,
    report_content TEXT NOT NULL,
    key_data_points JSONB,
    outreach_targets JSONB,
    pricing_envelope JSONB NOT NULL,
    status TEXT NOT NULL,        -- draft|approved|executing|completed|abandoned
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    approved_by TEXT
);
CREATE INDEX idx_strategy_reports_contact ON strategy_reports(contact_id);
CREATE INDEX idx_strategy_reports_status ON strategy_reports(status);
```

**`dealer_threads`**
```sql
CREATE TABLE dealer_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_report_id UUID NOT NULL REFERENCES strategy_reports(id),
    dealer_id UUID NOT NULL REFERENCES dealers(id),
    dealer_contact_id UUID REFERENCES dealer_contacts(id),
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    last_outbound_at TIMESTAMPTZ,
    last_inbound_at TIMESTAMPTZ,
    current_quote_otd NUMERIC(10,2),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dealer_threads_strategy ON dealer_threads(strategy_report_id);
CREATE INDEX idx_dealer_threads_dealer ON dealer_threads(dealer_id);
CREATE INDEX idx_dealer_threads_status ON dealer_threads(status);
```

**`outbound_log`**
```sql
CREATE TABLE outbound_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    contact_id TEXT,
    dealer_thread_id UUID REFERENCES dealer_threads(id),
    channel TEXT NOT NULL,
    body_redacted TEXT NOT NULL,
    external_id TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rate_limit_check_passed BOOLEAN NOT NULL
);
CREATE INDEX idx_outbound_log_contact ON outbound_log(contact_id);
CREATE INDEX idx_outbound_log_dealer_thread ON outbound_log(dealer_thread_id);
CREATE INDEX idx_outbound_log_sent_at ON outbound_log(sent_at DESC);
```

**`hitl_tasks`**
```sql
CREATE TABLE hitl_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    trigger_code TEXT NOT NULL,
    summary TEXT NOT NULL,
    context_payload JSONB NOT NULL,
    suggested_action TEXT,
    urgency TEXT NOT NULL,
    status TEXT NOT NULL,
    claimed_by TEXT,
    claimed_at TIMESTAMPTZ,
    resolution_action TEXT,
    resolution_notes TEXT,
    resolved_at TIMESTAMPTZ,
    contact_id TEXT,
    deal_id TEXT,
    intent_thread_id UUID REFERENCES intent_threads(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_hitl_tasks_status ON hitl_tasks(status);
CREATE INDEX idx_hitl_tasks_urgency ON hitl_tasks(urgency);
CREATE INDEX idx_hitl_tasks_created_at ON hitl_tasks(created_at DESC);
```

**`fleet_state`** — current snapshot, updated by spoke admin agents
```sql
CREATE TABLE fleet_state (
    vps_hostname TEXT PRIMARY KEY,
    wg_ip INET NOT NULL,
    reported_by_agent TEXT NOT NULL,
    reported_at TIMESTAMPTZ NOT NULL,
    runtime_status TEXT NOT NULL,
    openclaw_node_uptime_seconds BIGINT,
    active_workflows INTEGER,
    queue_depth INTEGER,
    pending_approvals INTEGER,
    drift_alerts JSONB,
    free_disk_gb NUMERIC(8,2),
    free_memory_gb NUMERIC(6,2),
    recent_errors JSONB
);
```

**`openclaw_dispatch_log`** — admin action audit
```sql
CREATE TABLE openclaw_dispatch_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT NOT NULL,
    admin_agent_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    target_vps TEXT,
    target_resource TEXT,
    payload_redacted JSONB,
    approval_required BOOLEAN NOT NULL,
    approval_status TEXT,
    approved_by TEXT,
    outcome TEXT NOT NULL,
    outcome_detail TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_openclaw_dispatch_log_admin ON openclaw_dispatch_log(admin_agent_id);
CREATE INDEX idx_openclaw_dispatch_log_at ON openclaw_dispatch_log(occurred_at DESC);
```

**`pending_approvals`** — Lobster halts awaiting operator
```sql
CREATE TABLE pending_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resume_token TEXT NOT NULL UNIQUE,
    proposing_agent TEXT NOT NULL,
    workflow_name TEXT NOT NULL,
    preview JSONB NOT NULL,
    notified_channels TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution TEXT,
    resolved_by TEXT
);
CREATE INDEX idx_pending_approvals_status ON pending_approvals((resolved_at IS NULL));
```

**`agent_versions`** — persona + skill catalog versioning
```sql
CREATE TABLE agent_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    persona_sha TEXT NOT NULL,
    skill_catalog_sha TEXT NOT NULL,
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deployed_by TEXT,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT
);
CREATE INDEX idx_agent_versions_agent ON agent_versions(agent_id, deployed_at DESC);
```

**`worker_health`** — heartbeat history
```sql
CREATE TABLE worker_health (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vps_hostname TEXT NOT NULL,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    openclaw_healthy BOOLEAN NOT NULL,
    queue_depth INTEGER,
    notes TEXT
);
CREATE INDEX idx_worker_health_vps_at ON worker_health(vps_hostname, reported_at DESC);
```

### 3.3 Migration Strategy

Use Alembic. Migration ordering: audit_log → agent_service_tokens → intent_threads → dealers/contacts/groups → strategy_reports → dealer_threads → outbound_log → hitl_tasks → fleet_state → openclaw_dispatch_log → pending_approvals → agent_versions → worker_health.

Each as separate revision file with `downgrade()` working.

### 3.4 Data Migration

Preserve existing v2/v3-era data; do not drop tables. Add v7 tables alongside. Archive v2/v3 stubs only after operator confirmation.

---

## 4. MATCHING ENGINE INTEGRATION

The matching engine exists. v7 exposes it to skills via HTTP under `/v1/matching/*`.

### 4.1 Endpoints

**`POST /v1/matching/run`**

Request:
```json
{
  "trace_id": "string",
  "contact_id": "string",
  "criteria": {
    "budget_max_otd": 32000,
    "year_min": 2020,
    "make_in": ["Toyota", "Honda"],
    "body_type_in": ["SUV"],
    "feature_must_have": ["AWD"],
    "feature_nice_have": ["sunroof"],
    "max_distance_miles": 250,
    "preferred_zip": "33301"
  },
  "limit": 10
}
```

Response:
```json
{
  "match_id": "uuid",
  "matches": [
    {
      "vehicle_id": "string",
      "score": 0.92,
      "score_breakdown": { "budget": 1.0, "features": 0.85 },
      "summary": "string"
    }
  ]
}
```

**`GET /v1/matching/results/{match_id}`** — idempotent fetch

### 4.2 Skill Integration

Skills call via HTTP with X-Service-Token. Matching engine endpoints validate token + read scope.

---

## 5. DEAL STATE MACHINE

### 5.1 Canonical States

| State | Description |
|---|---|
| `new_lead` | Contact just entered; no qualification |
| `qualifying` | Active discovery |
| `presenting_matches` | Inventory shown; awaiting feedback |
| `narrowing` | Refining based on feedback |
| `strategy_pending` | Negotiator generating strategy report |
| `negotiating` | Dealer outreach in progress |
| `quote_received` | Counter received |
| `closing_handoff` | Human closer engaged |
| `closed_won` | Deal complete |
| `closed_lost` | Deal abandoned |
| `stalled` | Activity gap exceeded threshold |

### 5.2 Transitions

State machine validates in `app/services/deal_state_service.py`. Invalid transitions return 422. Buyer-mode can only forward; admin can reverse with documented reason; wholesale-mode only on wholesale stages.

### 5.3 Orchestrator Service

`orchestrator.service` (background process) runs:
- Stall detector (deals in any state with no activity > threshold)
- Scheduled job dispatcher
- Webhook receivers (GHL contact events, Telnyx delivery receipts)
- Daily aggregation jobs

Job queue: Celery + Redis or RQ + Redis per existing convention. See OQ-V7-I.

---

## 6. AUDIT SERVICE

Thin wrapper around `audit_log` and `openclaw_dispatch_log`. Enforces:
- Required fields per action_type
- Redaction patterns on payload
- Atomic write
- Returns audit row ID

```python
audit_id = await audit_service.log_event(...)
return {..., "audit_log_id": audit_id}
```

---

## 7. PER-AGENT SERVICE TOKEN PROVISIONING

### 7.1 Generation

```python
# scripts/provision_agent_token.py
import secrets
import argon2

def provision_token(agent_id: str, scopes: list[str], notes: str = "") -> str:
    raw_token = secrets.token_urlsafe(48)
    hasher = argon2.PasswordHasher()
    token_hash = hasher.hash(raw_token)
    # INSERT INTO agent_service_tokens (agent_id, token_hash, scopes, notes) VALUES (...)
    print(f"Generated token for {agent_id}.")
    print(f"COPY NOW — not shown again:")
    print(raw_token)
    return raw_token
```

### 7.2 Token Scopes (Five Agents)

| Agent | Scopes |
|---|---|
| `danny` | `agent_actions.send_message`, `agent_actions.add_contact_note`, `agent_actions.update_contact_field`, `agent_actions.create_opportunity`, `agent_actions.update_opportunity_stage`, `agent_actions.schedule_followup`, `agent_actions.hitl_escalate`, `agent_actions.log_interaction`, `agent_actions.rate_limit_check`, `matching.run`, `matching.read` |
| `negotiator` | `agent_actions.strategy_report`, `agent_actions.dealer_outreach`, `agent_actions.add_contact_note`, `agent_actions.update_contact_field`, `agent_actions.hitl_escalate`, `agent_actions.log_interaction`, `agent_actions.rate_limit_check`, `matching.read` |
| `admin-mc-hub` | `admin_actions.*` (all admin scopes — this agent is the unified administrator) |
| `admin-danny` | `admin_actions.fleet_state.write`, `admin_actions.dispatch_log.write`, `admin_actions.approval.create` (scoped to Danny VPS reports only) |
| `admin-negotiator` | Same shape as admin-danny, scoped to Negotiator VPS |

### 7.3 Distribution

After generation, the operator distributes each token to its target VPS out-of-band (NOT through chat). Sets in `/etc/<agent>.env` as `VCH_BACKEND_SERVICE_TOKEN=<token>`.

### 7.4 Rotation

Rotation procedure (Lobster-wrapped on MC, Tier 3 — see §17):
1. Generate new token, insert with `rotated_from = old_token_id`, do NOT revoke old
2. Operator distributes new token to target VPS env file
3. Restart target VPS service to pick up new env
4. Verify (test request)
5. Revoke old token after grace period

---

## 8. BACKEND ACCEPTANCE CRITERIA

| # | Criterion |
|---|---|
| BA-01 | All v7 Postgres tables exist per `\dt` inventory |
| BA-02 | All Alembic migrations applied; `alembic current` matches `alembic heads` |
| BA-03 | `api.service` running on `0.0.0.0:8000`; systemd enabled |
| BA-04 | `orchestrator.service` running; systemd enabled |
| BA-05 | `GET /v1/healthcheck` returns 200 from any WG-mesh VPS |
| BA-06 | All `/v1/agent-actions/*` endpoints exist; reject without X-Service-Token (401) |
| BA-07 | Each endpoint rejects with wrong-scope token (403); accepts correct-scope (200) |
| BA-08 | `audit_log` row written for every `/v1/agent-actions/*` request (success or rejected) |
| BA-09 | `send_message` actually delivers via Telnyx (SMS test) and GHL (email test) |
| BA-10 | Rate limit enforcement verified (second send within 4h → rejected) |
| BA-11 | HITL escalation creates `hitl_tasks` row and notifies operator Telegram |
| BA-12 | All `/v1/admin-actions/*` endpoints exist and respond correctly to admin-mc-hub's token |
| BA-13 | `health/postgres` returns valid status with no actual query contents leaked |
| BA-14 | `audit-query` enforces 100-row cap and >30-day confirm requirement |
| BA-15 | `restart-service` rejects without valid approval_token (403) |
| BA-16 | `env-verify` returns names only, never values |
| BA-17 | Service tokens generated and inserted into `agent_service_tokens` for all five agents |
| BA-18 | OpenClaw confirmed NOT installed on Backend VPS |
| BA-19 | End-to-end test: skill on Danny VPS calls `/v1/agent-actions/send-message` → message delivered → audit row exists |
| BA-20 | End-to-end test: admin-mc-hub calls `/v1/admin-actions/health/postgres` → valid response → openclaw_dispatch_log row exists |

---

# PART 2 — MISSION CONTROL VPS IMPLEMENTATION

Read this Part if you are the Claude Code session on the MC VPS (`10.50.0.1`, hostname `mc-vps`).

---

## 9. AUDIT THE EXISTING SETUP

```bash
# WireGuard
wg show
ip addr show wg0

# OpenClaw gateway (use systemctl + ss; openclaw gateway status is unreliable — see §10.1)
systemctl is-active openclaw-gateway
systemctl is-active openclaw-gateway-tunnel
ss -tlnp | grep 18789
jq '.gateway' /root/.openclaw/openclaw.json
openclaw devices list

# Existing services
systemctl status mission-control 2>/dev/null
systemctl status caddy
docker ps | grep -iE "langfuse|graphiti|neo4j"

# Public reachability
curl -I https://virtualcarhub.cloud/                   # MC fleet console
curl -I https://observe.virtualcarhub.cloud/api/public/health   # Langfuse healthcheck
curl -I https://virtualcarhub.cloud/gw                 # Gateway WS endpoint
```

Report per format adapted from §1.5.

---

## 10. OPENCLAW GATEWAY HOSTING

MC hosts the OpenClaw gateway (hub all spokes pair to).

### 10.1 Gateway Install + Bind Pattern

VCH deploys the gateway with a **loopback bind + socat relay** pattern (more secure than direct 0.0.0.0 bind — gateway process never listens on the network directly; a separate relay process exposes the loopback listener over WireGuard only).

```bash
npm install -g openclaw@2026.4.14
```

Two systemd units coordinate the deployment:

**`/etc/systemd/system/openclaw-gateway.service`** — gateway process bound to loopback:

```ini
[Unit]
Description=OpenClaw Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=HOME=/root
Environment=OPENCLAW_STATE_DIR=/root/.openclaw
Environment=NODE_COMPILE_CACHE=/var/tmp/openclaw-compile-cache
Environment=OPENCLAW_NO_RESPAWN=1
ExecStart=/usr/bin/env openclaw gateway --bind loopback --port 18789
Restart=always
RestartSec=5
TimeoutStartSec=60
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

**`/etc/systemd/system/openclaw-gateway-tunnel.service`** — socat relay exposing the loopback listener on the WG IP:

```ini
[Unit]
Description=Socat tunnel-relay for OpenClaw gateway (wg0 -> loopback)
After=network-online.target wg-quick@wg0.service openclaw-gateway.service
Wants=network-online.target wg-quick@wg0.service
PartOf=openclaw-gateway.service

[Service]
Type=simple
ExecStart=/usr/bin/socat TCP-LISTEN:18789,bind=10.50.0.1,fork,reuseaddr TCP:127.0.0.1:18789
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
```

The `PartOf=openclaw-gateway.service` directive on the tunnel ensures restarting the gateway automatically restarts the relay. Required: install both units, enable both, start the gateway first then the tunnel.

```bash
systemctl daemon-reload
systemctl enable --now openclaw-gateway.service
systemctl enable --now openclaw-gateway-tunnel.service
```

**Verification — trust systemctl + ss, NOT `openclaw gateway status`:**

The `openclaw gateway status` CLI command reports stale "Runtime: stopped" state on this build even when the gateway is actively running (it reads a disabled user-systemd unit, not the system-systemd unit that's actually running the process). This is the §0.5 stale-CLI-output anti-pattern in action on this specific command.

Use authoritative verification:

```bash
systemctl is-active openclaw-gateway          # expected: active
systemctl is-active openclaw-gateway-tunnel   # expected: active
ss -tlnp | grep 18789                         # expected: 127.0.0.1:18789 (gateway) + 10.50.0.1:18789 (socat)
```

If both systemd units report `active` and `ss` shows both listeners, the gateway is reachable from spokes over WG. Do NOT rely on `openclaw gateway status` for operational decisions.

### 10.2 Master Operator Pairing Token

On OpenClaw 2026.4.14, the pairing surface is `openclaw devices` and `openclaw pairing` — there is NO `openclaw operators` subcommand. The doc previously referenced `openclaw operators` which is incorrect for this build.

Create the master operator device with full operator scopes:

```bash
openclaw pairing create-operator \
  --name "joe-master" \
  --scopes "operator.admin,operator.read,operator.write,operator.approvals,operator.pairing,operator.talk.secrets"
# Token output: 64-hex string. COPY IT. Store in secrets vault.
```

Verify with:

```bash
openclaw devices list
```

The output shows all paired devices, their roles, scopes, and last-seen IPs. The master operator appears as a row with role `operator` and the full set of `operator.*` scopes.

Stored in MC's secrets vault; never logged or exposed. Used by VCH internal tooling and to issue scoped pairing tokens for spokes.

**Note on dual operator devices:** VCH's production deployment carries TWO operator-role devices:
1. The master operator (the `joe-master` identity above, with all six operator scopes)
2. A second operator device named "Mission Control" with scope `operator.admin` only

The "Mission Control" entry appears to be the fleet console UI's own operator identity (so the console can authenticate as an operator when surfacing fleet state, approving Lobster workflows, etc.). If you see this row in `openclaw devices list`, do not assume it is a duplicate — it is the console's identity and should remain. Confirm with the operator before any "cleanup" operation that touches operator devices.

### 10.3 Pairing for Spokes

Spokes (Danny, Negotiator) pair via WG to `mc-vps:18789` with `OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1`. WG provides the trust property; plaintext WS is acceptable inside the encrypted mesh.

Backend VPS does NOT pair to the gateway (no OpenClaw installation there).

---

## 11. CADDY CONFIGURATION

Caddy fronts the public domains served from MC and terminates TLS. VCH's production deployment uses a minimal Caddyfile that serves three concerns from two distinct domains:

```caddyfile
# /etc/caddy/Caddyfile

(security_headers) {
    header {
        ?Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
}

virtualcarhub.cloud {
    import security_headers
    encode zstd gzip

    handle_path /gw* {
        reverse_proxy 127.0.0.1:18789
    }

    reverse_proxy 127.0.0.1:3005
}

observe.virtualcarhub.cloud {
    import security_headers
    encode zstd gzip

    reverse_proxy 127.0.0.1:3000
}
```

What this serves:

| Domain | Path | Backend (loopback) | Purpose |
|---|---|---|---|
| `virtualcarhub.cloud` | `/gw*` (handled first) | `127.0.0.1:18789` | OpenClaw gateway WS — spokes pair via `wss://virtualcarhub.cloud/gw` |
| `virtualcarhub.cloud` | (everything else) | `127.0.0.1:3005` | Mission Control fleet console (Next.js) |
| `observe.virtualcarhub.cloud` | (all) | `127.0.0.1:3000` | Langfuse |

**Reserved but not currently configured:**

- `mc.virtualcarhub.com` — was originally reserved for the MC console; current deployment serves the console at `virtualcarhub.cloud` root instead. The subdomain remains available for future use.
- `danny.virtualcarhub.com` — reserved for buyer-facing widget gateway. Not currently provisioned on MC. When needed, add as a new Caddy block reverse-proxying to the widget backend (location TBD).
- `app.virtualcarhub.com` — served by a different host (off-VPS nginx), NOT by MC's Caddy. Do not add to this Caddyfile.

**Port assignments to remember:**

- `127.0.0.1:3000` — Langfuse web (because Langfuse defaults to 3000 and VCH didn't remap it)
- `127.0.0.1:3005` — MC Next.js console (because Langfuse owns 3000)
- `127.0.0.1:18789` — OpenClaw gateway (loopback bind; see §10.1)

`caddy reload` after config changes (preserves TLS state and active connections).

---

## 12. LANGFUSE SETUP

Docker Compose stack from upstream Langfuse self-host repo, deployed at `/opt/agentops/langfuse/`. The upstream `docker-compose.yml` is used verbatim; a small `docker-compose.override.yml` carries the VCH-specific customization (binding ports to loopback only).

### 12.1 Stack Components

| Service | Container | Loopback port | Notes |
|---|---|---|---|
| Langfuse Web | `langfuse-langfuse-web-1` | `127.0.0.1:3000` | Public via Caddy at observe.virtualcarhub.cloud |
| Langfuse Worker | `langfuse-langfuse-worker-1` | `127.0.0.1:3030` | Background processing |
| Postgres | `langfuse-postgres-1` | `127.0.0.1:5432` | Langfuse's own DB; separate from VCH backend's Postgres |
| ClickHouse | `langfuse-clickhouse-1` | `127.0.0.1:8123, :9000` | Trace storage |
| Redis | `langfuse-redis-1` | `127.0.0.1:6379` | Cache/queue |
| MinIO | `langfuse-minio-1` | `127.0.0.1:9090, :9091` | S3-compatible object storage |

**Note:** Langfuse-web is on port 3000 (not 3002 as some prior drafts of this doc stated). Doc 1 §0.5 specifically flagged "do not assume Langfuse runs on 3002" — this section reflects the actual port. Caddy proxies `observe.virtualcarhub.cloud` → `127.0.0.1:3000`.

### 12.2 VCH-Specific Override

The single customization layered on top of the upstream compose file:

```yaml
# /opt/agentops/langfuse/docker-compose.override.yml

services:
  langfuse-web:
    ports: !override
      - 127.0.0.1:3000:3000

  minio:
    ports: !override
      - 127.0.0.1:9090:9000
      - 127.0.0.1:9091:9001
```

The `!override` directive replaces the upstream port mappings (which expose to 0.0.0.0 by default) with loopback-only bindings. All public access goes through Caddy.

### 12.3 Configuration & Secrets

Secrets live in `/opt/agentops/langfuse/.env` (NOT in the compose files). The upstream `docker-compose.yml` references `${VAR:-CHANGEME}` placeholders that resolve against this `.env`. Required keys at minimum:

- `NEXTAUTH_URL=https://observe.virtualcarhub.cloud`
- `NEXTAUTH_SECRET=<random secret>`
- `SALT=<random salt>`
- `DATABASE_URL=postgresql://...` (resolves to the langfuse-postgres container)
- `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`
- `REDIS_AUTH=<redis password>`
- `LANGFUSE_S3_*` for MinIO

For the canonical full list, see the upstream `.env.example` in https://github.com/langfuse/langfuse — VCH does not deviate from upstream env schema.

### 12.4 Deploy + Verify

```bash
cd /opt/agentops/langfuse/
docker compose up -d
docker compose ps              # all services should be Up + healthy
curl -s http://127.0.0.1:3000/api/public/health  # expected: {"status":"OK","version":"3.x.x"}
curl -sI https://observe.virtualcarhub.cloud      # expected: 200 via Caddy
```

### 12.5 Project Setup (Post-Deploy)

1. Open `https://observe.virtualcarhub.cloud` in a browser
2. Create org "VirtualCarHub"
3. Create project "vch-production"
4. Generate API keys (Public + Secret)
5. Distribute keys to all agent VPSs in `/etc/<agent>.env`:
   - `LANGFUSE_HOST=https://observe.virtualcarhub.cloud`
   - `LANGFUSE_PUBLIC_KEY=pk_...`
   - `LANGFUSE_SECRET_KEY=sk_...`

Verification: traces from each agent appear with correct tags (agent, mode, channel, agent_version, worker_vps).

---

## 13. GRAPHITI + NEO4J SETUP

VCH's production deployment uses **Graphiti backed by Neo4j 5.26**, running as three Docker containers. Graphiti supports Neo4j and FalkorDB equally — the choice is a driver/config flag rather than a fundamental architecture difference. Neo4j is the deployed VCH choice for tooling maturity reasons; the doc previously listed FalkorDB but production runs Neo4j.

### 13.1 Stack Components

Three containers, all running from `/root/graphiti/docker-compose.validation.yml` (note: the filename is vestigial — operator may rename to `docker-compose.yml` for clarity; the compose project label confirms this file is what's actually running):

| Container | Image | Loopback port | WG port | Purpose |
|---|---|---|---|---|
| `graphiti-neo4j` | `neo4j:5.26.0` | `127.0.0.1:7474, :7687` | — | Graph store (HTTP + Bolt) |
| `graphiti-rest` | `zepai/graphiti:latest` | `127.0.0.1:8001` | `10.50.0.1:8001` | REST API for skill scripts (Python via `graphiti-core`) |
| `graphiti-mcp` | `zepai/knowledge-graph-mcp:standalone` | `127.0.0.1:8002` | `10.50.0.1:8002` | MCP-compatible interface for OpenClaw MCPorter |

Both `graphiti-rest` and `graphiti-mcp` connect to `graphiti-neo4j` via Bolt (`bolt://neo4j:7687`) on the internal `graphiti-net` Docker network. Neo4j is not exposed beyond loopback — only the two Graphiti interfaces are.

### 13.2 Compose File

The actual deployment:

```yaml
# /root/graphiti/docker-compose.validation.yml

services:
  neo4j:
    image: neo4j:5.26.0
    container_name: graphiti-neo4j
    environment:
      - NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}
      - NEO4J_server_memory_heap_initial__size=512m
      - NEO4J_server_memory_heap_max__size=1G
      - NEO4J_server_memory_pagecache_size=512m
    ports:
      - "127.0.0.1:7474:7474"
      - "127.0.0.1:7687:7687"
    volumes:
      - graphiti_neo4j_data:/data
      - graphiti_neo4j_logs:/logs
    healthcheck:
      test: ["CMD", "wget", "-O", "/dev/null", "http://localhost:7474"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s
    networks: [graphiti-net]
    restart: unless-stopped

  graphiti-rest:
    image: zepai/graphiti:latest
    container_name: graphiti-rest
    env_file: [./server/.env]
    environment:
      - NEO4J_URI=bolt://neo4j:7687
    depends_on:
      neo4j: { condition: service_healthy }
    ports:
      - "127.0.0.1:8001:8000"
      - "10.50.0.1:8001:8000"
    networks: [graphiti-net]
    restart: unless-stopped

  graphiti-mcp:
    image: zepai/knowledge-graph-mcp:standalone
    container_name: graphiti-mcp
    env_file: [./mcp_server/.env]
    depends_on:
      neo4j: { condition: service_healthy }
    environment:
      - NEO4J_URI=bolt://neo4j:7687
      - CONFIG_PATH=/app/mcp/config/config.yaml
      - PATH=/root/.local/bin:${PATH}
    volumes:
      - ./mcp_server/config/config-docker-neo4j.yaml:/app/mcp/config/config.yaml:ro
    ports:
      - "127.0.0.1:8002:8000"
      - "10.50.0.1:8002:8000"
    command: ["uv", "run", "main.py"]
    networks: [graphiti-net]
    restart: unless-stopped

volumes:
  graphiti_neo4j_data:
  graphiti_neo4j_logs:

networks:
  graphiti-net:
    driver: bridge
```

### 13.3 Secrets

Two env files referenced by the compose:

- `/root/graphiti/server/.env` — graphiti-rest config (Neo4j password, OpenAI API key for entity extraction, etc.)
- `/root/graphiti/mcp_server/.env` — graphiti-mcp config (same Neo4j password, possibly different OpenAI key)

`${NEO4J_PASSWORD}` in the compose file resolves against the operator's shell env or a top-level `.env` file at `/root/graphiti/.env`. Set this before `docker compose up`.

### 13.4 Deploy + Verify

```bash
cd /root/graphiti/
docker compose -f docker-compose.validation.yml up -d
docker compose -f docker-compose.validation.yml ps

# Healthcheck the REST API (used by skill scripts)
curl http://127.0.0.1:8001/healthcheck
# Expected: {"status":"healthy"}

# From an agent VPS over WG (Danny, Negotiator)
curl http://mc-vps:8001/healthcheck
# Expected: {"status":"healthy"}
```

The MCP interface on port 8002 does NOT expose `/healthcheck` (different code path). Verify it via OpenClaw's MCP registry inspection (`openclaw mcp servers` from any spoke after MCP registration).

### 13.5 Schema

| Entity | Fields |
|---|---|
| `Buyer` | name, contact_id, preferences, history_summary |
| `Dealer` | name, dealer_id, reputation, primary_brand |
| `DealerContact` | name, role, decision_maker_score |
| `Vehicle` | vin, year, make, model, trim |
| `Deal` | deal_id, status, value |

Relations: `Buyer—INTERESTED_IN→Vehicle`, `Dealer—HAS_CONTACT→DealerContact`, `Buyer—NEGOTIATED_WITH→Dealer` (temporal), `Dealer—OWNS→Vehicle`, `Deal—INVOLVES→Buyer`, `Deal—INVOLVES→Dealer`.

Skills query via `graphiti-core` Python client pointed at `GRAPHITI_API_URL=http://mc-vps:8001` (per-agent `.env` file).

---

## 14. FLEET CONSOLE UI

Next.js fork of `builderz-labs/mission-control` with VCH customizations.

### 14.1 Authentication

NextAuth.js with magic-link email or SSO (operator preference — see OQ-V7-G).

### 14.2 Required Views

| View | Path | Purpose |
|---|---|---|
| Fleet Inventory | `/fleet` | Live VPS + agent status (queries `fleet_state` + worker_health) |
| Task Feed | `/tasks` | Recent dispatch across fleet; queue depths |
| Approval Queue | `/approvals` | Pending Lobster halts (queries `pending_approvals`) |
| HITL Tasks | `/hitl` | Pending and resolved HITL escalations |
| Per-Agent Activity | `/agents/[id]` | Drill into one agent's sessions |
| Skill Catalog Browser | `/skills` | Read SKILL.md content across fleet |
| Audit Log Viewer | `/audit` | Search `audit_log` and `openclaw_dispatch_log` |
| Trace Browser | `/traces` | Link to Langfuse with pre-filtered queries |
| Health Alerts | `/health` | Aggregated drift alerts from spoke admin agents |
| Operator Approvals Detail | `/approvals/[id]` | Approve/reject a specific Lobster halt |
| Operators | `/operators` | Manage operator users, pairing tokens, scopes |

### 14.3 Backend API Integration

Fleet console calls `/v1/admin-actions/*` with an operator-level token (separate from agent tokens; broader read scopes). UI also calls Langfuse API for trace embeds.

### 14.4 Approval UI Flow

1. Lobster workflow on MC halts at approval step
2. Returns `resumeToken` + preview JSON
3. Backend stores in `pending_approvals` table
4. Notification fires (Telegram via admin-mc-hub) with link to `/approvals/[id]`
5. Operator opens link, sees: who proposed, what changes, blast radius, rollback plan
6. Operator clicks Approve or Reject
7. Backend calls Lobster `resume` with token + decision
8. Workflow continues or aborts; `pending_approvals.resolved_at` updated

### 14.5 Real-Time Updates

WebSocket from console to backend for live state (fleet_state changes, new hitl_tasks, new pending_approvals).

---

## 15. admin-mc-hub AGENT (Includes Backend Administration)

The single unified administrator agent for the entire fleet. Owns fleet coordination AND all backend administration. Runs on MC.

### 15.1 Identity in openclaw.json

```json
{
  "id": "admin-mc-hub",
  "name": "admin-mc-hub",
  "workspace": "/root/.openclaw/workspace-admin-mc-hub",
  "agentDir": "/root/.openclaw/agents/admin-mc-hub",
  "model": {
    "primary": "openai/gpt-5.4-mini",
    "fallback": "openai/gpt-5.4-nano"
  },
  "subagents": {
    "maxConcurrent": 3,
    "delegationMode": "suggest",
    "model": "openai/gpt-5.4-nano"
  },
  "skills": [
    "vch-admin-fleet-inventory",
    "vch-admin-cross-vps-status",
    "vch-admin-pairing-token-issue",
    "vch-admin-approval-coordinate",
    "vch-admin-deploy-orchestrate",
    "vch-admin-incident-respond",
    "vch-admin-audit-aggregate",
    "vch-admin-backend-database-health",
    "vch-admin-backend-migration-status",
    "vch-admin-backend-audit-query",
    "vch-admin-backend-service-status",
    "vch-admin-backend-restart-service",
    "vch-admin-backend-env-verify",
    "vch-admin-backend-fleet-report",
    "vch-admin-secret-rotation-coordinate"
  ],
  "tools": {
    "deny": ["ghl_*", "marketcheck_*", "browser_use_*", "telnyx_*"]
  }
}
```

### 15.2 Workspace Layout

```
/root/.openclaw/workspace-admin-mc-hub/
├── AGENTS.md
├── SOUL.md
├── USER.md
├── IDENTITY.md
└── skills/
    ├── vch-admin-fleet-inventory/
    ├── vch-admin-cross-vps-status/
    ├── vch-admin-pairing-token-issue/
    ├── vch-admin-approval-coordinate/
    ├── vch-admin-deploy-orchestrate/
    ├── vch-admin-incident-respond/
    ├── vch-admin-audit-aggregate/
    ├── vch-admin-backend-database-health/
    ├── vch-admin-backend-migration-status/
    ├── vch-admin-backend-audit-query/
    ├── vch-admin-backend-service-status/
    ├── vch-admin-backend-restart-service/
    ├── vch-admin-backend-env-verify/
    ├── vch-admin-backend-fleet-report/
    └── vch-admin-secret-rotation-coordinate/
```

### 15.3 Persona Files

**`AGENTS.md`:**
```markdown
# admin-mc-hub Operating Instructions

You are the fleet-level administrator AND the backend administrator for VirtualCarHub. You are the operator's single point of conversation for all fleet operations and backend administration.

## What you do

### Fleet coordination
- Maintain live fleet inventory by aggregating reports from spoke admin agents
- Coordinate cross-VPS actions (rolling deploy: drain → deploy → verify → next VPS)
- Issue pairing tokens when new agent VPSs join the fleet
- Aggregate audit logs across the fleet into operator-facing summaries
- Respond to fleet-level incidents

### Backend administration (via HTTP to backend's /v1/admin-actions/* endpoints)
- Monitor database health (Postgres connection count, slow queries, table sizes)
- Check Alembic migration status
- Query the audit_log for the operator
- Monitor api.service and orchestrator.service health
- Coordinate service restarts (always requires operator approval via Lobster gate)
- Verify env var presence in backend services
- Coordinate service token rotation

## What you NEVER do

- You NEVER read or transmit buyer/dealer data
- You NEVER call the GHL MCP, MarketCheck MCP, Telnyx, or Browser Use
- You NEVER directly edit a spoke VPS's config — that's the spoke admin's job (you approve, they apply)
- You NEVER bypass spoke admin agents to take action on their VPSs
- You NEVER impersonate production agents (danny, negotiator)
- You NEVER auto-execute high-impact backend actions (service restart, secret rotation, token rotation) without operator approval

## How to behave

- Be the operator's single pane of glass
- When the operator asks "how's the fleet?", give them one paragraph + structured numbers
- When the operator asks about the backend specifically, call the appropriate /v1/admin-actions/* endpoint and report
- When a spoke surfaces a problem, you triage: handle locally, escalate to operator, or coordinate response
- Concise reports (under 200 words unless asked for detail)
- Always include numeric facts where available
- When proposing changes, always include rollback plan + blast radius
```

**`SOUL.md`:**
```markdown
# admin-mc-hub Persona

You are direct, factual, and operationally focused. You don't make small talk. You report what's true, surface what's anomalous, and propose what to do about it.

When you propose an action, you describe:
1. What the action is
2. Why it's needed
3. Blast radius if it goes wrong
4. Rollback plan

You don't apologize for surfacing problems. Problems unflagged are problems unsolved.

You are NOT a chatbot. You are an administrator. Talk like one.
```

**`USER.md`:**
```markdown
# Your User

The user is a VCH operator (typically Joe, the founder). Technically capable, high reasoning, prefers brief direct responses, wants facts and recommendations not hedging.

Access primarily via Telegram operator chat AND the fleet console web UI.
```

**`IDENTITY.md`:**
```markdown
# admin-mc-hub

Fleet administrator and backend administrator.

Emoji: 🎛️

Voice: terse, operational, fact-first.
```

### 15.4 Skill Catalog (15 Skills)

Each skill is a `SKILL.md` + optional `scripts/`. Frontmatter snippets and key Rules below. Full SKILL.md template in Doc 1 §3.5.

#### `vch-admin-fleet-inventory/SKILL.md`

```yaml
---
name: vch-admin-fleet-inventory
description: |
  Returns a live snapshot of all VPSs in the fleet — runtime status, queue
  depth, pending approvals, drift alerts, disk/memory. Calls backend
  /v1/admin-actions/fleet-state. Use when operator asks "how's the fleet?"
  or similar.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env: [VCH_BACKEND_URL, VCH_BACKEND_SERVICE_TOKEN]
---
```

Instructions: GET backend `/v1/admin-actions/fleet-state` → format as report with sections per VPS. Rules: redact any error messages containing potential secrets; if any VPS reports `runtime_status != "healthy"`, flag prominently.

#### `vch-admin-cross-vps-status/SKILL.md`

Polls each spoke admin agent (admin-danny, admin-negotiator) via OpenClaw inter-agent messaging for current local status. Aggregates and reports. Useful when fleet_state in DB might be stale.

#### `vch-admin-pairing-token-issue/SKILL.md`

**Lobster-wrapped.** Generates new pairing token for new VPS. Workflow:
1. Operator specifies new VPS name
2. Approval gate (operator confirms)
3. Generate token via OpenClaw gateway
4. Return token to operator out-of-band (do NOT post in chat)
5. Audit log

#### `vch-admin-approval-coordinate/SKILL.md`

Receives Tier 3 cross-approval requests from spoke admin agents (e.g., admin-danny proposes secret rotation that needs hub co-approval). Presents to operator, returns decision to spoke.

#### `vch-admin-deploy-orchestrate/SKILL.md`

**Lobster-wrapped.** Coordinates rolling deploy across fleet:
1. Drain spoke 1 (mark as draining; agent stops accepting new work)
2. Deploy new agent_version
3. Verify health
4. Undrain
5. Repeat for spoke 2, etc.

#### `vch-admin-incident-respond/SKILL.md`

Triages critical alerts surfaced by spoke admins. Decides: handle locally, escalate to operator, coordinate cross-fleet response.

#### `vch-admin-audit-aggregate/SKILL.md`

Rolls up `audit_log` + `openclaw_dispatch_log` into daily/weekly digest. On demand from operator.

#### `vch-admin-backend-database-health/SKILL.md`

```yaml
---
name: vch-admin-backend-database-health
description: |
  Check Postgres database health on the Backend VPS by calling
  /v1/admin-actions/health/postgres. Returns: connection count, slow
  queries, table sizes, replication. Use when operator asks about DB health
  or as part of daily digest.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env: [VCH_BACKEND_URL, VCH_BACKEND_SERVICE_TOKEN]
---
```

Instructions: GET `/v1/admin-actions/health/postgres` → format report.
Rules: NEVER include query contents (the endpoint redacts; this skill validates that and re-redacts if patterns slip through).

#### `vch-admin-backend-migration-status/SKILL.md`

Calls `/v1/admin-actions/migration-status`. Reports "in sync" or lists pending migrations.

#### `vch-admin-backend-audit-query/SKILL.md`

Calls `/v1/admin-actions/audit-query` with operator-specified filters. Returns paginated results. Rules: respect 100-row cap; require explicit confirm for >30-day queries.

#### `vch-admin-backend-service-status/SKILL.md`

Calls `/v1/admin-actions/health/api`, `/v1/admin-actions/health/orchestrator`, `/v1/admin-actions/service-status`. Reports active/inactive, uptime, recent logs.

#### `vch-admin-backend-restart-service/SKILL.md`

**Lobster-wrapped.** Workflow described in §17.1.

#### `vch-admin-backend-env-verify/SKILL.md`

Calls `/v1/admin-actions/env-verify`. Reports presence (not contents) of expected env vars.

#### `vch-admin-backend-fleet-report/SKILL.md`

Aggregates: backend service health + DB health + migration status + recent audit log summary + HITL queue depth + last 24h outbound count. Single comprehensive status report. Calls multiple other admin-backend-* skills as subroutines.

#### `vch-admin-secret-rotation-coordinate/SKILL.md`

**Lobster-wrapped.** Coordinates secret rotation:
- For agent VPS secrets (four-surface): coordinates with spoke admin (admin-danny or admin-negotiator)
- For backend service tokens: calls `/v1/admin-actions/rotate-service-token`
- For Langfuse keys, Telnyx keys, etc.: per-secret playbook

Workflow described in §17.2.

### 15.5 Channel Bindings

```bash
openclaw agents bind --agent admin-mc-hub --bind telegram:ops-chat
openclaw agents bind --agent admin-mc-hub --bind web:fleet-console
```

(Specific Telegram chat ID per OQ-V7-C; fleet-console web binding lets the UI invoke admin actions through the agent for richer interactions.)

---

## 16. LOBSTER WORKFLOWS ON MC

Lobster workflows that orchestrate cross-fleet or backend operations live on MC. They call backend HTTP endpoints for backend actions, OR call spoke admin agents for spoke-VPS actions.

### 16.1 `backend-service-restart.lobster`

```yaml
name: backend-service-restart
args:
  service_name:
    required: true                # "api" or "orchestrator"
  reason:
    required: true
steps:
  - id: pre_check
    pipeline: >
      openclaw.invoke --tool http-get --args-json
      '{"url":"http://backend-vps:8000/v1/admin-actions/service-status?service=${LOBSTER_ARG_SERVICE_NAME}","headers":{"X-Service-Token":"${VCH_BACKEND_SERVICE_TOKEN}"}}'

  - id: snapshot_logs
    pipeline: >
      openclaw.invoke --tool http-get --args-json
      '{"url":"http://backend-vps:8000/v1/admin-actions/health/${LOBSTER_ARG_SERVICE_NAME}","headers":{"X-Service-Token":"${VCH_BACKEND_SERVICE_TOKEN}"}}'

  - id: operator_approval
    approval:
      prompt: |
        Restart ${LOBSTER_ARG_SERVICE_NAME}.service on backend-vps?
        Reason: ${LOBSTER_ARG_REASON}
        Current status: $pre_check.json.sub_state, uptime $pre_check.json.uptime_seconds s
      preview-from-stdin: true
    stdin: $pre_check.json

  - id: restart
    pipeline: >
      openclaw.invoke --tool http-post --args-json
      '{"url":"http://backend-vps:8000/v1/admin-actions/restart-service","headers":{"X-Service-Token":"${VCH_BACKEND_SERVICE_TOKEN}"},"body":{"service":"${LOBSTER_ARG_SERVICE_NAME}","reason":"${LOBSTER_ARG_REASON}","approval_token":"$operator_approval.resumeToken"}}'
    when: $operator_approval.approved == true

  - id: post_verify
    pipeline: >
      openclaw.invoke --tool http-get --args-json
      '{"url":"http://backend-vps:8000/v1/admin-actions/health/${LOBSTER_ARG_SERVICE_NAME}","headers":{"X-Service-Token":"${VCH_BACKEND_SERVICE_TOKEN}"}}'
    when: $restart.success == true

  - id: notify_complete
    pipeline: openclaw.invoke --tool telegram-send --args-json '{...}'
    when: $post_verify.json.status == "healthy"
```

### 16.2 `backend-service-token-rotation.lobster`

Rotates a per-agent service token. Tier 3 — operator approval required.

```yaml
name: backend-service-token-rotation
args:
  agent_id:
    required: true
  reason:
    required: true
steps:
  - id: capture_current
    pipeline: openclaw.invoke --tool http-get --args-json '{"url":"http://backend-vps:8000/v1/admin-actions/service-token-info?agent_id=${LOBSTER_ARG_AGENT_ID}",...}'

  - id: operator_approval
    approval:
      prompt: |
        Rotate service token for ${LOBSTER_ARG_AGENT_ID}?
        Reason: ${LOBSTER_ARG_REASON}
        Current token age: $capture_current.json.age_days days
        New token will be issued; old token revoked after 24h grace.

  - id: rotate
    pipeline: openclaw.invoke --tool http-post --args-json '{"url":"http://backend-vps:8000/v1/admin-actions/rotate-service-token",...}'
    when: $operator_approval.approved

  - id: distribute_instructions
    pipeline: openclaw.invoke --tool telegram-send --args-json '{...with new token...}'
    when: $rotate.success
```

Note: The new token must be conveyed to the operator out-of-band (or via a secure channel) so they can update the target VPS's env file. Do NOT log the raw token in trace metadata.

### 16.3 `cross-fleet-deploy.lobster`

Rolling deploy across spokes. Drains, deploys, verifies, undrains. See §15.4 skill for caller; the workflow logic is in Lobster.

### 16.4 `secret-rotation-spoke.lobster`

Coordinates four-surface secret rotation on a spoke VPS. The actual rotation runs on the spoke (via its admin agent — admin-danny or admin-negotiator) using its own local Lobster workflow. This MC workflow is the cross-fleet coordinator:
1. Operator requests rotation
2. Hub approval (admin-mc-hub auto-approves if pre-authorized; otherwise asks operator)
3. Trigger spoke admin's local rotation workflow via inter-agent message
4. Wait for spoke completion
5. Verify (e.g., backend can still authenticate the new token)
6. Aggregate audit

---

## 17. MASTER PAIRING TOKEN MANAGEMENT

The master operator token (created in §10.2 via `openclaw pairing create-operator`) is stored in MC's secrets vault. Never logged. Used to issue scoped per-spoke pairing tokens.

### 17.1 Issuing a Spoke Pairing Token

On OpenClaw 2026.4.14, spoke pairing tokens are issued via `openclaw pairing`:

```bash
openclaw pairing create-node \
  --name "negotiator-vps-token" \
  --expires-in-days 30
# Token output: 64-hex string. Provide to spoke VPS operator out-of-band.
```

Spoke uses this token in its `gateway.remote.token` config setting (per Doc 4 §2.2). Pairing handshake consumes it; spoke is then identified by its node certificate in the `openclaw devices list` output as a row with role `node`.

### 17.2 Inspecting Pairing State

```bash
openclaw devices list
```

Shows all paired devices (operators + nodes) with roles, scopes, and last-seen IPs. This is the authoritative source — filesystem state at `/root/.openclaw/devices/paired.json` may diverge from the gateway's running state. Trust the CLI table output.

### 17.3 Rotation

Annual or on operator change. Re-pairs all spokes. Lobster-wrapped Tier 3 workflow (`secret-rotation-spoke.lobster` per §16.4).

---

## 18. MC ACCEPTANCE CRITERIA

| # | Criterion |
|---|---|
| MA-01 | WG mesh up; ping each spoke + backend by hostname |
| MA-02 | Caddy serves all configured public domains with valid TLS |
| MA-03 | `virtualcarhub.cloud` root loads fleet console |
| MA-04 | `observe.virtualcarhub.cloud` loads Langfuse |
| MA-05 | `virtualcarhub.cloud/gw` accepts WSS connections |
| MA-06 | OpenClaw gateway running: `systemctl is-active openclaw-gateway` and `openclaw-gateway-tunnel` both return `active`; `ss -tlnp` shows listeners on `127.0.0.1:18789` and `10.50.0.1:18789` |
| MA-07 | All spokes (danny, negotiator) paired and visible in `openclaw devices list` and fleet console |
| MA-08 | Master operator device created and stored in secrets vault (verified via `openclaw devices list` showing role `operator` with full scopes) |
| MA-09 | Langfuse project created; API keys distributed to agent VPSs |
| MA-10 | Graphiti reachable at `http://mc-vps:8001/healthcheck` from any WG VPS |
| MA-11 | Neo4j running (graphiti-neo4j container), bound to `127.0.0.1:7474, :7687` only |
| MA-12 | `admin-mc-hub` agent identity exists; visible in `openclaw agents list` |
| MA-13 | admin-mc-hub workspace has all persona files |
| MA-14 | All 15 admin-mc-hub skills present; each passes `openclaw skills inspect` |
| MA-15 | admin-mc-hub bound to telegram:ops-chat AND web:fleet-console |
| MA-16 | Fleet console: Fleet Inventory view shows live data from `fleet_state` |
| MA-17 | Fleet console: HITL Tasks view shows test escalation correctly |
| MA-18 | Fleet console: Approval Queue surfaces test Lobster halt |
| MA-19 | End-to-end: operator sends "admin-mc-hub: fleet status" via Telegram → admin-mc-hub responds with structured report |
| MA-20 | End-to-end: operator sends "admin-mc-hub: database health" → skill calls `/v1/admin-actions/health/postgres` → reports back |
| MA-21 | End-to-end: operator triggers `backend-service-restart.lobster` workflow → halts on approval → operator approves → backend service restarts → verified |
| MA-22 | End-to-end: Tier 3 secret rotation — spoke admin proposes → admin-mc-hub coordinates → operator approves → spoke executes → audit logged |
| MA-23 | All four backend admin skills (database-health, migration-status, audit-query, service-status) tested via Telegram operator commands |

---

## 19. OPEN QUESTIONS

| # | Question | Owner | Blocks |
|---|---|---|---|
| OQ-V7-A (carried) | OpenClaw `${ENV_VAR}` interpolation behavior on 2026.4.14 — whole-string-anchored. Verify via `jq` on spoke VPSs | Eng | Phase 3 |
| OQ-V7-C (carried) | Initial Telegram operator chat ID(s) | Joe | Phase 2 |
| OQ-V7-G | Fleet console authentication — NextAuth magic-link, SSO, or other? | Joe | MC Phase 14 |
| OQ-V7-H | Postgres deployment — managed (RDS/Supabase) or self-hosted on backend? | Joe | Phase 1 |
| OQ-V7-I | Redis for orchestrator job queue — on backend or separate? | Joe + Eng | Phase 1 |
| OQ-V7-J | Graphiti entity extraction model — gpt-5.4-nano sufficient? | Eng | Phase 1 |
| OQ-V7-K | Audit log retention — 90 days, 1 year, indefinite? | Joe | Operational |
| OQ-V7-L | Consumer frontend host — separate VPS or on MC? | Joe | Phase 1 |

---

## 20. ADDITIONAL CANONICAL REFERENCES

(Doc 1 §0.5 has the master list. These are additions for backend + MC work.)

- SQLAlchemy async patterns: https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
- Alembic async migrations: https://alembic.sqlalchemy.org/en/latest/cookbook.html#using-asyncio-with-alembic
- Pydantic v2 model validation: https://docs.pydantic.dev/latest/concepts/models/
- argon2-cffi: https://argon2-cffi.readthedocs.io
- Telnyx API reference: https://developers.telnyx.com/api
- NextAuth.js setup: https://next-auth.js.org/getting-started/introduction
- Caddy reverse proxy directive: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Langfuse self-host compose: https://github.com/langfuse/langfuse/blob/main/docker-compose.yml
- Graphiti Python client: https://github.com/getzep/graphiti
- Neo4j Python driver: https://neo4j.com/docs/python-manual/current/
- FalkorDB Python client (alternative backend): https://github.com/FalkorDB/falkordb-py
- Lobster workflow format: https://docs.openclaw.ai/tools/lobster

---

## 21. WHAT EACH SESSION DOES NEXT

After completing audit + delta plan + execution + acceptance verification:

1. Report completion with the acceptance criteria checklist
2. Coordinate cross-VPS: backend session unblocks agent VPS sessions (they need backend reachable + service tokens); MC session unblocks agent VPS sessions (they need to pair to gateway)
3. Stand by for cross-fleet integration testing (Phase 6 per Doc 1 §10)

---

**END OF VCH BACKEND + MISSION CONTROL IMPLEMENTATION v7**
