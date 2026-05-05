# OrchestratorAgent — OpenClaw Instance PRD

**Agent ID:** `orchestrator`
**Version:** 1.0 | March 2026
**OpenClaw Role:** `agent-main` (gateway-scoped — sees all boards, not board-scoped)
**VPS Tier:** Full (4 vCPU / 16GB RAM)

---

## 1. PURPOSE

The OrchestratorAgent is the central coordination brain of VirtualCarHub. It does NOT
interact with buyers or execute deal operations directly. Instead, it monitors the entire
deal pipeline, routes work to the correct agent via Mission Control tasks, detects stalled
deals, handles cancellations, and ensures every deal progresses through the state machine
without getting stuck.

Think of it as a dispatch controller — it watches everything and tells each agent when
to act.

---

## 2. OPENCLAW INSTANCE CONFIGURATION

### 2.1 Gateway Configuration

```yaml
# ~/.openclaw/config.yaml
gateway:
  port: 18789
  bind: 0.0.0.0  # Accessible to Mission Control IP only (firewall rule)
  auth:
    mode: token
    token_file: ~/.openclaw/gateway.token
  session:
    default_key: "agent:orchestrator:main"
```

### 2.2 Multi-Model Configuration (GPT-5.4 Family)

This agent uses different GPT-5.4 models depending on task complexity. OpenClaw supports
per-task model routing — the AGENTS.md system prompt instructs the agent which model to
use for each operation.

```yaml
models:
  provider: openai
  api_key_env: OPENAI_API_KEY

  # NANO — heartbeats, event acknowledgment, simple status checks
  nano:
    model_id: gpt-5.4-nano
    max_tokens: 512
    reasoning:
      effort: none
    use_for:
      - heartbeat_response
      - event_acknowledgment
      - agent_status_check
      - simple_state_lookup

  # MINI — routine routing decisions, stall detection, SLA checks
  mini:
    model_id: gpt-5.4-mini
    max_tokens: 2048
    reasoning:
      effort: low
    use_for:
      - deal_state_routing
      - stall_detection
      - cancellation_routing
      - agent_health_evaluation
      - webhook_event_processing

  # FULL — exception triage, complex coordination, AI-generated summaries
  full:
    model_id: gpt-5.4
    max_tokens: 4096
    reasoning:
      effort: high
    use_for:
      - exception_triage_and_summary
      - cross_agent_coordination_planning
      - cancellation_refund_calculation
      - hitl_escalation_summary_generation
```

**Model Selection Rationale:**
- **Nano** handles ~70% of this agent's work (heartbeats, acks, simple lookups) at $0.20/1M
  input tokens — keeping costs minimal for high-frequency operations.
- **Mini** handles routing decisions that require reading deal state and applying rules
  — structured enough for mini but needs basic reasoning.
- **Full with high reasoning** is reserved for exception triage where the agent must read
  a deal's full audit trail, assess severity, and generate a human-readable summary.

### 2.3 Heartbeat Configuration

```yaml
heartbeat:
  interval_seconds: 30
  missing_tolerance: 120
```

This agent has the second-fastest heartbeat (DannyAgent is fastest at 15s). It must be
responsive because it processes every deal state transition.

---

## 3. AGENT PERSONA & SYSTEM PROMPT

### 3.1 AGENTS.md Workspace File

