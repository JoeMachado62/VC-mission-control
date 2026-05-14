# VirtualCarHub Agent Fleet Plan — v4

**Version:** 4.0 | May 2026
**Supersedes:** Fleet Plan v3 (May 2026 working drafts), v2 (March 2026)
**Status:** Approved for build

This plan reflects the corrected architecture after auditing the existing VCH backend codebase, Mission Control deployment, and confirmed integration capabilities (Telnyx, GHL MCP, MarketCheck MCP). Earlier v3 drafts spec'd 14 custom MCP servers that do not exist; v4 replaces those with the real services already in the stack.

---

## 1. EXECUTIVE SUMMARY

VirtualCarHub deploys a **two-agent fleet**:

- **DannyAgent** — dual-mode (buyer-facing + admin-facing) conversational agent
- **NegotiatorAgent** — multi-channel pre-negotiator that prepares strategy reports, conducts dealer outreach, pre-negotiates within bounds, and hands off ready deals to human closers

Supported by:

- **Mission Control** (forked from `builderz-labs/mission-control`) — agent orchestration UI, webhook ingestion, widget service, deep links to traces. Already deployed.
- **Existing VCH Python/FastAPI backend** — deal state machine, matching engine, sourcing, audit, GHL integration. New additions: `agent_actions_service` (write-policy wrapper) and `Dealer` / `DealerContact` / `DealerGroup` tables.
- **Two real MCPs** — GHL MCP (already connected) and MarketCheck MCP (hosted by MarketCheck). Reads only.
- **Langfuse** — agent observability, co-located on Mission Control VPS. Already deployed.
- **Graphiti + FalkorDB** — shared cross-agent behavioral knowledge graph. Co-located on Mission Control VPS. Already deployed.

**This plan supersedes all v2 (11-agent) and v3 (fabricated MCP) architectures.**

### 1.1 Key Architectural Shifts From v3 Drafts

| v3 Draft Said | v4 Says | Why |
|---|---|---|
| 14 custom MCP servers (vch-crm, vch-pricing, etc.) | 2 real MCPs (GHL, MarketCheck) + backend HTTP endpoints | The custom MCPs don't exist; existing FastAPI backend already exposes everything needed |
| Agents call backend through MCP wrappers | Agents read GHL/MarketCheck via MCPs direct; write via backend HTTP (policy-enforced) | Hybrid pattern — fast reads, single policy layer for writes |
| Negotiator does autonomous auction bidding (Phase 2) | Humans always make offers/bids on auction platforms | Joe's call: VCH operates auctions manually |
| Quality Firewall as automated agent step | QF is human-gated via SourcingSupervisor | Quality judgments require human review; only objective disqualifiers stay automated |
| Auction browser automation via Playwright | No auction automation; humans operate auction platforms | Out of scope |
| Negotiator prospects aged inventory autonomously | Negotiator only works VINs assigned to it (deal-driven or human-assigned) | Reactive, not autonomous |
| Separate Graphiti VPS | Graphiti co-located on Mission Control VPS | Already deployed there |
| Audit MCP separate from backend | Backend's existing `audit_service.log_event()` handles audit; agents write GHL contact notes for narrative trail | Two audit systems was redundant |

### 1.2 Dual-Mode DannyAgent

Mode is determined entirely by entry point and authenticated identity at task ingestion — never by conversation content.

- **Buyer mode** — heavily constrained customer service agent invoked from website widget, GHL channels (chat/SMS/email/DM), and (Phase 2) public Telnyx number
- **Admin mode** — general-purpose AI employee for VCH operations team, invoked from Telegram admin bot, unpublished admin Telnyx number (CID + PIN), and Mission Control internal task creation

A buyer cannot escalate themselves into admin mode. An admin operating from authenticated channels never inadvertently triggers buyer-mode constraints.

### 1.3 NegotiatorAgent Scope

Reactive analyst + multi-channel pre-negotiator:

- **Analyst** — when a deal reaches `ACQUISITION_PENDING`, generates a vehicle-specific negotiation strategy report (market data + dealer intelligence + recommended approach)
- **Outreach** — multi-channel back-and-forth with dealers/sellers: email, SMS, dealer-website chat (via Browser Use). Voice deferred to Phase 2 with interim handoff to existing Telnyx voice agents via GHL task.
- **Pre-negotiation** — within the strategy report's defined range, autonomously counters and probes; out-of-range moves halt and escalate to SourcingSupervisor
- **Handoff** — when a deal is ready to close (right contact identified, terms in range, dealer engaged), creates a GHL task with full context for a human closer to take over

Negotiator never operates in admin mode and never speaks directly to end buyers.

---

## 2. SYSTEM TOPOLOGY

