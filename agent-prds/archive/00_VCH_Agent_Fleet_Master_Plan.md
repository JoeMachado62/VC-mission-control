# VirtualCarHub — Agent Fleet Master Plan

**Version 1.0 | March 2026**
**For use alongside the VCH Backend Codebase and OpenClaw Mission Control**

> **PURPOSE:** This document is the single reference for all VCH agents — their roles,
> responsibilities, inter-agent communication patterns, MCP tool dependencies, HITL escalation
> points, infrastructure topology, and deployment order. It is designed to be reviewed alongside
> the actual VCH backend codebase to identify what functionality already exists (and should be
> called by agents) versus what must be built new.

---

## TABLE OF CONTENTS

1. [Agent Fleet Overview](#1-agent-fleet-overview)
2. [Infrastructure Topology](#2-infrastructure-topology)
3. [Mission Control Board Structure](#3-mission-control-board-structure)
4. [Agent Specifications](#4-agent-specifications)
   - 4.0 OrchestratorAgent
   - 4.1 InboundAgent
   - 4.2 QualificationAgent
   - 4.3 IntakeAgent
   - 4.4 DannyAgent
   - 4.5 MatchingAgent
   - 4.6 FundingAgent
   - 4.7 SourcingAgent
   - 4.8 NegotiatorAgent
   - 4.9 DMSAgent
   - 4.10 LogisticsAgent
   - 4.11 CommunicationAgent
   - 4.12 ReturnAgent
   - 4.13 ComplianceAgent
   - 4.14 B2CMarketingAgent
   - 4.15 B2BMarketingAgent
   - 4.16 DealIntelligenceAgent
5. [Inter-Agent Communication Map](#5-inter-agent-communication-map)
6. [MCP Server Registry](#6-mcp-server-registry)
7. [HITL Escalation Registry](#7-hitl-escalation-registry)
8. [Deal Lifecycle — Agent Ownership by State](#8-deal-lifecycle--agent-ownership-by-state)
9. [Deployment Order & Dependencies](#9-deployment-order--dependencies)
10. [Open Questions for Codebase Review](#10-open-questions-for-codebase-review)

---

## 1. AGENT FLEET OVERVIEW

VCH operates 17 distinct agent roles across 5 functional domains. Each agent runs on its own
dedicated VPS with its own OpenClaw installation and gateway, managed centrally from Mission Control.

### Agent Roster — Quick Reference

| # | Agent | Domain | Role Type | VPS Tier | Primary Function |
|---|-------|--------|-----------|----------|-----------------|
| 0 | OrchestratorAgent | Core | agent-main | Full (4/16) | Fleet coordination, deal routing, stall detection, cancellation handling |
| 1 | InboundAgent | Sales | agent-worker | Light (2/8) | First contact on all channels; lead capture; route to qualification |
| 2 | QualificationAgent | Sales | agent-worker | Light (2/8) | Credit pre-screening; income verification; qualify/disqualify decision |
| 3 | IntakeAgent | Sales | agent-worker | Full (4/16) | Guides buyer through Quick Match (5-step) and Full Profile (24-step) intake |
| 4 | DannyAgent | Sales | agent-worker | Full (4/16) | Buyer-facing conversational AI; deal status; recommendations; escalation (multiple instances) |
| 5 | MatchingAgent | Sales | agent-worker | Full (4/16) | Runs BFV scoring against 50K+ inventory; generates ranked recommendations |
| 6 | FundingAgent | Deal Ops | agent-worker | Full (4/16) | Lender routing; credit app tracking; doc collection; terms presentation; GO signal |
| 7 | SourcingAgent | Deal Ops | agent-worker | Full (4/16) | Auction bidding; dealer partner inventory check; Quality Firewall execution |
| 8 | NegotiatorAgent | Deal Ops | agent-worker | Full (4/16) | Dealer-specific price negotiation; counter-offer management; PO generation |
| 9 | DMSAgent | Deal Ops | agent-worker | Full (4/16) | Document generation; e-signing; title case management; compliance docs |
| 10 | LogisticsAgent | Fulfillment | agent-worker | Full (4/16) | Carrier quotes; transport booking; delivery tracking; delivery checklist |
| 11 | CommunicationAgent | Fulfillment | agent-worker | Full (4/16) | All scheduled/event-driven buyer comms; Danny persona for outbound messages |
| 12 | ReturnAgent | Fulfillment | agent-worker | Light (2/8) | 7-day return flow; return transport; condition inspection; refund processing |
| 13 | ComplianceAgent | Governance | agent-worker | Light (2/8) | OFAC screening; FTC compliance checks; document retention audits |
| 14 | B2CMarketingAgent | Marketing | agent-worker | Full (4/16) | TikTok catalog; GHL campaigns; Danny Dollar referrals; Equity Alerts; SEO feeds |
| 15 | B2BMarketingAgent | Marketing | agent-worker | Light (2/8) | Dealer partner recruitment; onboarding; aged inventory alerts; relationship maintenance |
| 16 | DealIntelligenceAgent | Analytics | agent-worker | Light (2/8) | DealOutcome analysis; learning loops; margin optimization; pattern detection |

**VPS Tiers:** Full = 4 vCPU / 16GB | Light = 2 vCPU / 8GB (OpenClaw minimum spec)

---

## 2. INFRASTRUCTURE TOPOLOGY

### Design Principle

Each OpenClaw agent runs on its own dedicated VPS with its own OpenClaw installation and gateway.
Mission Control connects to each gateway via outbound WebSocket. Agents never communicate directly
with each other — all coordination flows through Mission Control's board/task/broadcast system.

```
                    ┌─────────────────────────────────────┐
                    │        MISSION CONTROL VPS           │
                    │   8 vCPU / 32GB — No agents here    │
                    │   FastAPI + Next.js + PG + Redis    │
                    │                                     │
                    │   Outbound wss:// to each gateway   │
                    └──────────┬──────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
    ┌─────┴─────┐       ┌─────┴─────┐       ┌─────┴─────┐
    │ Agent VPS │       │ Agent VPS │       │ Agent VPS │  ... x17
    │ OpenClaw  │       │ OpenClaw  │       │ OpenClaw  │
    │ GW :18789 │       │ GW :18789 │       │ GW :18789 │
    └───────────┘       └───────────┘       └───────────┘

    ┌─────────────────────────────────────────────────────┐
    │              VCH BACKEND SERVER                      │
    │   8 vCPU / 32GB — FastAPI + Celery + Redis          │
    │   PostgreSQL (RDS) + ElastiCache (Redis)            │
    │   The actual VCH application — agents call its API  │
    └─────────────────────────────────────────────────────┘
```

### Network Rules

- Each agent VPS exposes port 18789 (wss://) to Mission Control IP only
- Mission Control initiates all WebSocket connections — agents never connect to MC directly
- Agent VPS instances do NOT communicate with each other — all coordination via MC boards
- All agents call the VCH Backend API and external APIs (GHL, MarketCheck, etc.) over HTTPS
- MCP servers run locally on each agent VPS, calling external APIs as needed

### Cost Estimate

| Component | Count | Spec | Monthly |
|-----------|-------|------|---------|
| Mission Control | 1 | 8 vCPU / 32GB | ~$48-96 |
| VCH Backend | 1 | 8 vCPU / 32GB | ~$48-96 |
| Full-tier agents | 11 | 4 vCPU / 16GB | ~$264-528 |
| Light-tier agents | 6 | 2 vCPU / 8GB | ~$72-144 |
| **Total** | **19** | | **~$430-860/mo** |

Scale by adding Danny/Negotiator instances (+$24-48 each).

---

## 3. MISSION CONTROL BOARD STRUCTURE

### Board Groups and Boards

```
Board Group: Sales Pipeline
  ├── Board: Inbound & Qualification
  │   ├── InboundAgent (worker)
  │   └── QualificationAgent (worker)
  ├── Board: Buyer Experience
  │   ├── IntakeAgent (worker)
  │   ├── DannyAgent x N (workers)
  │   └── MatchingAgent (worker)
  └── Board Lead: SalesPipelineLead (coordinates sales agents)

Board Group: Deal Operations
  ├── Board: Funding Pipeline
  │   └── FundingAgent (worker)
  ├── Board: Sourcing & Acquisition
  │   ├── SourcingAgent (worker)
  │   └── NegotiatorAgent (worker)
  ├── Board: Documents & Title
  │   └── DMSAgent (worker)
  └── Board Lead: DealOpsLead (coordinates deal ops agents)

Board Group: Fulfillment
  ├── Board: Logistics & Delivery
  │   └── LogisticsAgent (worker)
  ├── Board: Buyer Communications
  │   └── CommunicationAgent (worker)
  ├── Board: Returns
  │   └── ReturnAgent (worker)
  └── Board Lead: FulfillmentLead (coordinates fulfillment agents)

Board Group: Marketing
  ├── Board: B2C Ads & Social
  │   └── B2CMarketingAgent (worker)
  ├── Board: B2B Partner Development
  │   └── B2BMarketingAgent (worker)
  └── Board Lead: MarketingLead (coordinates marketing agents)

Board Group: Governance & Analytics
  ├── Board: Compliance & Screening
  │   └── ComplianceAgent (worker)
  ├── Board: Deal Intelligence
  │   └── DealIntelligenceAgent (worker)
  ├── Board: Exception Queue (cross-cutting — any agent can create tasks here)
  └── Board Lead: GovernanceLead (coordinates governance agents)

Top Level:
  └── OrchestratorAgent (agent-main — gateway-scoped, not board-scoped)
```

---

## 4. AGENT SPECIFICATIONS

Each specification below defines what the agent does, not how it's implemented in code.
During the codebase review session, each section should be checked against existing VCH backend
endpoints, Celery tasks, and GHL workflows to determine what the agent calls vs. what must be built.

---

### 4.0 OrchestratorAgent

**Role:** `agent-main` (gateway-scoped)
**VPS Tier:** Full (4 vCPU / 16GB)
**Heartbeat:** `interval_seconds: 30, missing_tolerance: 120`

**Primary Responsibilities:**
1. **Deal State Routing** — On every GHL webhook state transition, determine which agent owns the
   next action and create a task on the appropriate board
2. **Stall Detection** — Monitor all active deals; if any deal remains in the same state beyond
   its SLA, create a P1 task on the Exception Queue board
3. **Agent Health Monitoring** — Track heartbeats of all agents via Mission Control SSE stream;
   alert if any agent goes offline
4. **Cancellation Handling** — Process buyer cancellation requests (CancellationAgent function per
   PRD Section 21.2); determine stage-appropriate refund and route accordingly
5. **Exception Triage** — When any agent creates an EXCEPTION state, assess severity, route to
   correct human role, and create GHL task with AI-generated summary
6. **Cross-Agent Coordination** — Broadcast messages to board leads when a deal requires
   sequential handoffs (e.g., FUNDED → SourcingAgent → acquired → LogisticsAgent)
7. **Agent Token Management** — Renew short-lived MCP service tokens (5-minute expiry per PRD
   Section 16.1) for all agents

**MCP Servers Required:**
- `vch-audit-mcp` — log orchestration events, read audit trail
- `vch-crm-mcp` — read deal state, update opportunity stage, create GHL tasks
- `ghl-native-mcp` — webhook consumption, task creation for human roles
- `mc-api-mcp` (new) — Mission Control API client for agent status, board tasks, broadcasts

**HITL Escalations This Agent Creates:**
- HITL-11: Deal stalled beyond SLA → Operations Admin daily review
- HITL-12: Buyer escalation via Danny → Ops Admin / Deal Desk (2 biz hours)
- Stage-appropriate cancellation routing (Section 21)

**Key Decision: What Already Exists in VCH Backend?**
- Does the VCH backend already have a `/webhooks/ghl` endpoint that processes state transitions?
- Is there existing Celery task logic for deal routing that this agent should call vs. replace?
- Are SLA timers already implemented in the backend, or does the Orchestrator need to own timing?

---

### 4.1 InboundAgent

**Role:** `agent-worker`
**VPS Tier:** Light (2 vCPU / 8GB)
**Heartbeat:** `interval_seconds: 30, missing_tolerance: 120`
**Board:** Inbound & Qualification

**Primary Responsibilities:**
1. **Lead Capture** — Process all inbound contacts: web form submissions, chat initiations,
   SMS/call inbound (via Telnyx), social DMs (Phase 2)
2. **Lead Scoring** — Apply initial lead score based on source, engagement signals, and
   completeness of submitted information
3. **Route to Qualification** — If lead score >= threshold, transition to PRE_QUALIFYING and
   create task for QualificationAgent
4. **Distress/Legal Detection** — Scan inbound messages for distress language, legal threats,
   or explicit human-request phrases; escalate immediately
5. **GHL Contact Creation** — Create Contact record in GHL with source attribution, UTM tags,
   and initial stage = Lead
6. **Welcome Sequence Enrollment** — Ensure new leads are enrolled in GHL Lead Welcome Sequence

**MCP Servers Required:**
- `vch-crm-mcp` — create contact, update contact, add note, send SMS/email
- `ghl-native-mcp` — enroll in workflow, create task
- `vch-audit-mcp` — log lead capture event
- `telnyx-mcp` (if voice/SMS inbound handling is agent-side vs. GHL-side)

**Trigger:** GHL webhook `contact.created` or `conversation.inbound_message`

**Key Decision: What Already Exists in VCH Backend?**
- Does the VCH backend `/webhooks/ghl` already handle contact creation and lead scoring?
- Is lead scoring a backend function or should the agent own it?
- How does Telnyx integrate — does GHL handle voice/SMS natively, or does VCH backend receive
  Telnyx webhooks at `/webhooks/telnyx`?

---

### 4.2 QualificationAgent

**Role:** `agent-worker`
**VPS Tier:** Light (2 vCPU / 8GB)
**Heartbeat:** `interval_seconds: 30, missing_tolerance: 120`
**Board:** Inbound & Qualification

**Primary Responsibilities:**
1. **Credit Pre-Screening** — Initiate soft-pull via lender pre-qual API; evaluate
   credit score against minimum threshold
2. **Income Verification** — Review submitted income documentation; flag inconsistencies
3. **Geographic Eligibility** — Verify buyer is within VCH's serviceable area (FL initially;
   configurable)
4. **Qualification Decision** — QUALIFIED (soft pull returns approvable range or proof of funds
   confirmed) or DISQUALIFIED (with reason code)
5. **Pre-Disqualification Hold** — Per HITL-10, all disqualifications are held for Deal Desk
   review within 24 business hours before the buyer is notified
6. **Deposit & Service Agreement Trigger** — On QUALIFIED, initiate service agreement via
   DMSAgent and deposit collection

**MCP Servers Required:**
- `vch-funding-mcp` — submit credit app, get lender terms
- `vch-crm-mcp` — update contact, update opportunity stage
- `vch-dms-mcp` — trigger service agreement generation
- `vch-audit-mcp` — log qualification decision

**HITL Escalations:**
- HITL-10: All disqualifications held for Deal Desk 24h review
- Credit bureau API failure → circuit breaker → manual review task

**Key Decision: What Already Exists in VCH Backend?**
- Is the lender soft-pull integration built? Which lender API? (OQ-01)
- Does the backend have qualification logic, or is this purely agent-driven?
- Is geographic eligibility a backend config table lookup or agent logic?

---

### 4.3 IntakeAgent

**Role:** `agent-worker`
**VPS Tier:** Full (4 vCPU / 16GB)
**Heartbeat:** `interval_seconds: 30, missing_tolerance: 120`
**Board:** Buyer Experience

**Primary Responsibilities:**
1. **Quick Match Intake** — Guide buyer through 5-step Quick Match (body type, budget,
   must-haves, brand preferences, delivery zip)
2. **Full Profile Intake** — Guide buyer through all 24 intake steps with save/resume
   capability; each step saved independently
3. **BFV Generation** — On profile completion, trigger Buyer Fit Vector generation
   (Quick Match uses simplified 4-category model; Full Profile uses weighted scoring)
4. **Profile Tier Management** — Track `profile_tier: "quick" | "full"`; prompt Quick Match
   users to upgrade after viewing results
5. **State Transition** — On intake complete, transition deal to PROFILED and notify
   MatchingAgent

**MCP Servers Required:**
- `vch-crm-mcp` — update contact custom fields (profile completion %)
- `vch-matching-mcp` — trigger BFV generation (or call VCH backend API directly)
- `vch-audit-mcp` — log intake step completions

**Trigger:** Deal reaches ENGAGED state (service agreement signed + deposit received)

**Key Decision: What Already Exists in VCH Backend?**
- Is the intake UI a frontend component that saves directly to the VCH backend API
  (`PUT /me/profile`), or does the agent manage the conversation?
- Is BFV generation a backend function (`POST /me/profile/quick-match`) that the agent
  just triggers, or does the agent compute the BFV?
- Does the save/resume logic live in the frontend or backend?

---

### 4.4 DannyAgent

**Role:** `agent-worker` (multiple instances)
**VPS Tier:** Full (4 vCPU / 16GB) — one VPS per instance
**Heartbeat:** `interval_seconds: 15, missing_tolerance: 60` (fastest — buyer-facing)
**Board:** Buyer Experience

**Primary Responsibilities:**
1. **Conversational AI** — "Danny the Deal Advisor" persona across website chat widget and
   client dashboard; handles all buyer questions about their deal
2. **Deal Status Queries** — Answer "Where is my deal?" using real-time deal state data
3. **Recommendation Browsing** — Help buyers understand match results, compare vehicles,
   explain Danny Savings figures
4. **Preference Updates** — Accept and process preference changes via conversation; trigger
   re-matching
5. **Escalation Handler** — When buyer requests human help, schedule callback and create
   HITL-12 task
6. **Return Initiation** — Accept return requests during 7-day window; hand off to ReturnAgent
7. **Cancellation Requests** — Accept cancellation requests; hand off to OrchestratorAgent

**MCP Tools (per PRD Section 4.9.2):**
- `get_buyer_profile(buyer_id)` — current BFV and preferences
- `get_deal_status(deal_id)` — current state, pending tasks, next steps
- `get_recommendations(buyer_id)` — current ranked vehicle matches
- `update_preference(buyer_id, category, value)` — update + trigger re-match
- `get_document_status(deal_id)` — document list with signed/pending status
- `get_delivery_status(deal_id)` — carrier tracking info
- `schedule_callback(buyer_id, preferred_time)` — book human callback
- `submit_escalation(deal_id, reason)` — trigger HITL checkpoint
- `initiate_return(deal_id, reason)` — start 7-day return process

**Persona Rules:**
- Direct, consumer-advocacy-focused, anti-dealer-jargon
- All pricing claims sourced from MarketCheck Price — never fabricated
- Cannot override state machine states
- All interactions logged to audit trail
- Compliance gate on all outbound messages

**Scaling:** Start with 2 instances; add instances when concurrent buyer sessions exceed
capacity (observable via Mission Control agent heartbeat response times)

**Key Decision: What Already Exists in VCH Backend?**
- Is the Danny chat already implemented via `POST /chat/message` + `GET /chat/history`?
- Are the MCP tools listed above already built as VCH backend endpoints?
- Does the frontend chat widget already exist, and does it call the VCH backend directly
  or go through GHL?

---

### 4.5 MatchingAgent

**Role:** `agent-worker`
**VPS Tier:** Full (4 vCPU / 16GB)
**Heartbeat:** `interval_seconds: 60, missing_tolerance: 300`
**Board:** Buyer Experience

**Primary Responsibilities:**
1. **BFV Scoring** — Run Buyer Fit Vector against 50K+ vehicle inventory; return top N
   matches with scores (0.0-1.0)
2. **Quick Match Scoring** — Simplified 4-category model for Quick Match profiles:
   `(body_type_match * 0.30) + (budget_fit * 0.30) + (priority_alignment * 0.25) + (brand_preference * 0.15)`
3. **Full BFV Scoring** — Phase 1 (hard constraint elimination) + Phase 2 (weighted scoring)
4. **Explainability Generation** — Natural language explanation of why each vehicle matched
5. **Three Price Points** — For each recommendation: Average Retail (MarketCheck Price),
   VCH Target Acquisition, Estimated OTD — plus Danny Savings figure
6. **Scheduled Re-runs** — Every 48 hours while buyer is in MATCHING state
7. **Preference-Triggered Re-runs** — Immediate re-run on any BFV change

**MCP Servers Required:**
- `vch-matching-mcp` — run_match, get_recommendations, get_match_explainability
- `vch-inventory-mcp` — search_vehicles (for scoring)
- `marketcheck-mcp` — get_market_pricing (for price points)
- `vch-audit-mcp` — log matching events

**Triggers:**
- Deal state → PROFILED (auto-run)
- Buyer requests updated results (manual re-run)
- Every 48 hours in MATCHING state (scheduled)
- Any BFV change (preference-triggered)

**Key Decision: What Already Exists in VCH Backend?**
- Is the matching engine already built as a backend service (`POST /matching/run/{buyer_id}`)?
- Is BFV scoring a Celery background job or a synchronous API call?
- Does the agent orchestrate the matching run, or does it just trigger a backend function?
- Is MarketCheck Price integration already in the matching results pipeline?

---

### 4.6 FundingAgent

**Role:** `agent-worker`
**VPS Tier:** Full (4 vCPU / 16GB)
**Heartbeat:** `interval_seconds: 30, missing_tolerance: 120`
**Board:** Funding Pipeline

**Primary Responsibilities:**
1. **Credit App Tracking** — Monitor credit application submissions; send reminders at 24h,
   48h, 72h if pending
2. **Lender Routing** — Submit credit app to lender(s); MVP = single lender; Phase 2 =
   multi-lender waterfall
3. **Terms Presentation** — Present loan terms to buyer; track acceptance
4. **Document Collection** — Monitor required funding docs (ID, income proof, insurance binder,
   credit app, service agreement, down payment, proof of residence); chase missing items
5. **GO Signal** — On FULLY_FUNDED state, signal OrchestratorAgent to route to SourcingAgent
6. **Cash Buyer Path** — Verify proof of funds; immediate GO signal
7. **Funding Failure** — On FUNDING_FAILED, attempt secondary lender (Phase 2) or escalate
   to Deal Desk (HITL-07)

**MCP Servers Required:**
- `vch-funding-mcp` — all funding case operations
- `vch-dms-mcp` — DocuSign integration for funding docs
- `vch-crm-mcp` — buyer communication, stage updates
- `vch-audit-mcp` — log funding events

**Funding States Managed:**
CREDIT_APP_PENDING → CREDIT_APP_SUBMITTED → PRE_APPROVED → TERMS_ACCEPTED →
FINAL_APPROVAL_PENDING → FULLY_FUNDED | CASH_BUYER | FUNDING_FAILED

**HITL Escalations:**
- HITL-07: FUNDING_FAILED → Deal Desk (4 biz hours)
- HITL-02: Vehicle price > $75K → Deal Desk (4 biz hours)
- Incomplete funding package after 7 days → human escalation

**Key Decision: What Already Exists in VCH Backend?**
- Is the funding state machine implemented in the backend?
- Are lender API integrations built? (OQ-01)
- Does the backend handle DocuSign envelope generation for funding docs?
- Is the reminder sequence (24h/48h/72h) a GHL workflow or backend Celery task?

---

### 4.7 SourcingAgent

**Role:** `agent-worker`
**VPS Tier:** Full (4 vCPU / 16GB)
**Heartbeat:** `interval_seconds: 30, missing_tolerance: 120`
**Board:** Sourcing & Acquisition

**Primary Responsibilities:**
1. **Dealer Partner Priority Check** — Before auction, check if any Dealer Partner has a
   matching unit on aged inventory (90+ days). Route to NegotiatorAgent if yes.
2. **Auction Path (MVP = human-assisted)** — Generate bid recommendation with max_bid_price;
   human executes bid; SourcingAgent confirms result. Phase 2 = computer-use agent for
   automated bidding.
3. **Quality Firewall Execution** — Run all 8 pre-purchase checks: condition grade, accident
   history, title status, odometer consistency, open recalls, ownership count, price sanity,
   geographic availability
4. **Real-Time MarketCheck Validation** — At ACQUISITION_PENDING, call MarketCheck real-time
   API to confirm listing is still active and current price
5. **VIN History Check** — Run VIN decode and history check via MarketCheck
6. **Acquisition Confirmation** — On successful purchase, create AcquisitionOrder record;
   transition to ACQUIRED; trigger LogisticsAgent

**MCP Servers Required:**
- `vch-sourcing-mcp` — acquisition order, bid submission, dealer outreach, VIN history
- `vch-inventory-mcp` — search vehicles, run quality firewall, get vehicle details
- `marketcheck-mcp` — real-time listing validation, VIN decode, market pricing
- `vch-crm-mcp` — stage updates, dealer partner contact
- `vch-audit-mcp` — log sourcing events

**HITL Escalations:**
- HITL-03: Auction bid ceiling reached → Sourcing Supervisor (2 biz hours)
- HITL-04: Quality Firewall failure requiring waiver → Sourcing Supervisor (4 biz hours)
- Bids > $50K → Sourcing Supervisor approval required
- Negotiation beyond 2 counter-offers → human takeover

**Key Decision: What Already Exists in VCH Backend?**
- Is the Quality Firewall implemented as a backend function?
- Are auction portal integrations built? Which portals? (OQ-02)
- Does the backend have dealer partner matching logic?
- Is the AcquisitionOrder record creation a backend API call?

---

### 4.8 NegotiatorAgent

**Role:** `agent-worker`
**VPS Tier:** Full (4 vCPU / 16GB)
**Heartbeat:** `interval_seconds: 30, missing_tolerance: 120`
**Board:** Sourcing & Acquisition

**Primary Responsibilities:**
1. **Dealer Price Negotiation** — Handle offer/counter-offer sequences with dealer partners
   for specific vehicle acquisitions
2. **Offer Generation** — Calculate initial offer based on MarketCheck wholesale estimate,
   vehicle condition, and days-on-lot discount
3. **Counter-Offer Management** — Accept up to 2 counter-offers; apply pre-defined negotiation
   rules (max bid ceiling, minimum margin preservation)
4. **Purchase Order Generation** — On accepted offer, generate and send Purchase Order via
   DMSAgent
5. **Time-Limited Acceptance Windows** — All offers include 48-hour acceptance deadline
6. **Escalation** — Beyond 2 counter-offers, escalate to Sourcing Supervisor for manual
   negotiation

**MCP Servers Required:**
- `vch-sourcing-mcp` — acquisition order, dealer outreach
- `vch-dms-mcp` — generate Purchase Order document
- `vch-crm-mcp` — dealer partner communication (email/SMS)
- `marketcheck-mcp` — market pricing for offer calculation
- `vch-audit-mcp` — log negotiation events

**Distinction from B2BMarketingAgent:**
- NegotiatorAgent handles specific deal negotiations with existing partners
- B2BMarketingAgent recruits new dealers and maintains relationships
- NegotiatorAgent takes over from B2BMarketingAgent when a dealer responds "YES" to an
  aged inventory alert

**Key Decision: What Already Exists in VCH Backend?**
- Are dealer outreach email templates built?
- Is PO generation a backend function or DocuSign template?
- Does the backend track negotiation state (offer history)?

---

### 4.9 DMSAgent

**Role:** `agent-worker`
**VPS Tier:** Full (4 vCPU / 16GB)
**Heartbeat:** `interval_seconds: 30, missing_tolerance: 120`
**Board:** Documents & Title

**Primary Responsibilities:**
1. **Document Generation** — Generate all transaction documents from templates:
   Service Agreement, Buyer Order, Credit App link, Bill of Sale, Odometer Disclosure,
   Registration Application, GAP Addendum, Warranty Agreement, Return Authorization
2. **E-Signing via DocuSign** — Create envelopes, track signing status, process webhooks
3. **Title Case Management** — Create TitleCase record on acquisition; perform automated
   title lien check and assignment validity check
4. **Title Exception Handling** — If title issue detected, transition to EXCEPTION and
   notify Title Clerk (HITL-05)
5. **Out-of-State Titles** — Generate state-specific reassignment paperwork
6. **Compliance Documents** — FTC Buyer's Guide disclosure for every transaction
7. **Document Retention** — Ensure 7-year retention with access logging

**MCP Servers Required:**
- `vch-dms-mcp` — all document operations
- `vch-crm-mcp` — stage updates, buyer notification
- `vch-audit-mcp` — log document events

**Documents by Deal Stage:**
| Stage | Document | Signed By |
|-------|----------|-----------|
| ENGAGED | Digital Service Agreement | Buyer |
| VEHICLE_SELECTED | Buyer Order / Purchase Agreement | Buyer + VCH |
| FUNDING | RISC (lender-generated), GAP Addendum, Warranty | Buyer |
| ACQUIRED | Bill of Sale, Odometer Disclosure | VCH + Seller |
| CLOSED_WON | Registration Application | Buyer |
| RETURN_PENDING | Return Authorization | Buyer |
| All stages | Post-Delivery Satisfaction Survey | Buyer (48h after delivery) |

**HITL Escalations:**
- HITL-05: Title exception → Title Clerk (1 biz day)
- HITL-06: Out-of-state wet signature → Title Clerk (2 biz days)
- OFAC hit on document review → HITL-08 (15 minutes)

**Key Decision: What Already Exists in VCH Backend?**
- Are DocuSign templates already configured? (OQ-03)
- Is the TitleCase model and state machine implemented?
- Does the backend handle DocuSign webhook processing at `/webhooks/docusign`?
- Are document templates stored in the backend or in DocuSign?

---

### 4.10 LogisticsAgent

**Role:** `agent-worker`
**VPS Tier:** Full (4 vCPU / 16GB)
**Heartbeat:** `interval_seconds: 60, missing_tolerance: 300`
**Board:** Logistics & Delivery

**Primary Responsibilities:**
1. **Transport Quote Request** — On ACQUIRED state, pull vehicle location and buyer delivery
   address; submit quote request to Central Dispatch API
2. **Carrier Selection** — Select lowest-cost carrier meeting reliability minimum from
   returned quotes (2-4 hour quote window)
3. **Carrier Booking** — Book selected carrier; create Shipment record with tracking URL
   (MVP = human posts to Central Dispatch; agent generates request)
4. **Buyer Notification** — Send delivery estimate and tracking info
5. **Tracking Monitoring** — Poll carrier tracking API every 6 hours; send status updates
   at pickup, in-transit, and approaching-delivery milestones
6. **Delivery Checklist** — Send digital Delivery Inspection Checklist to buyer at delivery
7. **Delivery Confirmation** — On checklist submission, transition to DELIVERED
8. **Damage at Delivery** — If damage reported, create EXCEPTION + HITL-09 within 15 minutes;
   collect photo documentation
9. **Carrier Performance Tracking** — Record on-time rate, damage claims, communication
   responsiveness per carrier; auto-remove below-threshold carriers

**MCP Servers Required:**
- `vch-logistics-mcp` — transport quotes, carrier booking, tracking status, delivery report
- `vch-crm-mcp` — buyer notifications, stage updates
- `vch-audit-mcp` — log logistics events

**HITL Escalations:**
- HITL-09: Delivery damage → Operations Admin (1 biz hour)
- Delivery delay > 48h → Operations Admin notification
- Carrier no-show → Operations Admin + re-booking

**Key Decision: What Already Exists in VCH Backend?**
- Is the Central Dispatch API integration built?
- Is the Shipment model and tracking logic implemented?
- Does the backend have carrier performance tracking tables?
- Is the delivery checklist a frontend form or backend-generated?

---

### 4.11 CommunicationAgent

**Role:** `agent-worker`
**VPS Tier:** Full (4 vCPU / 16GB)
**Heartbeat:** `interval_seconds: 60, missing_tolerance: 300`
**Board:** Buyer Communications

**Primary Responsibilities:**
1. **Transactional Buyer Comms** — All event-driven communications during active deals:
   matching results ready, funding follow-ups, delivery countdown, document reminders
2. **Danny Persona for Outbound** — Maintain Danny voice in all scheduled outbound messages
3. **GHL Workflow Health Monitoring** — Verify all 11 GHL automation workflows (Section 6.5)
   are firing correctly; detect and remediate enrollment failures
4. **Multi-Channel Delivery** — Email via GHL, SMS via GHL/Telnyx, voice tasks via Telnyx
5. **Compliance Gate** — All outbound messages pass compliance review before sending
   (no disparagement, no fabricated pricing, no unauthorized promises)
6. **Post-Delivery Survey** — 48-hour post-delivery satisfaction survey dispatch

**MCP Servers Required:**
- `vch-crm-mcp` — send email, send SMS, get conversation history
- `ghl-native-mcp` — workflow enrollment, campaign management
- `vch-audit-mcp` — log all communications

**HITL Escalations:**
- Legal threat or media mention in buyer response → P0 Exception Queue
- Buyer complaint language detected → Operations Admin (2 biz hours)

**Distinction from DannyAgent:**
- DannyAgent = real-time conversational (buyer asks, Danny answers)
- CommunicationAgent = scheduled/event-driven outbound (system sends to buyer)

**Key Decision: What Already Exists in VCH Backend?**
- Are the 11 GHL workflows already configured? (depends on GHL account — OQ-10)
- Does the backend already trigger communications, or is it all GHL-native?
- Is there existing compliance filtering logic?

---

### 4.12 ReturnAgent

**Role:** `agent-worker`
**VPS Tier:** Light (2 vCPU / 8GB)
**Heartbeat:** `interval_seconds: 60, missing_tolerance: 300`
**Board:** Returns

**Primary Responsibilities:**
1. **Return Initiation** — Process return requests within 7-day window; create ReturnCase record
2. **Return Authorization** — Generate Return Authorization document via DocuSign
3. **Return Transport** — Arrange return carrier pickup (MVP = manual; Phase 2 = automated)
4. **Condition Inspection** — On vehicle receipt, compare condition to delivery checklist photos;
   document any new damage
5. **Refund Calculation** — Calculate refund = total payment - restocking fee (if any) - damage
   repair costs
6. **Lender Unwind** — For financed deals, coordinate with FundingAgent to unwind lender contract
7. **Vehicle Re-listing** — Return vehicle to inventory pool (available=true, condition updated)

**MCP Servers Required:**
- `vch-returns-mcp` — all return case operations
- `vch-dms-mcp` — Return Authorization document
- `vch-logistics-mcp` — return transport booking
- `vch-funding-mcp` — lender unwind coordination
- `vch-crm-mcp` — buyer communication, stage updates
- `vch-audit-mcp` — log return events

**Return State Machine:**
DELIVERED → RETURN_PENDING → RETURN_IN_TRANSIT → RETURN_INSPECTING →
RETURN_APPROVED (→ refund → CLOSED_LOST) | RETURN_DISPUTED (→ HITL-13)

**HITL Escalations:**
- HITL-13: Return condition dispute → Operations Admin (4 biz hours)
- Restocking fee waiver request → Operations Admin
- Financed deal unwind complications → Deal Desk

**Key Decision: What Already Exists in VCH Backend?**
- Is the ReturnCase model implemented?
- Is the return state machine built?
- Does the backend have refund calculation logic?
- Is `POST /returns/{deal_id}/initiate` implemented?

---

### 4.13 ComplianceAgent

**Role:** `agent-worker`
**VPS Tier:** Light (2 vCPU / 8GB)
**Heartbeat:** `interval_seconds: 120, missing_tolerance: 600`
**Board:** Compliance & Screening

**Primary Responsibilities:**
1. **OFAC Screening** — Screen all buyers at QUALIFIED state; re-screen at FUNDING state;
   any hit → immediate HITL-08 (15-minute SLA, all activity suspended)
2. **FTC Safeguards Rule** — Verify customer data handling meets FTC requirements
3. **Used Car Rule** — Ensure FTC Buyer's Guide disclosure generated for every transaction
4. **State Licensing Compliance** — Verify FL dealer license is current; flag out-of-state
   licensing requirements for partner deals
5. **Red Flags Rule** — Identity verification via credit header comparison
6. **Document Retention Audit** — Periodic check that all deal documents meet 7-year encrypted
   retention with access logging
7. **OFAC Cache Management** — Results cached per contact_id for 30 days; re-screen on
   any contact data change

**MCP Servers Required:**
- `vch-audit-mcp` — compliance event logging, audit trail queries
- `vch-crm-mcp` — contact data for screening
- `vch-dms-mcp` — document retention verification
- `ofac-screening-mcp` (new or integrated into vch-funding-mcp) — OFAC API integration

**HITL Escalations:**
- HITL-08: OFAC hit → Operations Admin (15 minutes) — ALL activity suspended

**Key Decision: What Already Exists in VCH Backend?**
- Is OFAC screening integrated? Which service?
- Is the Red Flags Rule identity verification built?
- Does the backend already enforce document retention policies?

---

### 4.14 B2CMarketingAgent

**Role:** `agent-worker`
**VPS Tier:** Full (4 vCPU / 16GB)
**Heartbeat:** `interval_seconds: 60, missing_tolerance: 300`
**Board:** B2C Ads & Social

**(Detailed specification in approved plan — /root/.claude/plans/noble-kindling-pebble.md)**

**Summary of 5 Core Workflows:**
1. TikTok Catalog Feed — nightly push of QF-passing vehicles with Danny Savings
2. GHL Campaign Sequences — Lead Welcome, Re-engagement, Post-Delivery Review, Danny Dollar
3. Danny Dollar Referral Attribution — code generation, UTM tracking, payout triggers
4. Equity Alert Automation — quarterly personalized equity notifications
5. SEO Content Feeds — weekly market data to CMS; Buyer's Guide widgets

**New MCP Servers Required:**
- `tiktok-catalog-mcp` — catalog push/status/remove
- `vch-content-mcp` — market report data, inventory counts, Buyer's Guide data
- `vch-referral-mcp` — referral code generation, attribution, conversion tracking

**MVP Note:** TikTok Catalog and Equity Alerts are explicitly Phase 2 per PRD Section 11.2.
This agent should be built but these features gated behind feature flags
(`TIKTOK_CATALOG_FEED`, `EQUITY_ALERTS`).

---

### 4.15 B2BMarketingAgent

**Role:** `agent-worker`
**VPS Tier:** Light (2 vCPU / 8GB)
**Heartbeat:** `interval_seconds: 120, missing_tolerance: 600`
**Board:** B2B Partner Development

**(Detailed specification in approved plan — /root/.claude/plans/noble-kindling-pebble.md)**

**Summary of 4 Core Workflows:**
1. Dealer Partner Recruitment — 3-attempt outreach cadence (weekly)
2. Dealer Partner Onboarding — 5-step sequence (Day 0 → Day 30)
3. Aged Inventory Deal Alerts — broadcast-triggered outreach to matching partners
4. Partner Relationship Maintenance — monthly check-ins, quarterly performance reports

**Key Distinction:** B2BMarketingAgent builds the partner pipeline; NegotiatorAgent closes
individual deals within that pipeline.

---

### 4.16 DealIntelligenceAgent

**Role:** `agent-worker`
**VPS Tier:** Light (2 vCPU / 8GB)
**Heartbeat:** `interval_seconds: 300, missing_tolerance: 900` (analytics cadence — not real-time)
**Board:** Deal Intelligence

**Primary Responsibilities:**
1. **DealOutcome Record Generation** — On every CLOSED_WON, CLOSED_LOST, and return,
   create DealOutcome record with full financial, timing, and channel data (PRD Section 15.2)
2. **Learning Loop Execution** — Run 8 learning loops (PRD Section 15.3):
   - Margin Optimization (monthly)
   - Acquisition Cost Calibration (weekly)
   - Match Quality Validation (every 25 deals)
   - Cycle Time Analysis (monthly)
   - Lead Source ROI (monthly)
   - Loss Pattern Detection (every 10 losses)
   - Return Pattern Analysis (every 5 returns)
   - Quick Match → Full Profile Conversion (every 25 Quick Match deals)
3. **Anomaly Detection** — Alert when any metric drifts beyond 2 standard deviations
4. **Configuration Updates** — Update markup tables, wholesale estimate coefficients,
   and category weight defaults based on learning loop outputs (Phase 2; MVP = recommendations
   only)
5. **Reporting** — Generate monthly deal intelligence summary for Operations Admin

**MCP Servers Required:**
- `vch-audit-mcp` — read deal outcomes, audit trail
- `vch-matching-mcp` — read match scores for validation
- `vch-inventory-mcp` — market pricing for margin analysis
- `marketcheck-mcp` — retail values for spread analysis
- `vch-crm-mcp` — lead source and channel data

**MVP Scope:** DealOutcome records auto-generated; monthly manual review via SQL queries.
Agent produces recommendations but does not auto-update configuration.

**Key Decision: What Already Exists in VCH Backend?**
- Is the DealOutcome model implemented?
- Are there existing analytics queries or dashboards?
- Does the backend have a config table for business rules that learning loops would update?

---

## 5. INTER-AGENT COMMUNICATION MAP

Agents never communicate directly. All coordination flows through Mission Control via:
1. **Board Tasks** — Agent creates a task on another agent's board
2. **Broadcasts** — OrchestratorAgent broadcasts to board leads
3. **State Transitions** — GHL webhook triggers OrchestratorAgent to route next action

### Deal Flow — Agent Handoff Sequence

```
LEAD
  InboundAgent captures → creates task for QualificationAgent
    ↓
PRE_QUALIFYING
  QualificationAgent screens → QUALIFIED or DISQUALIFIED
    ↓
QUALIFIED
  QualificationAgent triggers DMSAgent (service agreement) + deposit
    ↓
ENGAGED
  OrchestratorAgent routes to IntakeAgent
    ↓
PROFILED
  IntakeAgent completes → triggers MatchingAgent
    ↓
MATCHING
  MatchingAgent scores → presents results via DannyAgent
    ↓
VEHICLE_SELECTED
  Buyer selects via DannyAgent → OrchestratorAgent routes to FundingAgent
    ↓
FUNDING
  FundingAgent manages lender flow → FULLY_FUNDED
    ↓
ACQUISITION_PENDING
  OrchestratorAgent routes to SourcingAgent
  SourcingAgent checks Dealer Partners → NegotiatorAgent (if match) OR auction path
    ↓
ACQUIRED
  SourcingAgent confirms → OrchestratorAgent routes to LogisticsAgent + DMSAgent
    ↓
IN_TRANSIT
  LogisticsAgent manages delivery → DELIVERED
    ↓
DELIVERED
  CommunicationAgent sends post-delivery comms
  B2CMarketingAgent enrolls in Danny Dollar
  DannyAgent available for return requests (7-day window)
    ↓
CLOSED_WON
  DMSAgent completes title processing
  DealIntelligenceAgent creates DealOutcome record
```

### Cross-Cutting Interactions

| From | To | Trigger | Channel |
|------|----|---------|---------|
| Any agent | OrchestratorAgent | EXCEPTION state | Board task on Exception Queue |
| OrchestratorAgent | Any board lead | Deal routing | MC broadcast |
| SourcingAgent | NegotiatorAgent | Dealer partner has matching vehicle | Task on Sourcing board |
| SourcingAgent | B2BMarketingAgent | No partner match; broadcast need | MC broadcast via Orchestrator |
| B2BMarketingAgent | NegotiatorAgent | Dealer responds "YES" to alert | Task on Sourcing board |
| FundingAgent | SourcingAgent | FULLY_FUNDED GO signal | Task via Orchestrator |
| ReturnAgent | FundingAgent | Lender unwind needed | Task on Funding board |
| ReturnAgent | LogisticsAgent | Return transport needed | Task on Logistics board |
| ComplianceAgent | Any agent | OFAC hit | HALT broadcast via Orchestrator |
| DealIntelligenceAgent | OrchestratorAgent | Anomaly detected | Task on Exception Queue |

---

## 6. MCP SERVER REGISTRY

### Existing MCP Servers (defined in PRD Section 7.2)

| MCP Server | Used By Agents |
|------------|---------------|
| `vch-crm-mcp` | ALL agents |
| `vch-inventory-mcp` | MatchingAgent, SourcingAgent, B2CMarketingAgent, DealIntelligenceAgent |
| `vch-matching-mcp` | MatchingAgent, IntakeAgent, DealIntelligenceAgent |
| `vch-funding-mcp` | FundingAgent, QualificationAgent, ReturnAgent |
| `vch-sourcing-mcp` | SourcingAgent, NegotiatorAgent |
| `vch-dms-mcp` | DMSAgent, QualificationAgent, NegotiatorAgent, ReturnAgent, B2BMarketingAgent |
| `vch-logistics-mcp` | LogisticsAgent, ReturnAgent |
| `vch-audit-mcp` | ALL agents |
| `vch-returns-mcp` | ReturnAgent |
| `marketcheck-mcp` | MatchingAgent, SourcingAgent, B2CMarketingAgent, DealIntelligenceAgent |
| `ghl-native-mcp` | InboundAgent, CommunicationAgent, B2CMarketingAgent, B2BMarketingAgent |

### New MCP Servers Needed

| MCP Server | Tools | Owner Agent | Notes |
|------------|-------|-------------|-------|
| `mc-api-mcp` | agent status, board tasks, broadcasts, approvals | OrchestratorAgent | Wraps Mission Control REST API |
| `tiktok-catalog-mcp` | push_catalog, get_status, remove_listing | B2CMarketingAgent | Phase 2 feature-flagged |
| `vch-content-mcp` | update_market_report, inventory_counts, buyers_guide | B2CMarketingAgent | Phase 2 feature-flagged |
| `vch-referral-mcp` | generate_code, lookup_by_code, record_conversion | B2CMarketingAgent | Danny Dollar system |
| `ofac-screening-mcp` | screen_contact, get_cached_result, clear_cache | ComplianceAgent | Or integrate into vch-funding-mcp |
| `telnyx-mcp` | make_call, send_sms, get_recording | InboundAgent | If Telnyx not handled by GHL natively |

---

## 7. HITL ESCALATION REGISTRY

All HITL checkpoints from PRD Section 8.1, mapped to the agent that triggers them:

| ID | Trigger | Creating Agent | Human Role | SLA | Board |
|----|---------|---------------|-----------|-----|-------|
| HITL-01 | Gross margin below minimum | FundingAgent / DealIntelligenceAgent | Deal Desk | 4 biz hours | Exception Queue |
| HITL-02 | Vehicle price > $75K | FundingAgent | Deal Desk | 4 biz hours | Exception Queue |
| HITL-03 | Auction bid ceiling reached | SourcingAgent | Sourcing Supervisor | 2 biz hours | Sourcing & Acquisition |
| HITL-04 | QF failure requiring waiver | SourcingAgent | Sourcing Supervisor | 4 biz hours | Sourcing & Acquisition |
| HITL-05 | Title exception | DMSAgent | Title Clerk | 1 biz day | Documents & Title |
| HITL-06 | Out-of-state wet signature | DMSAgent | Title Clerk | 2 biz days | Documents & Title |
| HITL-07 | FUNDING_FAILED | FundingAgent | Deal Desk | 4 biz hours | Funding Pipeline |
| HITL-08 | OFAC hit | ComplianceAgent | Operations Admin | 15 minutes | Exception Queue |
| HITL-09 | Delivery damage | LogisticsAgent | Operations Admin | 1 biz hour | Logistics & Delivery |
| HITL-10 | Pre-disqualification review | QualificationAgent | Deal Desk | 24 biz hours | Inbound & Qualification |
| HITL-11 | Deal stalled > SLA | OrchestratorAgent | Operations Admin | Daily review | Exception Queue |
| HITL-12 | Buyer escalation via Danny | DannyAgent | Ops Admin / Deal Desk | 2 biz hours | Exception Queue |
| HITL-13 | Return condition dispute | ReturnAgent | Operations Admin | 4 biz hours | Returns |

---

## 8. DEAL LIFECYCLE — AGENT OWNERSHIP BY STATE

| State | Owner Agent | What Happens | Exit Trigger |
|-------|------------|-------------|--------------|
| LEAD | InboundAgent | Capture, score, route | Pre-qual initiated |
| PRE_QUALIFYING | QualificationAgent | Credit screen, income verify | Qualified or Disqualified |
| DISQUALIFIED | CommunicationAgent | Re-engagement at 90 days | N/A (recycled) |
| QUALIFIED | QualificationAgent → DMSAgent | Service agreement + deposit | Agreement signed + deposit |
| ENGAGED | OrchestratorAgent → IntakeAgent | Route to intake | Profile completed |
| PROFILED | IntakeAgent → MatchingAgent | BFV generated, matching triggered | Matches presented |
| MATCHING | MatchingAgent + DannyAgent | Score, present, buyer browses | Buyer selects vehicle |
| VEHICLE_SELECTED | OrchestratorAgent → FundingAgent | Route to funding | Funding confirmed |
| FUNDING | FundingAgent | Lender flow, doc collection | FULLY_FUNDED or CASH_BUYER |
| ACQUISITION_PENDING | SourcingAgent (+NegotiatorAgent) | Source vehicle, QF check | Vehicle acquired |
| ACQUIRED | SourcingAgent → LogisticsAgent + DMSAgent | Route to transport + docs | Carrier dispatched |
| IN_TRANSIT | LogisticsAgent | Track, notify, deliver | Delivery confirmed |
| DELIVERED | LogisticsAgent → CommunicationAgent | Checklist, survey, Danny Dollar | Docs complete + survey |
| RETURN_PENDING | ReturnAgent | Return flow | Refund processed |
| CLOSED_WON | DMSAgent + DealIntelligenceAgent | Title processing, outcome record | Title received |
| CLOSED_LOST | OrchestratorAgent | Refund if applicable, re-engagement | Case closed |
| EXCEPTION | OrchestratorAgent → Human | Triage and route to correct role | Human resolves |

---

## 9. DEPLOYMENT ORDER & DEPENDENCIES

### Phase 1 — Foundation (deploy first; required by all other agents)

| Order | Agent | Why First | Depends On |
|-------|-------|-----------|------------|
| 1 | OrchestratorAgent | All agents report to it; deal routing starts here | Mission Control operational; VCH backend running |
| 2 | ComplianceAgent | OFAC screening must be active before any deal processing | OFAC screening service configured |

### Phase 2 — Sales Pipeline (core buyer journey)

| Order | Agent | Depends On |
|-------|-------|------------|
| 3 | InboundAgent | GHL account configured (OQ-10); Telnyx configured (OQ-13) |
| 4 | QualificationAgent | Lender API configured (OQ-01) |
| 5 | IntakeAgent | BuyerProfile model + intake API in VCH backend |
| 6 | MatchingAgent | MarketCheck bulk ingestion running (OQ-09); matching engine built |
| 7 | DannyAgent | Chat endpoint + MCP tools built; all sales agents operational |

### Phase 3 — Deal Operations (deal execution)

| Order | Agent | Depends On |
|-------|-------|------------|
| 8 | FundingAgent | Lender integration (OQ-01); DocuSign configured (OQ-03) |
| 9 | DMSAgent | DocuSign templates configured; TitleCase model built |
| 10 | SourcingAgent | Auction portal access (OQ-02); Quality Firewall built |
| 11 | NegotiatorAgent | At least 5 dealer partners onboarded (OQ-05) |

### Phase 4 — Fulfillment (delivery and post-sale)

| Order | Agent | Depends On |
|-------|-------|------------|
| 12 | LogisticsAgent | Central Dispatch access; Shipment model built |
| 13 | CommunicationAgent | All GHL workflows configured; deal lifecycle working |
| 14 | ReturnAgent | ReturnCase model built; refund logic implemented |

### Phase 5 — Marketing & Analytics (growth and learning)

| Order | Agent | Depends On |
|-------|-------|------------|
| 15 | B2BMarketingAgent | Dealer partner records in GHL; outreach templates approved |
| 16 | B2CMarketingAgent | GHL workflows configured; TikTok Business Center (Phase 2) |
| 17 | DealIntelligenceAgent | DealOutcome model built; at least 10 closed deals for meaningful data |

---

## 10. OPEN QUESTIONS FOR CODEBASE REVIEW

These questions should be answered during the session connected to the VCH backend codebase.
The answers determine what each agent calls (existing backend functions) vs. what must be built
(new agent-side logic or new MCP servers).

### Architecture Questions

| # | Question | Impact |
|---|----------|--------|
| A1 | Does the VCH backend already have a webhook processor at `/webhooks/ghl` that handles state transitions? | Determines if OrchestratorAgent replaces or wraps existing routing logic |
| A2 | Are deal state transitions enforced in the backend (state machine pattern), or is GHL the source of truth for stage? | Determines who owns the state machine — backend or agents |
| A3 | Is there existing Celery task infrastructure for background jobs (matching, ingestion, reminders)? | Determines if agents trigger Celery tasks or replace them |
| A4 | How is the Danny chat currently implemented — VCH backend endpoint or direct Claude API call from frontend? | Determines DannyAgent integration pattern |
| A5 | Are MCP servers already built as separate packages, or do they need to be created from the PRD spec? | Determines development scope for agent tooling |

### Backend Functionality Questions

| # | Question | Agents Affected |
|---|----------|----------------|
| B1 | Is the matching engine (`POST /matching/run/{buyer_id}`) implemented? | MatchingAgent, IntakeAgent |
| B2 | Is the Quality Firewall implemented as a backend function? | SourcingAgent |
| B3 | Is the funding state machine implemented? | FundingAgent |
| B4 | Is the ReturnCase model and refund calculation built? | ReturnAgent |
| B5 | Is the DealOutcome model and learning loop queries built? | DealIntelligenceAgent |
| B6 | Are DocuSign templates configured and envelope generation working? | DMSAgent, FundingAgent |
| B7 | Is Central Dispatch API integration built? | LogisticsAgent |
| B8 | Is the BuyerProfile / BFV generation a backend function or needs to be built? | IntakeAgent, MatchingAgent |
| B9 | Does the backend have lead scoring logic? | InboundAgent |
| B10 | Is OFAC screening integrated with a specific service? | ComplianceAgent |

### Integration Questions

| # | Question | Agents Affected |
|---|----------|----------------|
| I1 | Which GHL workflows from Section 6.5 are already configured? | CommunicationAgent, B2CMarketingAgent |
| I2 | Is GHL bi-directional sync (backend ↔ GHL) already working? | All agents using vch-crm-mcp |
| I3 | Is MarketCheck bulk ingestion running nightly? | MatchingAgent, B2CMarketingAgent |
| I4 | Is MarketCheck Price™ integration working? | MatchingAgent, B2CMarketingAgent |
| I5 | Which lender API is configured? | QualificationAgent, FundingAgent |
| I6 | Is Telnyx handling voice/SMS through GHL or directly to VCH backend? | InboundAgent |

---

**— END OF MASTER PLAN —**

*VCH Agent Fleet Master Plan v1.0 | March 2026*
*For use with OpenClaw Mission Control + VCH Backend Codebase*