```markdown
# OrchestratorAgent — VirtualCarHub Fleet Controller

## Identity
You are the OrchestratorAgent for VirtualCarHub, a virtual automotive brokerage. You are
the central dispatch controller for a fleet of 5 specialized AI agents. You do NOT interact
with buyers. You do NOT execute deal operations. You route work, detect problems, and
coordinate handoffs.

## Core Responsibilities
1. DEAL ROUTING: When a deal state changes, determine which agent owns the next action
   and create a Mission Control task on the correct board.
2. STALL DETECTION: Monitor all active deals. If any deal stays in the same state beyond
   its SLA window, create a P1 exception task.
3. AGENT HEALTH: Monitor heartbeats of all 5 worker agents. Alert if any goes offline.
4. CANCELLATION: When a buyer cancels, determine the stage-appropriate refund path and
   coordinate with DealOpsAgent if lender unwind is needed.
5. EXCEPTION TRIAGE: When any agent flags an exception, assess severity, route to the
   correct human role, and log an AI-generated summary.
6. CROSS-AGENT HANDOFFS: When a deal needs sequential work from multiple agents
   (e.g., FUNDED → SourcingAgent → ACQUIRED → LogisticsAgent), broadcast the sequence.

## Decision Rules

### Deal State Routing Table
When a deal transitions to a new state, create a task for the owning agent:

| New State | Create Task For | Board | Priority |
|-----------|----------------|-------|----------|
| PRE_QUALIFYING | DealOpsAgent | Deal Operations | P2 |
| QUALIFIED | DealOpsAgent | Deal Operations | P2 |
| ENGAGED | (no task — frontend-driven intake) | — | — |
| PROFILED | MatchingAgent | Buyer Experience | P2 |
| MATCHING | (MatchingAgent already owns) | — | — |
| VEHICLE_SELECTED | DealOpsAgent | Deal Operations | P1 |
| FUNDING | DealOpsAgent | Deal Operations | P1 |
| ACQUISITION_PENDING | SourcingAgent | Deal Operations | P1 |
| ACQUIRED | LogisticsAgent (transport) + DealOpsAgent (title) | Fulfillment + Deal Ops | P1 |
| IN_TRANSIT | LogisticsAgent | Fulfillment | P2 |
| DELIVERED | (GHL workflow handles post-delivery comms) | — | — |
| RETURN_PENDING | LogisticsAgent | Fulfillment | P1 |
| EXCEPTION | Triage → correct human role | Exception Queue | P0 |
| CLOSED_WON | DealOpsAgent (title completion) | Deal Operations | P3 |
| CLOSED_LOST | (log + archive) | — | — |

### SLA Windows (Stall Detection)
| State | Max Duration Before Stall Alert |
|-------|---------------------------------|
| PRE_QUALIFYING | 48 hours |
| QUALIFIED | 72 hours |
| ENGAGED | 7 days |
| PROFILED | 4 hours (matching should be fast) |
| MATCHING | 7 days (buyer browsing) |
| VEHICLE_SELECTED | 24 hours (funding should start immediately) |
| FUNDING | 7 days |
| ACQUISITION_PENDING | 5 days |
| ACQUIRED | 48 hours (carrier should be booked quickly) |
| IN_TRANSIT | 14 days (coast-to-coast max) |

### Cancellation Routing
| Current State | Refund Action | Coordination Needed |
|---------------|---------------|---------------------|
| LEAD through ENGAGED | Full deposit refund | None |
| PROFILED through FUNDING | Full deposit refund | None |
| ACQUISITION_PENDING | Full refund if bid not placed; partial if bid active | SourcingAgent |
| ACQUIRED | Partial refund minus acquisition costs | DealOpsAgent (lender unwind) |
| IN_TRANSIT | Partial refund minus acquisition + transport | LogisticsAgent + DealOpsAgent |
| DELIVERED | Must use 7-day return process instead | DannyAgent → LogisticsAgent |

## What You Must NEVER Do
- Never communicate with buyers directly
- Never override deal state without logging the reason
- Never skip HITL escalation when rules require it
- Never create tasks for agents that are offline (escalate to human instead)
```

---

## 4. MCP SERVER REQUIREMENTS

### 4.1 vch-crm-mcp

**Purpose:** Read/write deal data in GHL and VCH backend.

| Tool | Parameters | Returns | When Used |
|------|-----------|---------|-----------|
| `get_deal(deal_id)` | deal_id: string | Deal object with current state, stage, timestamps | Every routing decision |
| `get_active_deals()` | filters: {state?, stale_since?} | Array of deal summaries | Stall detection (runs every 5 min) |
| `update_deal_stage(deal_id, new_stage, reason)` | deal_id, new_stage: DealState, reason: string | Updated deal | State transitions |
| `create_ghl_task(contact_id, title, description, assignee_role)` | contact_id, title, description, assignee_role | GHL task ID | HITL escalations |
| `get_contact(contact_id)` | contact_id: string | Contact record | Cancellation processing |

### 4.2 vch-audit-mcp

**Purpose:** Immutable audit trail for all orchestration actions.

| Tool | Parameters | Returns | When Used |
|------|-----------|---------|-----------|
| `log_event(event_type, deal_id, agent_id, payload)` | event_type: string, deal_id: string, agent_id: string, payload: object | Event ID | Every action |
| `get_audit_trail(deal_id)` | deal_id: string, limit?: number | Array of AuditEvent | Exception triage (review deal history) |
| `get_agent_activity(agent_id, since)` | agent_id: string, since: datetime | Activity log | Agent health review |

### 4.3 mc-api-mcp (NEW — wraps Mission Control REST API)

**Purpose:** Create/manage tasks on Mission Control boards; monitor agent health.

| Tool | Parameters | Returns | When Used |
|------|-----------|---------|-----------|
| `create_task(board_id, title, description, priority, assigned_agent)` | board_id, title, description, priority: P0-P3, assigned_agent | Task ID | Deal routing |
| `get_agent_status(agent_id)` | agent_id: string | {online, last_heartbeat, current_task} | Health monitoring |
| `get_all_agent_statuses()` | — | Array of agent statuses | Periodic health check |
| `broadcast_to_board(board_id, message)` | board_id, message: string | Broadcast ID | Cross-agent coordination |
| `create_approval_request(board_id, title, description, approver_role)` | board_id, title, description, approver_role | Approval request ID | HITL escalations |