```
            ┌────────────────────────────┐         ┌──────────────────────┐
            │    BUYERS (Public)         │         │  ADMINS (VCH Ops)    │
            │  • Website widget          │         │  • Telegram bot      │
            │  • GHL channels (chat/SMS/ │         │  • Admin Telnyx #    │
            │    email/social DMs)       │         │    (CID + PIN)       │
            │  • Public Telnyx # (Phase2)│         │  • Mission Control   │
            └─────────┬──────────────────┘         └──────────┬───────────┘
                      │                                       │
                      ▼                                       ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │              GoHighLevel CRM (Conversation/Contact Backbone)     │
        │              VCH Deal Pipeline · Tasks · Workflows               │
        └────┬───────────────┬─────────────────────────────────────┬─────┘
             │               │                                     │
   ┌─────────┘               │                                     └─────────┐
   │                         │                                               │
   ▼                         ▼                                               ▼
 ┌──────────────────┐  ┌────────────────────────────────────┐    ┌─────────────────────┐
 │ VCH FastAPI      │  │ Mission Control VPS (existing)     │    │ External Services   │
 │ Backend          │◄─┤ Hostinger — co-located:            │    │  • GHL MCP plugin   │
 │ (existing)       │  │  • Mission Control (orchestration) │    │  • MarketCheck MCP  │
 │  • Deal SM       │  │  • Langfuse (observability)        │    │  • RouteOne         │
 │  • Matching Eng  │  │  • Graphiti + FalkorDB (shared mem)│    │  • Telnyx           │
 │  • Sourcing      │  │  • Caddy + TLS                     │    │  • Telegram Bot API │
 │  • Audit         │  │  • Webhook handlers                │    │  • Telnyx (admin #) │
 │  • GHLClient     │  │  • Widget service                  │    │                     │
 │  • NEW: dealer   │  │    (danny.virtualcarhub.com)       │    │                     │
 │    DB tables     │  └────────┬───────────────────────────┘    └────────┬────────────┘
 │  • NEW: agent-   │           │                                         │
 │    actions svc   │  ┌────────┴──────────┐                              │
 └────────┬─────────┘  │                   │                              │
          │            ▼                   ▼                              │
          │    ┌──────────────────────┐  ┌──────────────────────┐         │
          └───▶│ DannyAgent VPS       │  │ NegotiatorAgent VPS  │◄────────┘
               │ Hostinger KVM 4      │  │ Hostinger KVM 4      │
               │ OpenClaw runtime     │  │ OpenClaw runtime     │
               │ Dual-mode persona    │  │ Multi-channel role   │
               │ + Browser Use        │  │ + Browser Use        │
               │   (light use, e.g.   │  │   (dealer chat       │
               │   for admin browse)  │  │   widgets — primary) │
               └──────────────────────┘  └──────────────────────┘
                          │                   │
                          └─────────┬─────────┘
                                    │ OpenClaw Gateway protocol
                                    ▼
                       (back to Mission Control VPS)
```

### 2.1 Deployment Inventory

All four VPSs run on **Hostinger** (Joe's existing account). They are interconnected via a WireGuard hub-and-spoke overlay on `10.50.0.0/24` because Hostinger's public VPS API has no native private-network endpoint — see [`handoff/wireguard/README.md`](../handoff/wireguard/README.md). MC is the WireGuard hub.

| Component | Status | Hostinger Plan | Hostname | Public IPv4 | Tunnel IP |
|---|---|---|---|---|---|
| Mission Control + Langfuse + Graphiti + FalkorDB | **Already deployed** | KVM 4 (upgrades to KVM 8 at launch) | `VCH.Mission.Control` | `187.77.223.54` | `10.50.0.1` (hub) |
| DannyAgent VPS | Existing; agent install pending | KVM 4 | `danny.deal.advisor` | `187.77.207.153` | `10.50.0.2` |
| NegotiatorAgent VPS | Existing; agent install pending | KVM 4 | `vch.negotiator` (renamed from `dockside.pros`) | `167.88.39.177` | `10.50.0.3` |
| VCH FastAPI Backend | **Already deployed** | KVM 4 | `virtual.carhub` | `168.231.71.194` | `10.50.0.4` |
| Telnyx admin number + buyer number | **Already provisioned** | — | — | — | — |
| Telegram bot | New | — | n/a | n/a | n/a |

**Networking note:** Hostinger does not offer a native private subnet across VPSs, so v4 uses WireGuard for the overlay private network. UDP 51820 is opened in UFW on each VPS for the tunnel; agent gateway port (`18789`) is restricted to `10.50.0.0/24` (i.e., only over the tunnel). `/etc/hosts` on each VPS maps tunnel IPs to friendly names (`mc-vps`, `danny-vps`, `negotiator-vps`, `backend-vps`) so config files reference names, not IPs.

### 2.2 Entry Points & Mode Determination

| Entry Point | Default Mode | Auth | Notes |
|---|---|---|---|
| Website widget (`danny.virtualcarhub.com`) | Buyer | JWT (15-min TTL) issued by MC widget endpoint | Multiple "Ask Danny" buttons across site all open same widget |
| GHL inbound channels | Buyer | GHL contact ID | SMS, email, social DMs, GHL chat |
| Public Telnyx # (Phase 2) | Buyer | Caller ID | Provisioned but unused at MVP |
| Telegram admin bot | Admin (Tier 2) | Telegram user ID on allowlist | Primary admin channel — most admin requests come here |
| Admin Telnyx # | Admin (Tier 2 after PIN) | Caller ID allowlist + bcrypt PIN | Hands-free admin (driving). Unpublished number. |
| Mission Control internal | Admin (Tier 2) | MC user session | Task dispatch from MC dashboard |

**Two-number voice architecture** (admin separate from buyer): the admin number is unpublished. Separation eliminates PIN brute-force surface and contains routing-bug blast radius. ~$2/mo total — security/cost tradeoff is trivially favorable.

---

## 3. THE TWO AGENTS

Detailed PRDs in separate documents. High-level summaries here.

### 3.1 DannyAgent

**Identity:** Buyer mode = "Danny the buyer's advocate" — public-facing AI advisor. Admin mode = AI operations analyst for VCH team.

**Buyer-mode responsibilities:**
- Conversational interaction across website widget, GHL chat/SMS/email/DMs
- Match presentation with explainability
- Pricing transparency using MarketCheck data ("show your math")
- Process education
- Buyer-facing transport status (read from GHL custom fields fed by carrier integration)
- Preference dialogue and re-matching triggers
- Post-delivery satisfaction and 7-day return facilitation
- Structured information collection with confidence-scored extraction

**Buyer-mode hard limits:**
- Cannot quote unverified prices
- Cannot modify deal stage (state machine is backend-owned)
- Cannot give legal/financial/tax advice beyond scope
- Cannot escalate self into admin mode
- Cannot access admin-mode tools or data

**Admin-mode responsibilities:**
- Aggregate reports on demand (pipeline, agent stats, HITL trends)
- Broad GHL search via admin-tier read tools
- Cross-agent visibility (Negotiator status, trace inspection)
- Drafting outbound for human review and dispatch
- Dispatching tasks to buyer-Danny or Negotiator (Tier 2; PIN-gated)
- Hands-free voice query/response

**Admin-mode hard limits:**
- No mass outbound (campaign tools are separate)
- No GHL contact/deal deletion
- No deal stage modification
- No access to other agents' configs/prompts
- No financial credentials, RouteOne tokens, payment data

**Spec:** `01_DannyAgent_PRD_v4.md`

### 3.2 NegotiatorAgent

**Identity:** Internal multi-channel pre-negotiator + analyst. Sets the table for human closers. Never operates in admin mode. Never speaks to buyers.

**Responsibilities:**
- Analyst: vehicle-specific negotiation strategy reports (MarketCheck + dealer DB + Graphiti)
- Outreach: email + SMS + dealer-website chat (via Browser Use) for MVP
- Decision-maker discovery (find UCM/GSM at unfamiliar dealers)
- Pre-negotiation within strategy-report bounds
- Handoff to human closer via GHL task with full context
- Voice (Phase 2): interim via existing Telnyx voice agents triggered through GHL task

**Hard limits:**
- Cannot place bids/offers on auction platforms (humans use OVE/Manheim/OpenLane manually)
- Cannot move outside strategy-report range without HITL approval
- Cannot communicate with end buyers (any channel)
- Never operates in admin mode

**Spec:** `02_NegotiatorAgent_PRD_v4.md`

---

## 4. MISSION CONTROL ORCHESTRATION SERVICE

The forked `builderz-labs/mission-control` codebase. New code added under `src/orchestration/`.

### 4.1 What Mission Control Does

| Function | Purpose |
|---|---|
| State router | GHL deal-stage transitions → agent task creation (via OpenClaw Gateway) |
| Stall detector | Cron every 5 min; per-state SLA breach detection; creates HITL task |
| Health monitor | Cron every 60s; detects agent VPS offline beyond tolerance |
| Exception triage | Routes agent-raised exceptions to correct GHL human role with SLA |
| Cancellation router | Stage-aware refund rules; coordinates downstream unwind (RouteOne, Montway, etc.) |
| Webhook ingestion | GHL, RouteOne, Montway, Telegram, Telnyx admin |
| Widget service | JWT issuer + WebSocket bridge to buyer widget |
| Trace deep-links | Each task carries `langfuse_trace_id`; UI surfaces "View Trace" button |

### 4.2 Mission Control ↔ Agent Communication

Bidirectional traffic between Mission Control and agents flows over the **OpenClaw Gateway protocol**, not separate HTTP endpoints. This includes:
- Task assignment (MC → agent)
- Heartbeats (agent → MC)
- Task status updates and completion (agent → MC)
- Streaming output

There is no separate MC HTTP API for agents. External systems (GHL webhooks, widget chat, Telegram, Telnyx) reach MC via webhook endpoints; agents reach MC via the gateway.

### 4.3 Webhook Handlers

| Endpoint | Source | Purpose | MVP |
|---|---|---|---|
| `POST /api/webhooks/ghl` | GHL Workflows | Deal state changes, cancellations | Yes |
| `POST /api/webhooks/routeone` | RouteOne | Funding status updates | Yes |
| `POST /api/webhooks/carrier` | Transport carrier | Transport milestones | Yes |
| `POST /api/webhooks/telegram` | Telegram Bot API | Admin requests | Yes |
| `POST /api/webhooks/telnyx-voice-admin` | Telnyx Voice | Admin voice with CID + PIN | Yes |
| `POST /api/webhooks/telnyx-voice-buyer` | Telnyx Voice | Public voice line | Phase 2 |
| `POST /api/widget/token` | VCH website backend | Widget JWT issuance | Yes |
| `WS /api/widget/chat` | Browser widget | Bidirectional chat | Yes |

Common security: HMAC verification per source. Idempotency via payload hash + 5-min window.

### 4.4 Database Schema Additions

Mission Control runs on **better-sqlite3** with hand-written, numbered migrations in `src/lib/migrations.ts` (NOT Prisma). The v4 schema additions land as a single new migration appended to the existing migrations array. Conventions follow the precedent established by `051_observability_links` (`src/lib/migrations.ts:1432-1468`):

- IDs: `TEXT PRIMARY KEY` with cuid (or `crypto.randomUUID()`) generated in TypeScript at insert time — SQLite has no native cuid generator.
- Timestamps: `INTEGER NOT NULL DEFAULT (unixepoch())` — Unix epoch seconds.
- JSON: `TEXT DEFAULT '{}'` — JSON-encoded text.
- Booleans: `INTEGER NOT NULL DEFAULT 0|1` — SQLite has no boolean type.
- Index naming: `idx_<table>_<columns>` for grep-ability.

**Migration: `052_v4_vch_fields`** (insert before the closing `]` of the migrations array)

```typescript
{
  id: '052_v4_vch_fields',
  up(db: Database.Database) {
    // ─── New tables ─────────────────────────────────────────────────

    db.exec(`
      CREATE TABLE IF NOT EXISTS orchestration_events (
        id          TEXT PRIMARY KEY,
        event_type  TEXT NOT NULL,
        deal_id     TEXT,
        agent_id    TEXT,
        task_id     TEXT,
        payload     TEXT NOT NULL DEFAULT '{}',
        created_at  INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_orchestration_events_deal ON orchestration_events(deal_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_orchestration_events_type_created ON orchestration_events(event_type, created_at)`)

    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_heartbeats (
        id           TEXT PRIMARY KEY,
        agent_id     TEXT NOT NULL,
        status       TEXT NOT NULL,
        current_task TEXT,
        metrics      TEXT,
        received_at  INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_agent_received ON agent_heartbeats(agent_id, received_at)`)

    db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id           TEXT PRIMARY KEY,
        source       TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload      TEXT NOT NULL DEFAULT '{}',
        processed    INTEGER NOT NULL DEFAULT 0,
        received_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(source, payload_hash)
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_events_received ON webhook_events(received_at)`)

    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_allowlist (
        id           TEXT PRIMARY KEY,
        channel      TEXT NOT NULL,
        identifier   TEXT NOT NULL,
        display_name TEXT NOT NULL,
        pin_hash     TEXT,
        active       INTEGER NOT NULL DEFAULT 1,
        UNIQUE(channel, identifier)
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS widget_sessions (
        id          TEXT PRIMARY KEY,
        visitor_id  TEXT NOT NULL,
        contact_id  TEXT,
        page_source TEXT NOT NULL,
        vehicle_id  TEXT,
        deal_id     TEXT,
        jwt_jti     TEXT NOT NULL UNIQUE,
        issued_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at  INTEGER NOT NULL,
        revoked     INTEGER NOT NULL DEFAULT 0
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_widget_sessions_visitor ON widget_sessions(visitor_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_widget_sessions_expires ON widget_sessions(expires_at)`)

    db.exec(`
      CREATE TABLE IF NOT EXISTS pin_attempts (
        id           TEXT PRIMARY KEY,
        identifier   TEXT NOT NULL,
        success      INTEGER NOT NULL,
        attempted_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pin_attempts_identifier_at ON pin_attempts(identifier, attempted_at)`)

    // ─── Existing tasks table — v4 field additions ──────────────────
    //
    // langfuse_trace_id is intentionally NOT added here. The
    // observability_links table from migration 051 already provides
    // task → trace joins with richer metadata (trace_health, cost_usd,
    // latency_ms, prompt_name/version, model_provider/name, etc.).
    // Use observability_links for trace lookup; do not denormalize
    // onto tasks.

    db.exec(`ALTER TABLE tasks ADD COLUMN deal_id TEXT`)
    db.exec(`ALTER TABLE tasks ADD COLUMN exception_category TEXT`)
    db.exec(`ALTER TABLE tasks ADD COLUMN mode TEXT NOT NULL DEFAULT 'buyer'`)
    db.exec(`ALTER TABLE tasks ADD COLUMN admin_identity TEXT`)
    db.exec(`ALTER TABLE tasks ADD COLUMN admin_auth_tier INTEGER`)
    db.exec(`ALTER TABLE tasks ADD COLUMN intent_thread_id TEXT`)
    db.exec(`ALTER TABLE tasks ADD COLUMN allowed_tools TEXT`)

    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_deal ON tasks(deal_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_mode ON tasks(mode)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_intent_thread ON tasks(intent_thread_id)`)
  }
}
```

**Column semantics:**

| Table.column | Type | Semantics |
|---|---|---|
| `tasks.mode` | TEXT NOT NULL DEFAULT `'buyer'` | One of `'buyer'`, `'admin'`, `'wholesale'`. Set explicitly by orchestration at task creation; default applies to legacy rows on migration. |
| `tasks.admin_auth_tier` | INTEGER NULL | `1` = read-only admin, `2` = PIN-verified admin. NULL for non-admin tasks. |
| `tasks.allowed_tools` | TEXT (JSON array) | JSON-encoded array of tool names. Agent runtime filters its registered tool surface to this subset before sending to the LLM. |
| `tasks.intent_thread_id` | TEXT NULL | Stable thread key (e.g., `req_paystub_2026Q1`) — backend `agent_actions_service` uses it for per-thread rate limits (Danny PRD §9). |
| `tasks.deal_id` | TEXT NULL | VCH deal identifier from FastAPI backend. Indexed for stall/exception queries. |
| `tasks.exception_category` | TEXT NULL | When task is an exception escalation (HITL), the category tag. |
| `tasks.admin_identity` | TEXT NULL | Telegram user id or Telnyx CID at admin task creation. |
| `widget_sessions.jwt_jti` | TEXT UNIQUE | Single-use JTI; prevents JWT replay. |
| `webhook_events.source/payload_hash` | UNIQUE pair | Idempotency dedup key for inbound webhooks (5-min window enforced in handler logic). |
| `agent_heartbeats` | (time-series) | One row per heartbeat (15s for Danny, 30s for Negotiator). Existing `agents.last_seen` stays as the fast-path summary; this table is for SLA monitoring and Fleet Health dashboard. |

**Notes for implementers:**

- The existing `observability_links` table (migration 051) already joins `tasks.id → langfuse_trace_id` with rich metadata. Trace lookups read from that table; orchestration code populates it on task creation.
- All `id` columns use `TEXT PRIMARY KEY` per Prisma intent. Generate IDs in TypeScript with `crypto.randomUUID()` or the `cuid` package — match whichever pattern other TEXT-PK tables in this codebase already use.
- `tasks.id` is `INTEGER` (autoincrement), so the `task_id` references inside `orchestration_events` are intentionally typed as `TEXT` to allow flexibility (string-form references, including non-MC task IDs from the OpenClaw gateway). Cast or join in application code.
- The Prisma snippets that previously appeared in this section are preserved in version control; no information has been lost — only the implementation form has changed to match MC's actual stack.

### 4.5 Widget Token Issuance

`POST /api/widget/token` (HMAC-signed by website backend; secret `WEBSITE_WIDGET_SECRET`):

Request:
```json
{
  "visitor_id": "<anonymous cookie>",
  "page_source": "homepage|vdp|checkout|post_delivery|other",
  "contact_id": "<GHL contact id, if known>",
  "deal_id": "<deal id, if known>",
  "vehicle_id": "<VIN or listing id, if VDP>"
}
```

Response: JWT (HS256, 15-min TTL) with claims `{sub, visitor_id, contact_id, page_source, deal_id, vehicle_id, mode:"buyer", allowed_actions, exp, iat, jti}`. Stored as `WidgetSession` row. Widget polls revocation endpoint every 60s.

### 4.6 Telegram Handler Flow

```
1. Webhook to /api/webhooks/telegram
2. Verify X-Telegram-Bot-Api-Secret-Token
3. Lookup from.id in AdminAllowlist where channel='telegram', active=true
4. Not allowed → silently drop (no response — don't confirm bot existence)
5. Allowed → create OpenClaw task for Danny with mode='admin', admin_auth_tier=2,
   channel='telegram', payload={chat_id, text, attachments}
6. Danny processes; response routed back via Telegram Bot API
```

### 4.7 Admin Voice Handler Flow

```
1. Telnyx webhook → /api/webhooks/telnyx-voice-admin
2. Verify Telnyx-Signature-ed25519 + Telnyx-Timestamp headers (Ed25519, not HMAC)
3. Lookup From in AdminAllowlist where channel='telnyx-voice', active=true
4. Not allowed → TeXML <Reject reason="busy"/> (do not confirm number)
5. Allowed → "Welcome, please enter your PIN" (DTMF capture)
6. bcrypt.compare(input, pin_hash); record to PinAttempt
7. 3 failures in 1h → 1h lockout + Ops alert
8. Success → create OpenClaw task for Danny with mode='admin', admin_auth_tier=2,
   channel='telnyx-voice'
9. Voice loop: STT → Danny → TTS → loop until <Hangup/>
```

PIN management: 4–6 digit numeric, bcrypt-hashed. Per-admin. Rotation via MC settings.

### 4.8 Configuration

```bash
# Existing in MC
GHL_API_BASE_URL, GHL_API_TOKEN, GHL_WEBHOOK_SECRET, GHL_LOCATION_ID
ROUTEONE_*, MONTWAY_* (or carrier equivalent)
OPENAI_API_KEY  # for MC's own exception summaries
LANGFUSE_*

# VCH backend integration
VCH_BACKEND_URL=https://api.virtualcarhub.com
VCH_BACKEND_SERVICE_TOKEN=<X-Service-Token value>

# Widget
WEBSITE_WIDGET_SECRET=<HMAC>
WIDGET_JWT_SECRET=<HS256 key>
WIDGET_JWT_TTL_MINUTES=15
WIDGET_PUBLIC_URL=https://danny.virtualcarhub.com

# Telegram
TELEGRAM_BOT_TOKEN=<from BotFather>
TELEGRAM_WEBHOOK_SECRET=<X-Telegram-Bot-Api-Secret-Token>

# Telnyx (admin number)
TELNYX_API_KEY                  # REST API key (single key — Telnyx has no SID/auth-token split)
TELNYX_PUBLIC_KEY               # Ed25519 public key for webhook signature verification
TELNYX_ADMIN_NUMBER=<E.164>
TELNYX_BUYER_NUMBER=<E.164>     # Phase 2; provisioned at MVP, unused
TELNYX_TTS_VOICE=<Polly.Joanna or ElevenLabs id>

# Speech (admin voice)
WHISPER_API_KEY  # reuses OPENAI_API_KEY or separate
```

### 4.9 Acceptance Criteria

| ID | Criteria |
|---|---|
| MC-01 | GHL state-change webhook → correct OpenClaw task assignment within 2s |
| MC-02 | Stall detection creates HITL exception within 5 min of SLA breach |
| MC-03 | Agent offline detection within tolerance + 60s |
| MC-04 | Cancellation at any stage triggers correct stage-appropriate downstream unwind |
| MC-05 | OFAC hit → OperationsAdmin GHL task within 15 min |
| MC-06 | Webhook idempotency on duplicate payload (5-min window) |
| MC-07 | Widget token endpoint mints valid 15-min JWT with HMAC-verified request |
| MC-08 | Telegram non-allowlisted user silently dropped |
| MC-09 | Telegram allowlisted user → admin Danny task created |
| MC-10 | Telnyx admin unallowlisted CID → TeXML Reject |
| MC-11 | Telnyx admin allowlisted CID + correct PIN → Tier 2 admin task |
| MC-12 | 3 failed PINs in 1h → 1h lockout + Ops alert |

---

## 5. VCH BACKEND ADDITIONS

The existing FastAPI backend already exposes the endpoints agents need for matching, pricing, sourcing, and audit. v4 adds two pieces:

### 5.1 New `agent_actions_service`

Path: `backend/app/services/agent_actions_service.py`
HTTP routes mounted at: `/v1/agent-actions/*`
Auth: `X-Service-Token` (existing agent service token pattern)

This service is the **policy enforcement layer** for any GHL or contact-affecting write originating from an agent. It wraps the existing `GHLClient` and adds:

- Field-level allowlists (which GHL custom fields can agents write?)
- Topic-aware rate limits via `intent_thread_id` (no spam-bombing the same buyer)
- Loop detector (same tool same params 3+ times in 60s halts agent)
- Per-mode/per-tier authorization checks
- Auto-call to existing `audit_service.log_event()` on every write

Endpoints:

```
POST /v1/agent-actions/send-sms
  Body: {contact_id, body, intent_thread_id, agent_id, mode}
  Enforces: per-thread limits, per-contact 24h ceiling, loop detection
  Calls: GHLClient.send_sms internally; audit_service.log_event

POST /v1/agent-actions/send-email
  Body: {contact_id, subject, body, intent_thread_id, agent_id, mode}
  Same enforcement as send-sms

POST /v1/agent-actions/add-contact-note
  Body: {contact_id, note, agent_id, mode}
  Calls: GHLClient.add_contact_note; audit_service.log_event

POST /v1/agent-actions/update-contact-custom-field
  Body: {contact_id, field, value, intent_thread_id, agent_id, mode, justification?}
  Field allowlist enforced (see Danny PRD §7.3)
  Admin-mode writes require justification field

POST /v1/agent-actions/create-task
  Body: {role, title, description, sla_minutes, payload, deal_id?}
  HITL escalation creation in GHL — task assigned to human role

POST /v1/agent-actions/send-dealer-email
  Body: {dealer_id, subject, body, deal_thread_id, agent_id}
  Negotiator-only; per-(dealer_id, vin) deal_thread state machine enforced
  Per-dealer 24h ceiling: 5 msgs
  Global Negotiator 24h ceiling: 200 msgs

POST /v1/agent-actions/send-dealer-sms
  Body: {dealer_id, body, deal_thread_id, agent_id}
  Same enforcement as send-dealer-email

POST /v1/agent-actions/close-deal-thread
  Body: {dealer_id, deal_thread_id, status}
  Status: won | lost | dealer_unresponsive | escalated | withdrawn

POST /v1/agent-actions/report-extraction
  Body: {field, value, confidence, source_text_hash, contact_id, decision}
  Logs structured extraction event for calibration analysis (see Danny PRD §10)
```

Backing tables (Alembic migration):

```python
# backend/app/models/agent_actions.py
class IntentThread(Base):
    id: str
    contact_id: str
    thread_key: str  # e.g., "req_paystub_2026Q1"
    attempts: int
    status: str  # open | satisfied | escalated | dismissed
    opened_at: datetime
    closed_at: datetime | None
    # unique on (contact_id, thread_key)

class DealerThread(Base):
    id: str
    dealer_id: str
    vin: str
    deal_thread_id: str
    attempts: int
    last_attempt_at: datetime | None
    status: str  # open | won | lost | dealer_unresponsive | escalated | withdrawn
    # unique on (dealer_id, vin)

class OutboundLog(Base):
    id: str
    agent_id: str
    contact_id: str | None
    dealer_id: str | None
    channel: str  # sms | email
    intent_thread_id: str | None
    deal_thread_id: str | None
    message_id: str  # GHL message ID
    sent_at: datetime
```

### 5.2 New Dealer Database

Path: `backend/app/models/dealer.py` + Alembic migration

```python
class Dealer(Base):
    id: str
    name: str
    dba_name: str | None
    address_line1: str
    city: str
    state: str
    zip: str
    primary_phone: str | None
    primary_email: str | None
    website_url: str | None
    dealer_group_id: str | None  # FK to DealerGroup
    dealer_license_number: str | None
    license_state: str | None
    source: str  # 'uploaded' | 'marketcheck_stub' | 'manual'
    notes: str | None  # free text
    created_at: datetime
    updated_at: datetime

class DealerContact(Base):
    id: str
    dealer_id: str  # FK
    full_name: str
    role: str  # 'UCM' | 'GSM' | 'Salesperson' | 'Receptionist' | 'Owner' | 'Other'
    direct_phone: str | None
    mobile_phone: str | None
    direct_email: str | None
    verified_at: datetime | None
    verified_by: str | None  # agent_id or human user id
    notes: str | None

class DealerGroup(Base):
    id: str
    name: str  # AutoNation, Lithia, etc.
    notes: str | None

# Negotiator + admin Danny read access via:
#   GET /v1/dealers/{id}
#   GET /v1/dealers/search?...
#   GET /v1/dealers/{id}/contacts
#   GET /v1/dealer-groups/{id}
# Writes via Negotiator (after decision-maker discovery):
#   POST /v1/dealers/{id}/contacts (add a verified contact)
#   PATCH /v1/dealers/{id} (update notes, verified data)
```

Initial population:
1. Bulk import script for Joe's existing dealer databases (script TBD based on format)
2. Stub-creation logic when Negotiator encounters unfamiliar dealer (pulled from MarketCheck dealer payload data); `source='marketcheck_stub'`
3. Promotion to `source='manual'` when human or Negotiator verifies a contact within the dealer

### 5.3 Existing Backend Endpoints (Used by Agents)

These are already in the codebase and used as-is:

```
# Matching
POST /v1/matching/run/{buyer_id}
GET  /v1/matching/results/{buyer_id}

# Inventory & pricing
GET  /v1/inventory/search
GET  /v1/inventory/{id}
GET  /v1/inventory/{id}/payment-estimate
GET  /v1/me/recommendations

# Sourcing (existing)
POST /v1/sourcing/{deal_id}/bid
POST /v1/sourcing/{deal_id}/dealer-outreach
POST /v1/sourcing/{deal_id}/confirm-acquisition

# Audit (existing)
GET  /v1/admin/audit-log
GET  /v1/admin/exceptions
GET  /v1/admin/deals
GET  /v1/admin/deals/{id}

# State machine (existing — humans only via /override-state)
POST /v1/admin/deals/{id}/override-state
```

### 5.4 Quality Firewall — What Stays Automated, What's Human

The existing `quality_firewall_pass` boolean column on `Vehicle` stays. It's computed at ingestion against **objective disqualifier rules only**:

- Clean title (not salvage, flood, rebuilt)
- No structural-damage flags from CarFax/AutoCheck
- No odometer-rollback flags
- VIN decode succeeds

These are pass/fail with no judgment. They stay automated.

**Human-gated (via SourcingSupervisor):**
- Condition grade interpretation
- Ownership history concerns (3+ owners, fleet vehicles, etc.)
- Pricing sanity checks beyond basic comparable matching
- Geographic/transport feasibility
- Anything Negotiator's strategy report flags as worth a human look

Negotiator's strategy report surfaces these as flags. SourcingSupervisor reviews before any deal advances or any offer is made.

---

## 6. AGENT TOOLING — REAL SERVICES ONLY

### 6.1 What Agents Connect To

| Service | How | Read or Write | Notes |
|---|---|---|---|
| GHL MCP | Hosted plugin at `/root/plugins/ghl-crm/` (existing) connecting to `services.leadconnectorhq.com/mcp/` | **Reads only** | 253 tools available; agents register only the read-tool subset with their LLM |
| MarketCheck MCP | Hosted at `https://api.marketcheck.com/mcp?api_key=...` | **Reads/data only** | Standard tools: search, decode, history, predict_price, etc. |
| VCH backend `/v1/*` (existing endpoints) | HTTP, `X-Service-Token` auth | Read | matching, inventory, pricing, audit, sourcing reads |
| VCH backend `/v1/agent-actions/*` (NEW) | HTTP, `X-Service-Token` auth | **All writes** | Policy enforcement layer |
| VCH backend `/v1/dealers/*` (NEW) | HTTP, `X-Service-Token` auth | Read; Negotiator may write contacts | Dealer DB |
| Browser Use (browser-use.com OSS library) | Python library on agent VPS | Browser automation | Negotiator: dealer chat widgets. Danny: occasional admin browse if needed. |
| Telnyx | Already provisioned for voice/SMS/MMS/fax | Existing voice agents handle Negotiator's voice work in MVP via GHL task handoff | Phase 2: native integration |

### 6.2 No Custom MCP Servers

There are no `vch-*-mcp` servers in v4. Every function the v3 drafts assigned to a custom MCP is now:

- A read against GHL MCP (for buyer/dealer/conversation data)
- A read against MarketCheck MCP (for vehicle/market data)
- An HTTP call against the existing or newly-added VCH backend endpoints
- A Browser Use action (for chat widget operation)

### 6.3 Tool Registration with the LLM

Each agent's runtime decides which tools to expose to its LLM via OpenAI function calling. The exposed set is a **policy-checked subset**, not the raw MCP surface. Example for buyer-mode Danny:

- From GHL MCP, expose: `get_contact`, `get_conversation_thread`, `search_contacts`, `get_opportunity` (about 6-8 read tools — not the full 253)
- From MarketCheck MCP, expose: `search_active_cars`, `predict_price_with_comparables`, `decode_vin_neovin`, `get_car_history` (read tools used in workflows)
- From backend HTTP, expose wrapped tools: `send_buyer_sms`, `send_buyer_email`, `update_buyer_field`, `create_hitl_task`, `add_contact_note`, `report_extraction`, `trigger_match_run`, `get_match_results`, `get_payment_estimate`, etc.

Each task type carries an `allowed_tools` list. Agent runtime filters its registered tool set to that subset before sending to the LLM. Defense in depth at agent layer; backend agent-actions endpoints also enforce the policy as a second layer.

---

## 7. INFRASTRUCTURE & DEPLOYMENT

### 7.1 Hostinger + WireGuard

All four VPSs are already running on Hostinger (see §2.1). Provisioning is therefore complete; what remains is configuring the WireGuard overlay and bootstrapping the agent runtimes on Danny + Negotiator.

**Verify VPSs are running** (Hostinger MCP from MC VPS, or REST API directly):

```bash
# From MC VPS:
curl -fsS -H "Authorization: Bearer $HOSTINGER_API_TOKEN" \
  https://developers.hostinger.com/api/vps/v1/virtual-machines | \
  jq '.[] | {id, hostname, plan, state, ipv4: .ipv4[0].address}'
```

**WireGuard hub-and-spoke setup** — apply per [`handoff/wireguard/README.md`](../handoff/wireguard/README.md):

1. Apply `wg0-mc.conf` on MC (hub) — enables IP forwarding, listens on UDP 51820.
2. Apply `wg0-danny.conf` on Danny (spoke).
3. Apply `wg0-negotiator.conf` on Negotiator (spoke).
4. Apply `wg0-backend.conf` on the FastAPI backend VPS (spoke).
5. Add `/etc/hosts` mappings on all four VPSs.
6. Verify `wg show` and ping each tunnel IP from the hub.

**Operator paste-and-run scripts** for Danny / Negotiator / Backend live in `handoff/wireguard/apply-*.sh`. Each script: installs WireGuard, drops the right `wg0.conf`, sets hostname, opens UDP 51820 in UFW, brings up the tunnel, configures `/etc/hosts`. ~5 min total operator effort.

No public ports are opened on agent VPSs other than UDP 51820 (WireGuard) and SSH (operator access; can be locked to operator's static IP if needed).

### 7.2 Domain Setup (existing + new)

| Domain | Points To | Purpose | Status |
|---|---|---|---|
| `app.virtualcarhub.com` | Existing website | Public site | Existing |
| `api.virtualcarhub.com` | VCH FastAPI backend | Backend API | Existing |
| `mc.virtualcarhub.com` | Mission Control VPS | Ops dashboard | Existing |
| `traces.virtualcarhub.com` | Mission Control VPS (Langfuse) | Observability | Existing |
| `danny.virtualcarhub.com` | Mission Control VPS (widget service) | Buyer chat widget | New (DNS + Caddy) |

### 7.3 Deployment Phases

| Phase | Scope | Duration |
|---|---|---|
| **1. Backend additions** | `agent_actions_service` + dealer DB tables + Alembic migration + dealer DB import script | 1 week |
| **2. Mission Control orchestration** | State router, stall detector, health monitor, exception triage, cancellation router (if not already in MC fork) | 1 week |
| **3. Mission Control admin entry points + widget** | Telegram handler, admin Telnyx handler, widget JWT issuer, widget WS bridge, AdminAllowlist + WidgetSession + PinAttempt tables | 4 days |
| **4. DannyAgent VPS** | Provision, install OpenClaw, register with MC, configure tools, persona blocks, run buyer-mode and admin-mode acceptance tests | 1.5 weeks |
| **5. NegotiatorAgent VPS** | Provision, install OpenClaw + Browser Use, persona, dealer DB integration, strategy report workflow, outreach workflows | 1.5 weeks |
| **6. End-to-end staging test** | Full deal cycle (buyer → match → select → fund → acquisition → delivery) + admin-mode test scenarios + Negotiator strategy + outreach test | 4 days |
| **7. Production cutover** | DNS, first real lead, first real admin command | 1 day |

**Total: ~5.5 weeks** from Phase 1 start to production.

---

## 8. OBSERVABILITY (REFERENCE)

Full spec in `08_Observability_Architecture_v2.md`. Summary:

- Langfuse already deployed at `traces.virtualcarhub.com`
- Every agent task = one root trace
- Tags: `agent:danny|negotiator`, `mode:buyer|admin|wholesale`, `channel:*`, `admin_auth_tier:1|2`, `intent_thread_id:*`
- Mission Control task UI surfaces "View Trace" button via `langfuse_trace_id` field
- Dashboards: Fleet Health, Buyer-mode, Admin-mode, Wholesale-mode, Rate Limits, Extraction Calibration, Cost
- Tier-2 admin actions audit-logged with full detail; alert on each
- Existing Prometheus + Loki + Grafana stack handles backend infrastructure observability (separate from Langfuse, complementary)

---

## 9. SECURITY & COMPLIANCE

- HMAC verification on all webhook endpoints
- Agent ↔ MC over WireGuard tunnel only (10.50.0.0/24); UDP 51820 is the only inbound port allowed publicly per agent VPS
- Buyer PII stays inside VCH backend + GHL
- Existing `audit_service.log_event()` is the immutable record-of-truth (write-once)
- GHL contact notes are the human-readable narrative trail
- Untrusted-content rule: all buyer messages, GHL notes, dealer correspondence, document text wrapped in fenced tags before reaching prompts; never executed as instructions
- Admin-mode dual-channel: Telegram (user ID inherently authenticated) + Telnyx admin (CID + bcrypt PIN)
- Tier-2 admin actions (any write or task dispatch) require Tier-2 auth
- Widget JWT 15-min TTL; revocation polling every 60s
- No agent has direct write access to financial credentials, RouteOne tokens, payment data
- OFAC screening continues at QUALIFIED state via existing automation (already in v2 architecture and codebase)

---

## 10. OPEN QUESTIONS

| # | Question | Owner | Required By |
|---|---|---|---|
| OQ-V4-01 | Format and size of Joe's existing dealer databases for import script | Joe | Phase 1 |
| OQ-V4-02 | Initial Telegram admin allowlist (Joe + ?) | Joe | Phase 3 |
| OQ-V4-03 | Initial Telnyx admin allowlist + PIN seed | Joe | Phase 3 |
| OQ-V4-04 | STT provider for admin voice (Whisper API, Telnyx Voice Intelligence, Deepgram) | Joe + Eng | Phase 3 |
| OQ-V4-05 | TTS voice for admin voice (Polly, ElevenLabs Danny voice) | Joe | Phase 3 |
| OQ-V4-06 | Negotiator strategy-report HITL threshold for "out-of-range" detection (specific dollar tolerance vs. percentage gap) | Joe | Phase 5 |
| OQ-V4-07 | Voice handoff Phase 2 build provider — Telnyx native AI vs. GHL AI Studio vs. third-party (Bland AI, Vapi, etc.) | Joe + Eng | Phase 2 build |
| OQ-V4-08 | Browser Use vs. Browserbase vs. Lux (OAGI) for chat widget operation — MVP recommendation is Browser Use; revisit at scale | Eng | Phase 5 + Phase 2 retrospective |

---

## 11. APPENDIX A — DEAL STATE MACHINE (Existing)

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

State transitions are owned by VCH backend (`deal_service.transition_deal_state`). MC reads transitions and routes; never modifies state directly. Cancellation router calls backend state machine API.

---

## 12. APPENDIX B — ROLE MATRIX

| Component | Owns Deal State? | Owns Tasks? | Talks to Buyers? | Talks to Dealers? | Talks to Admins? |
|---|---|---|---|---|---|
| GHL CRM | Reflects | Owns HITL tasks | Yes (templated workflows) | Yes (dealer Contact records) | No |
| VCH Backend | **Owns state** | No | No | No | No |
| Mission Control | No (reads state) | **Owns agent tasks** | No (mediates widget) | No | No (mediates) |
| DannyAgent (buyer) | No | Consumes | **Yes** | No | No |
| DannyAgent (admin) | No | Consumes + dispatches | No | No | **Yes** |
| NegotiatorAgent | No | Consumes | No | **Yes** | No |
| Website | Reflects state | No | Yes (UI surfaces) | No | No |

---

## 13. APPENDIX C — MIGRATION FROM v2/v3 DOCS

For teams that began against v2 PRDs or v3 working drafts:

1. **Archive (do not delete):** v2 PRD agent files and v3 working drafts → `archive/`
2. **Authoritative going forward:** v4 documents only
3. **Code already written for v2 agents:** OrchestratorAgent code → port to MC orchestration. MatchingAgent → matching engine stays as backend service; Danny absorbs explainability writing. SourcingAgent → reframe as Negotiator (narrower scope, no auction automation). DealOpsAgent / DMSAgent / LogisticsAgent / FundingAgent / etc. → all stay as backend services and integrations; no agent shell.
4. **Custom MCP server scaffolds in v3 drafts:** discard. Replace with backend HTTP endpoints under `/v1/agent-actions/*`.

---

**END OF FLEET PLAN v4**