### 4.4 routeone-webhook-mcp

**Purpose:** Consume RouteOne status callbacks that arrive at VCH backend.

| Tool | Parameters | Returns | When Used |
|------|-----------|---------|-----------|
| `get_pending_routeone_events()` | since?: datetime | Array of RouteOne status events | Polling for funding updates |
| `acknowledge_routeone_event(event_id)` | event_id: string | Confirmation | After processing |

---

## 5. TASK TYPES THIS AGENT PROCESSES

The OrchestratorAgent is gateway-scoped, meaning it does not receive tasks on a specific
board. Instead, it runs continuous monitoring loops and reacts to events.

### 5.1 Continuous Monitoring Loops

| Loop | Frequency | Action |
|------|-----------|--------|
| Webhook Event Processing | On each GHL/RouteOne webhook | Parse event → determine state transition → route to correct agent |
| Stall Detection | Every 5 minutes | Query active deals → check against SLA windows → create P1 tasks for stalled deals |
| Agent Health Check | Every 60 seconds | Query all agent statuses → alert if any agent offline > tolerance |
| Exception Queue Review | Every 2 minutes | Check for new exceptions → triage → route to correct human role |

### 5.2 Event-Driven Actions

| Trigger | Source | Action |
|---------|--------|--------|
| GHL webhook: state change | VCH backend `/webhooks/ghl` | Route to correct agent per routing table |
| RouteOne webhook: funding status | VCH backend `/webhooks/routeone` | Notify DealOpsAgent; update VCH deal state |
| Agent creates EXCEPTION | Any agent via MC task | Triage severity; route to human; log summary |
| Buyer cancellation request | DannyAgent via MC task | Determine refund path; coordinate agents |
| Agent goes offline | MC health check | Alert Operations Admin; hold tasks for that agent |

---

## 6. HITL ESCALATIONS THIS AGENT CREATES

| ID | Trigger | Human Role | SLA | GHL Task Details |
|----|---------|-----------|-----|------------------|
| HITL-11 | Deal stalled beyond SLA | Operations Admin | Daily review | Title: "[STALLED] Deal #{deal_id} in {state} for {duration}" |
| Cancellation routing | Buyer cancels post-acquisition | Deal Desk | 4 biz hours | Title: "[CANCEL] Deal #{deal_id} — stage-aware refund needed" |
| Agent offline | Worker agent heartbeat missing | Operations Admin | 30 minutes | Title: "[AGENT DOWN] {agent_name} offline since {timestamp}" |

---

## 7. DEPENDENCIES

| Dependency | Required Before Deploy | Status |
|------------|----------------------|--------|
| Mission Control VPS running | Yes | Setup required |
| VCH Backend API live at known URL | Yes | Backend exists; needs deployment |
| GHL webhook endpoint configured | Yes | `/webhooks/ghl` exists in backend |
| RouteOne webhook endpoint configured | Yes | Needs new `/webhooks/routeone` endpoint |
| All 5 worker agents registered in MC | No (can start without them) | Deploy incrementally |

---

## 8. ACCEPTANCE CRITERIA

| # | Criteria | How to Verify |
|---|---------|---------------|
| AC-01 | Agent starts and registers heartbeat with Mission Control | MC dashboard shows OrchestratorAgent as "online" |
| AC-02 | GHL webhook triggers correct routing | Send test webhook with state=PROFILED; verify MC task created for MatchingAgent |
| AC-03 | Stall detection fires correctly | Create deal stuck in FUNDING for 8 days; verify P1 task appears on Exception Queue |
| AC-04 | Agent offline detection works | Stop DannyAgent VPS; verify alert created within 2 minutes |
| AC-05 | Cancellation at ACQUIRED state routes correctly | Trigger cancellation on ACQUIRED deal; verify tasks created for DealOpsAgent (lender unwind) |
| AC-06 | All actions logged to audit trail | Check audit log after any routing action; verify event exists |
| AC-07 | EXCEPTION triage creates GHL task for correct human role | Create OFAC-hit exception; verify GHL task targets Operations Admin with 15-min SLA |

---

## 9. PHASE 2 ENHANCEMENTS (NOT IN MVP)

- Auto-scaling DannyAgent instances based on concurrent session count
- Predictive stall detection (ML model trained on deal velocity patterns)
- Automated deal health scoring (composite metric across all deal attributes)
- Cross-deal pattern detection (same buyer, same vehicle, fraud signals)
