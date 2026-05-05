# VIRTUALCARHUB — Product Requirements Document

**Version 2.0 | February 2026**
**Autobahn Classics Inc. dba VirtualCarHub.com**
**Prepared by EZWAi**

> **CONFIDENTIAL — FOR DEVELOPMENT USE ONLY**

---

## CHANGELOG FROM v1.0

| Section | Change Type | Description |
|---------|------------|-------------|
| 1.3 | Enhanced | Added funnel-stage KPIs and leading indicators |
| 4.1 | New | Quick Match MVP shortcut (5-step fast intake to reduce abandonment) |
| 11 | Rewritten | MVP scope tightened with explicit "NOT in MVP" kill list |
| 12 | Locked | Tech stack decision finalized — Python (FastAPI) selected over Node.js |
| 15 | **New Section** | Deal Intelligence & Learning Loop (was referenced but never written) |
| 16 | **New Section** | Security Architecture & Auth Flows |
| 17 | **New Section** | Error Handling, Retry Patterns & Circuit Breakers |
| 18 | **New Section** | VCH Backend REST API Endpoint Specification |
| 19 | **New Section** | Monitoring, Alerting & Analytics |
| 20 | **New Section** | 7-Day Return Policy Implementation |
| 21 | **New Section** | Buyer Cancellation & Refund Flow |
| 22 | **New Section** | Environment, Config & Feature Flags |
| 23 | **New Section** | Database Migration & Backup Strategy |
| 24 | **New Section** | Sprint Execution Plan (6 Sprints, 12 Weeks) |
| 25 | **New Section** | Budget Estimates by Sprint |
| Appendix B | **New** | VCH Backend API Route Map |
| Appendix C | **New** | Environment Variable Registry |

---

## TABLE OF CONTENTS

1. [Vision & Strategic Goals](#1-vision--strategic-goals)
2. [Actors & System Roles](#2-actors--system-roles)
3. [Deal Lifecycle State Machine](#3-deal-lifecycle-state-machine)
4. [Core Modules — Functional Specifications](#4-core-modules--functional-specifications)
5. [Canonical Data Model](#5-canonical-data-model)
6. [GoHighLevel Integration Architecture](#6-gohighlevel-integration-architecture)
7. [AI Agent Architecture](#7-ai-agent-architecture)
8. [Human-In-The-Loop (HITL) Architecture](#8-human-in-the-loop-hitl-architecture)
9. [MarketCheck Integration Specification](#9-marketcheck-integration-specification)
10. [Marketing Engine Integration](#10-marketing-engine-integration)
11. [MVP Scope — First 50 Transactions](#11-mvp-scope--first-50-transactions)
12. [Technology Stack (Locked)](#12-technology-stack-locked)
13. [Acceptance Criteria & QA Test Plan](#13-acceptance-criteria--qa-test-plan)
14. [Open Questions & Decisions Needed](#14-open-questions--decisions-needed)
15. [Deal Intelligence & Learning Loop](#15-deal-intelligence--learning-loop)
16. [Security Architecture & Auth Flows](#16-security-architecture--auth-flows)
17. [Error Handling, Retry Patterns & Circuit Breakers](#17-error-handling-retry-patterns--circuit-breakers)
18. [VCH Backend REST API Specification](#18-vch-backend-rest-api-specification)
19. [Monitoring, Alerting & Analytics](#19-monitoring-alerting--analytics)
20. [7-Day Return Policy Implementation](#20-7-day-return-policy-implementation)
21. [Buyer Cancellation & Refund Flow](#21-buyer-cancellation--refund-flow)
22. [Environment, Config & Feature Flags](#22-environment-config--feature-flags)
23. [Database Migration & Backup Strategy](#23-database-migration--backup-strategy)
24. [Sprint Execution Plan](#24-sprint-execution-plan)
25. [Budget Estimates by Sprint](#25-budget-estimates-by-sprint)
- [Appendix A: Glossary](#appendix-a-glossary)
- [Appendix B: VCH Backend API Route Map](#appendix-b-vch-backend-api-route-map)
- [Appendix C: Environment Variable Registry](#appendix-c-environment-variable-registry)

---

## 1. VISION & STRATEGIC GOALS

VirtualCarHub is an AI-first, flat-fee virtual dealership that sources vehicles at or near wholesale cost on behalf of buyers who commit and qualify first. The business employs no commissioned sales staff. Instead, a suite of specialized AI agents handles 99% of all buyer interactions, vehicle sourcing, deal structuring, document management, logistics coordination, and post-sale follow-up. Human operators serve exclusively in a supervisory capacity and handle defined exception states.

### 1.1 Core Business Thesis

> **"The Dealership Run by Code, Not Commission."**

VirtualCarHub weaponizes transparency — exposing dealer markups, kickback fees, and financing padding — to acquire customers at a fraction of traditional CAC. The platform charges a flat service fee and earns margin on the wholesale-to-retail spread, funded transactions, and add-on services.

### 1.2 The Unique Business Model Mechanics

| Principle | Description |
|-----------|-------------|
| Just-In-Time Acquisition | VCH does NOT purchase vehicles speculatively. Acquisition is only triggered after a buyer is committed AND funded. Zero floor plan risk. |
| Pre-Qualification Gate | No human time is spent on unqualified prospects. Every prospect is pre-screened by AI before any sourcing activity begins. |
| Wholesale Access | Vehicles are sourced from dealer auctions (ADESA, Manheim, OVE) and aged dealer inventory — channels unavailable to retail consumers. |
| Flat Fee Model | Buyers pay a fixed service fee (not a percentage). VCH margin is derived from wholesale spread + lender compensation + add-on services. |
| AI-First Operations | 99% of all workflows are executed by AI agents. Humans supervise, approve high-risk decisions, and handle defined exception states only. |
| Quality Firewall | Proprietary sourcing rules (condition tiers, history checks, return logic) prevent VCH from acquiring substandard vehicles that generate chargebacks or returns. |

### 1.3 Success Metrics — First 50 Transactions (MVP)

**Primary KPIs:**

| KPI | Target | Measurement |
|-----|--------|-------------|
| Lead-to-Qualified Conversion | >35% | Submitted leads that pass pre-qualification |
| Qualified-to-Committed Rate | >50% | Qualified applicants that deposit and sign service agreement |
| Time: Committed → Vehicle Matched | <48 hours | Clock starts at service agreement signed |
| Time: Funded → Vehicle Acquired | <72 hours | Clock starts at lender disbursement confirmed |
| Successful Delivery Rate | >95% | Acquired vehicles delivered without dispute |
| Net Promoter Score (Post-Delivery) | >70 | 48-hour post-delivery survey |
| Human Intervention Rate | <5% | Deal steps requiring human action outside defined HITL checkpoints |
| Average Customer Acquisition Cost | <$150 | Total marketing spend / funded deals |

**Leading Indicators (new in v2):**

| Indicator | Target | Why It Matters |
|-----------|--------|----------------|
| Intake Completion Rate | >60% | Measures if the preference journey is too long/complex |
| Quick Match → Full Profile Upgrade | >40% | Validates the 2-tier intake strategy |
| Danny Chat Engagement (website) | >25% of visitors | Proves the AI persona drives conversion |
| Average Match Score of Selected Vehicle | >0.75 | Validates the BFV algorithm produces relevant results |
| Funding Docs Submitted within 48h | >70% | Measures friction in the funding pipeline |
| Deal Cycle Time (Lead → Closed Won) | <21 days | End-to-end deal velocity |
| Return Rate (7-Day Policy) | <5% | Quality Firewall effectiveness |
| Referral Rate (Closed Won buyers) | >15% | Danny Dollar program traction |

---

## 2. ACTORS & SYSTEM ROLES

The system recognizes the following actors. AI Agents are defined in Section 7. Human roles are defined here.

| Actor | Type | Primary Responsibilities | GHL Object |
|-------|------|--------------------------|------------|
| Prospect | External / Human | Initiates contact via web, social, or landing page | Contact (Opportunity Stage: Lead) |
| Qualified Buyer | External / Human | Has passed pre-qualification; submitted deposit; signed service agreement | Contact (Stage: Qualified) |
| Active Buyer | External / Human | Actively matched; vehicle sourcing in progress | Contact + Deal record (Stage: Matched/Funded) |
| Dealer Partner | External / Human | Wholesale inventory supplier; negotiated aged-unit sources | Contact (Tag: Dealer Partner) |
| Auction Portal | External / System | ADESA, Manheim, OVE — authenticated auction access for bidding | Integration (Custom Module) |
| Lender | External / System | Finance source; submits approvals and funding instructions | Integration (Custom Module + GHL Pipeline) |
| Carrier | External / System | Vehicle transport; dispatched via Central Dispatch or direct API | Integration (Custom Module) |
| Title Clerk | Internal / Human | Supervises title, registration, and compliance document workflow; handles exceptions | GHL User (Role: Title) |
| Deal Desk | Internal / Human | Reviews and approves deal structures flagged by AI above risk threshold | GHL User (Role: DealDesk) |
| Sourcing Supervisor | Internal / Human | Oversees auction bids above dollar threshold; reviews quality firewall exceptions | GHL User (Role: Sourcer) |
| Operations Admin | Internal / Human | System-wide oversight; exception resolution; vendor management | GHL User (Role: Admin) |
| AI Agent Orchestrator | Internal / AI | Routes tasks between specialized agents; maintains deal state | Custom Engine + GHL Webhook Consumer |

---

## 3. DEAL LIFECYCLE STATE MACHINE

Every buyer record moves through the following states. State transitions are triggered by AI agents, system events, or (at defined checkpoints) human approvals. Every state transition is logged as an AuditEvent in the database and reflected in the GHL Pipeline.

| State | Entry Trigger | Owner Agent | Exit Condition | GHL Pipeline Stage |
|-------|---------------|-------------|----------------|-------------------|
| LEAD | Form submit, chat initiation, SMS/call inbound | InboundAgent | Pre-qual initiated | Lead |
| PRE_QUALIFYING | Lead score >= threshold; InboundAgent routes to qualification | QualificationAgent | Credit app submitted OR disqualified | Pre-Qualifying |
| DISQUALIFIED | Credit below minimum OR income insufficient OR geographic exclusion | QualificationAgent | Re-engagement sequence after 90 days (auto-recycle) | Disqualified |
| QUALIFIED | Lender soft pull returns approvable range OR proof of funds confirmed | QualificationAgent | Service agreement signed + deposit received | Qualified |
| ENGAGED | Digital service agreement e-signed; deposit collected | OnboardingAgent | Buyer Profile completed (all intake steps complete) | Engaged |
| PROFILED | IntakeAgent confirms all preference steps complete | IntakeAgent | Matching run initiated | Profiled |
| MATCHING | MatchingEngine processes Buyer Fit Vector against inventory | MatchingAgent | At least 3 ranked candidates presented and buyer selects preferred option | Matching |
| VEHICLE_SELECTED | Buyer confirms preferred vehicle from ranked list | MatchingAgent | Funding fully confirmed (lender approval + terms accepted) | Vehicle Selected |
| FUNDING | Lender final approval submitted; terms presented to buyer | FundingAgent | All funding docs signed; lender confirms disbursement instructions | Funding |
| ACQUISITION_PENDING | Funding fully confirmed; go-signal sent to SourcingAgent | SourcingAgent | Vehicle acquired at auction OR dealer purchase confirmed | Acquisition Pending |
| ACQUIRED | Vehicle title/BOS received; quality firewall checks passed | SourcingAgent | Recon/inspection complete; carrier dispatched | Acquired |
| IN_TRANSIT | Carrier confirms pickup; tracking number assigned | LogisticsAgent | Carrier confirms delivery; buyer acknowledges receipt | In-Transit |
| DELIVERED | Delivery confirmed; buyer completes delivery checklist | LogisticsAgent | All post-delivery docs signed; satisfaction survey submitted | Delivered |
| RETURN_PENDING | Buyer initiates 7-day return within policy window | ReturnAgent | Vehicle received back; refund processed | Return Pending |
| CLOSED_WON | All docs complete; funds disbursed; title processing initiated | DMSAgent | Title received by buyer; case closed | Closed Won |
| CLOSED_LOST | Buyer cancels OR funding falls through after engagement fee threshold | OpsAdmin (Human) | Refund (if applicable) processed; re-engagement scheduled at 6 months | Closed Lost |
| EXCEPTION | Any agent encounters condition outside defined rules | OrchestratorAgent → Human | Human resolves and overrides state | Exception (Internal) |

> **v2 Change:** Added `RETURN_PENDING` state to support the 7-Day Return Policy (Section 20).

---

## 4. CORE MODULES — FUNCTIONAL SPECIFICATIONS

### Module 1: Buyer Intake & Profile Engine

The Intake Engine implements the full preference capture flow documented in the VirtualCarHub Intake Journey specification. Each preference step is a discrete data collection event stored as structured JSON in the BuyerProfile object. The engine produces a "Buyer Fit Vector" — a weighted numerical representation of the buyer's preferences — used by the Matching Engine.

#### 4.1.0 Quick Match — MVP Fast Intake (NEW in v2)

> **Problem:** The full intake journey has 24 steps. Industry benchmarks show >60% abandonment on multi-step forms exceeding 8 steps. For MVP, conversion is more important than match precision.

**Quick Match is a 5-step shortcut** that collects enough data to produce useful (not perfect) recommendations. Buyers can upgrade to Full Profile at any time to improve match quality.

**Quick Match Steps:**

| Step | Question | Data Collected | Time |
|------|----------|----------------|------|
| QM-1 | "What kind of vehicle?" | body_types_included[] (multi-select: SUV, Sedan, Truck, etc.) | 10 sec |
| QM-2 | "Budget range?" | budget_min, budget_max (slider or preset ranges) | 10 sec |
| QM-3 | "Must-haves?" | top_3_priorities[] (pick 3 from: fuel economy, safety, tech, towing, luxury, sportiness, cargo, off-road) | 15 sec |
| QM-4 | "Any brands you love or hate?" | brands_included[], brands_excluded[] (optional; skip = no filter) | 15 sec |
| QM-5 | "Where will we deliver it?" | delivery_zip (auto-fills from browser location if permitted) | 5 sec |

**Quick Match BFV Generation:**
- Missing preference weights default to 5.0 (neutral) instead of 0.0
- Hard constraints: only brands_excluded and body_types_excluded are applied
- Match scoring uses a simplified 4-category model: body type, budget, priority alignment, brand preference
- Results include a "Match Confidence" badge: "Good Match" (>0.6) vs. "Great Match — complete your profile for better results" (<0.8)

**Upgrade Prompt:** After Quick Match results are displayed, Danny prompts: *"Want even better matches? Complete your full profile — it takes about 10 minutes and I'll re-run your matches with much higher precision."*

**Technical:** Quick Match profiles are stored with `profile_tier: "quick"` in BuyerProfile. Full profiles are `profile_tier: "full"`. The matching engine checks `profile_tier` to determine which scoring algorithm to use.

#### 4.1.1 Intake Steps (Full Profile — in sequence)

| Step | Data Collected | Storage Field | Data Type |
|------|----------------|---------------|-----------|
| 1 — Body Type Select | SUV/Crossover, Sedan, Coupe, Hatchback, Pickup, Sports, Van (multi-select) | body_types_included[] | String[] |
| 1a — Sub-Body Preference | Per selected body type: sub-categories rated 0–10 slider | body_subtype_weights{} | Object{string: float} |
| 1b — Engine Type | Gasoline, Hybrid, BEV, PHEV, Diesel, FCEV: each rated 0–10; unchecked = excluded | engine_type_weights{} | Object{string: float} |
| 2 — Brand Select | All 35+ brands shown with logos; multi-select with "Select All" option | brands_included[] | String[] |
| 2a — Brand Preference Rating | Modal: selected brands rated "Just Okay" to "A Favorite" (0–10) | brand_weights{} | Object{string: float} |
| 3 — Fueling & Range | MPG range slider (acceptable min to desirable target); EV range input | mpg_min, mpg_target, ev_range_min | Float, Float, Int |
| 4a — Acceleration | Dual slider: acceptable to desirable 1–10 scale | accel_min, accel_target | Float, Float |
| 4b — Ride & Handling | Ride comfort + Handling balance sliders; 4WS / ride height / dynamic suspension preference | ride_weight, handling_weight, suspension_prefs{} | Mixed |
| 4c — Sporty Driving | Transmission type preference (auto/manual/paddle); fun-to-drive features | transmission_pref, sport_features{} | Mixed |
| 4d — Drive Type & Modes | FWD/RWD/4WD/AWD preference weights; Ice/Snow mode; Tow/Haul mode | drivetrain_weights{}, situational_modes{} | Object |
| 4e — Off-Road Capability | Dual slider: 1=Main roads only to 10=Rock crawling | offroad_min, offroad_target | Float, Float |
| 4f — Towing Capacity | Trailer weight class preferences rated by importance | towing_prefs{} | Object{class: weight} |
| 4g — Engine Configuration | Cylinder count preferences (3/4/6/8); Turbo/SC weight | cylinder_weights{}, forced_induction_weight | Mixed |
| 5a — Active Safety | Pedestrian detection, blind spot, lane departure, backup alert | safety_weights{} | Object{feature: float} |
| 5b — Driver-Assist Systems | ACC, lane keep, auto park, remote parking, trailer steering, semi-autonomous | driver_assist_weights{} | Object |
| 5c — Visibility | Overall visibility rating; camera preferences (180/360/rear); windshield projection | visibility_weight, camera_weights{}, projection_weights{} | Mixed |
| 5d — Lights | LED, HID, Smart headlights, ambient interior, puddle lights | lighting_weights{} | Object |
| 6 — Technology & Infotainment | Display sizes; infotainment; Apple CarPlay/Android Auto; streaming; OTA; audio tier | tech_weights{} | Object |
| 7 — Connectivity | GPS, in-car WiFi, 5G, OTA performance/security, mobile app control | connectivity_weights{} | Object |
| 7d — Mobile Device Support | Smartphone keyless entry; rear USB; wireless charging; standard power outlet | mobile_support_weights{} | Object |
| 8 — Seating & Cargo | Seating arrangement; roominess; seating features; cargo space; cargo access features | seating_config{}, seating_features{}, cargo_prefs{} | Mixed |
| 9 — Quality, Comfort & Appearance | Quality/durability; warranty; interior environment; exterior appearance | quality_weights{}, warranty_prefs{}, interior_weights{}, appearance_weights{} | Mixed |
| FINAL — Importance Ranking | All 16 category importance sliders: Less Important to Most Important | category_importance_weights{} | Object{category: float 0-1} |
| LEAD CAPTURE (optional) | Household vehicle count; driving environment; current vehicle; income; demographics; zip | demographics{} | Object |

#### 4.1.2 Buyer Fit Vector (BFV) Output

The BFV is a structured JSON object generated after profile completion.

**Formula per category score:**
```
category_score = SUM(feature_weight * feature_rating) * category_importance_multiplier
```

Hard constraints (excluded engine types, excluded body types, excluded brands) are stored separately as negative filters applied before scoring. Any vehicle failing a hard constraint receives a score of 0 regardless of other attributes.

#### 4.1.3 Technical Requirements

- Store each intake step result independently — allow partial saves so user can return and resume
- All slider values stored as floats 0.0–10.0, normalized to 0.0–1.0 in the BFV
- "Un-checked" features on any slider = hard exclude (stored as null, filtered in matching)
- Profile version control: BFV is re-generated on any change; prior versions are archived
- GHL integration: BFV completion triggers "Profiled" stage transition and initiates first matching run
- **Quick Match profiles** use simplified BFV with default weights; full profile override replaces entirely

---

### Module 2: Inventory Aggregation & Normalization Engine

This module maintains VCH's queryable vehicle inventory by ingesting bulk data from MarketCheck, normalizing it to a canonical schema, and providing real-time lookup when a specific vehicle needs to be acquired.

#### 4.2.1 MarketCheck Integration Strategy

| Mode | When Used / Purpose |
|------|---------------------|
| Bulk Data Feed (SFTP / API batch) | Background process. Runs nightly. Downloads all active listings within defined filters. Normalizes and upserts to the VCH Vehicle database. Powers the Matching Engine without hitting the real-time API. Reduces API costs by 90%+. |
| Real-Time API Lookup | Triggered ONLY at ACQUISITION_PENDING state. SourcingAgent validates listing is still active, confirms current price, retrieves full details before placing a bid or offer. |
| VIN Decode & History | Called during Quality Firewall check. Retrieves recall history, accident reports, ownership count, and title status. |
| Market Pricing Intelligence | Equity Alert post-sale feature and Market Report content series use the Statistics endpoint for depreciation and market pricing data. |

#### 4.2.2 Canonical Vehicle Schema

| Field | Source | Description |
|-------|--------|-------------|
| vin | MarketCheck / Dealer | 17-character VIN — primary key |
| listing_id | MarketCheck | External listing identifier for delta updates |
| year, make, model, trim | MarketCheck / VIN decode | Standard vehicle identification |
| body_type, sub_body_type | Normalized from MarketCheck | Maps to Intake Journey taxonomy |
| engine_type | MarketCheck fuel_type mapped to: Gasoline / Hybrid / BEV / PHEV / Diesel / FCEV | Maps to Intake preference categories |
| cylinders, displacement, forced_induction | MarketCheck specs | Engine configuration matching |
| drivetrain | Normalized to: FWD / RWD / AWD / 4WD | Drive type matching |
| mpg_city, mpg_hwy, mpg_combined | MarketCheck / DOE data | Fueling & Range matching |
| ev_range | MarketCheck (if BEV/PHEV) | Electric range in miles |
| towing_capacity_lbs | MarketCheck specs | Towing Capacity matching |
| odometer | MarketCheck | Mileage at listing time |
| condition_grade | Normalized to: Excellent / Good / Fair / Poor | Quality Firewall filter |
| price_asking | MarketCheck listing price | Starting point for deal desk pricing |
| price_wholesale_est | Calculated: market_price × regional_index | Internal cost basis estimate |
| location_zip, location_state | MarketCheck | Transport cost estimation |
| source_type | auction / dealer_wholesale / dealer_partner / manual | Acquisition path determination |
| source_url | MarketCheck listing_url | Used by SourcingAgent to navigate to listing |
| images[] | MarketCheck photos array | Stored as URL references; not re-hosted |
| features_raw[] | MarketCheck options array | Raw options list for feature matching |
| features_normalized{} | VCH feature mapping engine | Mapped to Intake Journey feature taxonomy |
| last_seen_active | Timestamp of last bulk update confirming active | Stale listing detection |
| available | Boolean | Filter for matching |
| quality_firewall_pass | Null until evaluated; True/False after QF check | Sourcing gate |
| created_at, updated_at | System timestamps | Audit trail |

#### 4.2.3 Bulk Ingestion Process

- MarketCheck bulk export job runs nightly at 2 AM ET
- Filter parameters: geographic_radius (configurable), condition_grade != Poor, price_range (configurable), vehicle_age <= 8 years, mileage <= 120,000
- New listings inserted; existing VINs updated (price, availability, condition)
- Listings not seen in bulk feed for >3 days are marked `available=false` pending real-time confirmation
- Feature normalization engine maps raw options strings to the Intake Journey feature taxonomy using a maintained lookup table + AI fallback for unmapped values
- Bulk load triggers feature extraction and BFV-compatibility scoring precompute

---

### Module 3: Match & Recommendation Engine

The Matching Engine takes a completed Buyer Fit Vector and scores all available vehicles in the inventory database, returning a ranked list of candidates with explainability text.

#### 4.3.1 Matching Algorithm

**Phase 1 — Hard Constraint Elimination:**
- Excluded body types: `vehicle.body_type NOT IN buyer.body_types_excluded`
- Excluded engine types: `vehicle.engine_type NOT IN buyer.engine_types_excluded`
- Excluded brands: `vehicle.make NOT IN buyer.brands_excluded`
- Price ceiling: `vehicle.price_asking <= buyer.max_budget` (if set)
- Geographic availability: vehicle reachable within logistics parameters
- Quality Firewall: `quality_firewall_pass = True OR pending evaluation`

**Phase 2 — Weighted Score Calculation:**
```
match_score = SUM FOR EACH category:
  ( category_score(vehicle, buyer) * category_importance_weight(buyer) )
```

**Quick Match Simplified Scoring (v2):**
```
quick_score = (body_type_match * 0.30) +
              (budget_fit * 0.30) +
              (priority_alignment * 0.25) +
              (brand_preference * 0.15)
```

#### 4.3.2 Recommendation Output

The engine returns the top N matches (default 10) with:
- Ranked match_score (0.0 to 1.0)
- Year, Make, Model, Trim, Mileage, Price, Location
- Match explainability summary (natural language)
- Vehicle photos (from MarketCheck)
- Side-by-side feature gap report: features buyer rated Important that vehicle lacks
- "Estimated Total Cost" card: asking price + estimated transport + VCH fee + registration estimate
- **Three price points** (per MarketCheck Price™ integration): Average Retail, VCH Target Acquisition, Your Estimated OTD
- **"Danny Savings" figure** — the gap between Retail and VCH OTD

#### 4.3.3 Matching Triggers

- **Auto-run:** When buyer state transitions to PROFILED
- **Manual re-run:** Buyer requests updated results from client dashboard
- **Scheduled re-run:** Every 48 hours while buyer is in MATCHING state
- **Preference update:** Any change to BFV triggers immediate re-run

---

### Module 4: Pricing / Deal Desk Engine

The Deal Desk Engine calculates the complete out-the-door cost estimate for any vehicle candidate and assembles the formal deal structure once a vehicle is selected.

#### 4.4.1 Cost Component Model

| Component | Source | Calculation Method |
|-----------|--------|-------------------|
| Wholesale/Acquisition Cost | MarketCheck real-time price at ACQUISITION_PENDING | API call to confirm current price; add auction buyer's fee if applicable |
| Auction Fees | Per-auction fee schedule (config table) | Lookup by auction source + vehicle price tier |
| Transport Cost | Carrier quote OR zip-to-zip distance table | Central Dispatch API quote; fallback to per-mile estimate |
| Reconditioning Estimate | Condition grade → recon cost table | Lookup by condition_grade; flag for inspection if Fair |
| VCH Service Fee | Flat fee per contract tier | Lookup by tier (Standard / Premier / Concierge) |
| Lender / F&I Back-End | Financing reserve, GAP, warranty | Configured per lender agreement; optional add-ons |
| Title & Registration Fees | Buyer state registration fee schedule | Lookup table by state + vehicle value |
| VCH Gross Margin | Buyer Total Price - All Costs | Must exceed minimum_margin_threshold; below triggers HITL |
| Buyer Out-the-Door Price | Sum of all buyer-facing components | Presented in deal summary; requires buyer acceptance |

#### 4.4.2 Deal Desk Review Triggers (HITL)

- Gross margin below minimum threshold
- Vehicle price above $75,000 (configurable)
- Buyer financing with non-preferred lender
- Out-of-state title complexity flag
- Vehicle condition grade = Fair
- Any lender exception or stip requiring manual review

---

### Module 5: Funding & Commitment Orchestration

This module enforces the pre-qualification-first philosophy. No sourcing activity is triggered until funding is confirmed.

#### 4.5.1 Funding States

| Funding State | Description | Agent Action |
|---------------|-------------|--------------|
| CREDIT_APP_PENDING | Buyer started credit app but not submitted | FundingAgent sends reminders at 24h, 48h, 72h |
| CREDIT_APP_SUBMITTED | Application submitted to lender routing | FundingAgent initiates soft-pull and waterfall |
| PRE_APPROVED | Lender returns conditional approval | FundingAgent presents terms to buyer |
| TERMS_ACCEPTED | Buyer accepts loan terms | Transitions to VEHICLE_SELECTED |
| FINAL_APPROVAL_PENDING | Vehicle-specific final approval requested | FundingAgent submits VIN, deal structure, and docs |
| FULLY_FUNDED | Lender confirms disbursement | GO signal to SourcingAgent |
| CASH_BUYER | Proof of funds confirmed | Immediate go signal |
| FUNDING_FAILED | Lender declines or buyer withdraws | Exception; escalate to Deal Desk |

#### 4.5.2 Required Documents — Funding Package

- Government-issued photo ID (both sides)
- Proof of income (2 most recent pay stubs OR 2 years tax returns for self-employed)
- Proof of insurance binder (must include VCH as lienholder if financed)
- Signed credit application
- Signed service agreement with VCH
- Down payment confirmation (ACH authorization or wire receipt)
- Proof of residence (utility bill or bank statement < 60 days)

All documents collected via DocuSign integration. FundingAgent monitors for missing items and sends automated follow-up sequences. Incomplete packages after 7 days trigger human escalation.

---

### Module 6: Acquisition Execution Engine

The Acquisition Engine executes the actual vehicle purchase after the go-signal is received.

#### 4.6.1 Acquisition Paths

| Path | Description & Agent Behavior |
|------|------------------------------|
| Auction Path (ADESA / Manheim / OVE) | SourcingAgent navigates to listing URL using computer-use agent. Verifies price, reviews condition report, runs Quality Firewall, executes bid up to max_bid_price. If outbid, follows escalation rules. Auction arbitration handled by DMSAgent. |
| Dealer Wholesale Path | SourcingAgent contacts dealer partner via automated email/SMS. Presents VIN, offer price, and time-limited acceptance window. Accepted offers trigger Purchase Order. Negotiation beyond 2 counter-offers escalates to human. |
| Dealer Partner Priority | Before auction bids, SourcingAgent checks if any Dealer Partner has matching unit on aged inventory (90+ days on lot). |

#### 4.6.2 Quality Firewall — Pre-Purchase Checklist

| Check | Pass Criteria | Fail Action |
|-------|---------------|-------------|
| Condition Grade | Good or Excellent (Fair requires human approval) | Flag for Sourcing Supervisor |
| Accident History | No structural damage in CarFax/AutoCheck | Auto-reject |
| Title Status | Clean title ONLY | Auto-reject |
| Odometer Consistency | No rollback flag | Auto-reject |
| Open Recalls | Zero open safety recalls OR confirmed complete | Hold sourcing |
| Ownership Count | 1–2 preferred; 3+ triggers review | Flag only |
| Price Sanity Check | Acquisition price <= max_bid_price | Auto-reject bid |
| Geographic Availability | Within logistically feasible range | Flag with transport cost |

---

### Module 7: DMS-Lite — Documents, Title & Compliance

#### 4.7.1 Document Workflow

| Document | Generated By | Signed By | Timing |
|----------|-------------|-----------|--------|
| Digital Service Agreement | DMSAgent | Buyer | At ENGAGED |
| Buyer Order / Purchase Agreement | DMSAgent | Buyer + VCH rep | After vehicle selection |
| Credit Application | FundingAgent | Buyer | At PRE_QUALIFYING |
| Retail Installment Contract (RISC) | Lender-generated | Buyer | At FUNDING |
| Bill of Sale | DMSAgent | VCH + Seller | At ACQUIRED |
| Odometer Disclosure | DMSAgent | Seller + Buyer | At ACQUIRED |
| Title Assignment | Seller → VCH → Buyer | Title Clerk (HITL) | Within 10 business days |
| Registration Application | DMSAgent | Buyer | At CLOSED_WON |
| GAP Addendum | DMSAgent | Buyer | At FUNDING (if selected) |
| Warranty Agreement | Third-party VSC | Buyer | At FUNDING (if selected) |
| Delivery Inspection Checklist | LogisticsAgent | Buyer | At delivery |
| **Return Authorization (v2)** | **ReturnAgent** | **Buyer** | **At RETURN_PENDING** |
| Post-Sale Satisfaction Survey | CommunicationAgent | Buyer | 48h after delivery |

#### 4.7.2 Title Processing Workflow

1. DMSAgent receives BOS and title from seller; uploads to Title Case record
2. DMSAgent performs automated title lien check and assignment validity check
3. If clean → auto-advances to registration prep and buyer notification
4. If title exception → EXCEPTION state; Title Clerk notified immediately
5. Title Clerk resolves; overrides state; documents resolution in audit log
6. Out-of-state titles → DMSAgent generates state-specific reassignment paperwork

#### 4.7.3 Compliance Requirements

- FTC Safeguards Rule (customer data handling)
- Used Car Rule (FTC): Buyer's Guide disclosure for every transaction
- State-specific dealer licensing compliance (FL license primary; out-of-state via licensed partner)
- OFAC screening on all buyers and transactions (auto; hit triggers immediate human review)
- Red Flags Rule (identity verification via credit header)
- Document retention: 7 years minimum, encrypted, with access logging

---

### Module 8: Logistics & Delivery Engine

#### 4.8.1 Logistics Workflow

1. On ACQUIRED state: LogisticsAgent pulls vehicle location and buyer delivery address
2. Submits transport quote request to Central Dispatch API with origin/destination/specs
3. Quotes returned within SLA (2–4 hours); selects lowest-cost carrier meeting reliability minimum
4. Transport cost fed back to Deal Desk for final reconciliation
5. Carrier booking → creates Shipment record with tracking URL
6. Buyer notification: "Your vehicle has been assigned a carrier. Estimated delivery: [DATE]"
7. LogisticsAgent polls tracking API every 6 hours; sends status updates at key milestones
8. At delivery: sends digital Delivery Inspection Checklist
9. Buyer submits checklist → DELIVERED state
10. Damage at delivery → EXCEPTION + human notification within 15 minutes

#### 4.8.2 Carrier Performance Tracking

Each carrier tracked with: on-time delivery rate, damage claim rate, communication responsiveness. Below-threshold carriers auto-removed from quote pool. Monthly scorecard for Operations Admin.

---

### Module 9: Client Dashboard & AI Agent Workspace

#### 4.9.1 Client Dashboard Features

- Deal stage tracker (visual pipeline matching state machine)
- Tasks pending (docs to sign, info to provide, decisions to make)
- My Favorites: saved vehicle listings
- Recommendation results view (matches with scores and explainability)
- "Ask Danny" chat interface — conversational AI with full deal context
- Document vault (all signed/pending documents)
- Delivery tracker (map + ETA when in-transit)
- Notifications inbox (all communications with history)
- Profile editor (update preferences → triggers re-matching)
- **Return initiation button** (visible only during 7-day window after delivery)

#### 4.9.2 "Danny" Conversational AI Agent

Danny the Deal Advisor is the buyer-facing AI persona. Built on base LLM with specialized system prompt and MCP tools:

| Tool | Function |
|------|----------|
| get_buyer_profile(buyer_id) | Returns current BFV and preferences |
| get_deal_status(deal_id) | Returns current state, pending tasks, next steps |
| get_recommendations(buyer_id) | Returns current ranked vehicle matches |
| update_preference(buyer_id, category, value) | Updates preference and triggers re-match |
| get_document_status(deal_id) | Returns document list with signed/pending status |
| get_delivery_status(deal_id) | Returns carrier tracking info |
| schedule_callback(buyer_id, preferred_time) | Books human callback |
| submit_escalation(deal_id, reason) | Triggers HITL checkpoint |
| **initiate_return(deal_id, reason)** | **Starts 7-day return process (v2)** |

Danny persona rules: direct, consumer-advocacy-focused, anti-dealer-jargon. All interactions logged. Danny cannot override state machine states.

#### 4.9.3 Internal Agent Workspace

- Real-time deal board: all active deals by state with health indicators (green/yellow/red)
- Exception queue: deals in EXCEPTION state with AI-generated summary and recommended actions
- Agent activity log: timestamped record of every agent action
- Quality Firewall review queue
- Carrier performance dashboard
- Funding pipeline: deals by funding state with aging
- Audit log viewer: complete AuditEvent trail, filterable
- **Return tracking queue (v2):** active returns with carrier pickup status

---

## 5. CANONICAL DATA MODEL

GHL serves as source-of-truth for Contact, Opportunity, and Communication records. Custom objects maintained in VCH database and synced bi-directionally via webhooks and GHL Custom Objects API.

| Object | Primary Store | Key Fields | GHL Sync |
|--------|---------------|------------|----------|
| Contact | GHL (primary) | id, first_name, last_name, email, phone, source, tags[], custom_fields{} | Native GHL |
| BuyerProfile | VCH DB (synced to GHL) | contact_id, profile_tier, bfv_json, intake_steps_complete[], hard_constraints{}, demographics{}, version | Completion % synced to Contact custom field |
| Deal | GHL Opportunity + VCH DB | id, contact_id, stage, assigned_agent, deal_desk_flags[], human_checkpoint_required | Native GHL + VCH extensions |
| Vehicle | VCH DB (primary) | vin, listing_id, all schema fields, bfv_compatibility_scores{}, quality_firewall_pass | Key fields synced to GHL custom object |
| VehicleMatch | VCH DB | deal_id, vin, match_score, explainability_text, status | Selection event syncs to GHL notes |
| FundingCase | VCH DB + GHL custom | deal_id, funding_state, lender_id, approval_amount, apr, term_months, conditions[] | Funding state synced to GHL stage |
| Document | VCH DB + DocuSign | deal_id, doc_type, status, signer_role, signed_at, storage_url | Status synced to GHL |
| AcquisitionOrder | VCH DB | deal_id, vin, acquisition_path, bid_ceiling, actual_price, seller_id | Key milestones to GHL notes |
| TitleCase | VCH DB | deal_id, vin, title_state, title_type, lien_status, exceptions[] | Status synced to GHL |
| Shipment | VCH DB | deal_id, vin, carrier_id, tracking_url, delivery_condition_report | Delivery date synced to GHL |
| AuditEvent | VCH DB (append-only) | id, deal_id, event_type, actor, previous_state, new_state, payload_json, timestamp | Not synced — compliance only |
| Carrier | VCH DB | id, name, mc_number, on_time_rate, damage_claim_rate, active | Not synced |
| DealerPartner | GHL Contact + VCH DB | ghl_contact_id, dealer_license, rooftop_locations[], preferred_brands[] | GHL Contact primary |
| **ReturnCase (v2)** | **VCH DB** | **deal_id, vin, return_reason, return_state, initiated_at, vehicle_received_at, refund_amount, restocking_fee** | **Status synced to GHL** |
| **DealOutcome (v2)** | **VCH DB** | **deal_id, acquisition_cost, sell_price, gross_margin, market_retail_at_close, cycle_time_days, channel** | **Not synced — analytics only** |

---

## 6. GOHIGHLEVEL INTEGRATION ARCHITECTURE

### 6.1 What Lives in GHL (Source of Truth)

- Contact records — all buyer and dealer partner contact data
- Opportunity Pipeline — deal stage tracking (maps to VCH state machine)
- Calendar & Appointment scheduling
- Email / SMS / Voice workflows and sequences
- Campaign attribution and UTM tracking
- Form submissions
- Call recordings and conversation history
- User management and permission roles

### 6.2 What Lives in VCH Custom Database (Source of Truth)

- BuyerProfile / Buyer Fit Vector (complex JSON; GHL stores summary only)
- Vehicle inventory (50,000+ records; GHL cannot handle this volume)
- Match scores and recommendation history
- Funding case details and lender data
- Acquisition orders, bids, sourcing history
- Title case and DMS records
- Shipment and carrier tracking records
- AuditEvent log (immutable; compliance record)
- **DealOutcome records (analytics — Section 15)**
- **ReturnCase records (Section 20)**

### 6.3 Sync Architecture

VCH backend exposes webhook receiver and publishes events to GHL via REST API. GHL publishes Contact and Opportunity events to VCH webhook endpoint. Bi-directional sync.

### 6.4 GHL Pipeline Stages

```
Lead → Pre-Qualifying → Qualified → Engaged → Profiled → Matching →
Vehicle Selected → Funding → Acquisition Pending → Acquired → In-Transit →
Delivered → Return Pending → Closed Won | Closed Lost | Exception
```

### 6.5 GHL Automation Workflows

| Workflow | Trigger & Actions |
|----------|-------------------|
| Lead Welcome Sequence | New Contact tagged "Lead" → SMS Danny intro → 24h email explainer → 48h content → 72h pre-qual CTA |
| Qualification Reminder | Pre-Qualifying > 48h without credit app → SMS → 24h email → 48h AI voice call task |
| Profile Completion Nudge | Engaged stage; BuyerProfile < 80% after 24h → Email → SMS → 72h human follow-up task |
| Matching Results Notification | "matching_complete" webhook → Email "Top Matches Ready" → SMS with count |
| Funding Follow-up | Vehicle Selected > 48h without TERMS_ACCEPTED → Email FAQ → SMS CTA |
| Delivery Countdown | Shipment created → Confirmation email → 48h-before SMS → Day-of checklist link |
| Post-Delivery Review Request | Delivered → 48h email Google/Facebook review → 72h SMS referral link → 30-day check-in |
| Danny Dollar Referral Enrollment | Closed Won → Email unique referral code → Enroll in Equity Alert sequence |
| Re-engagement (Disqualified) | Disqualified 90 days → "Things may have changed" email → Danny chat CTA |
| Exception Alert | Exception webhook → GHL task (HIGH) → SMS to on-call → Audit log entry |
| **Return Initiated (v2)** | **RETURN_PENDING state → Email return instructions → SMS carrier pickup ETA → Refund timeline** |

---

## 7. AI AGENT ARCHITECTURE

VCH employs a multi-agent system where each agent is a specialized LLM-based process with defined tools, permissions, and escalation thresholds.

### 7.1 Agent Roster

| Agent | Primary Function | Key Tools | Human Escalation |
|-------|-----------------|-----------|-----------------|
| InboundAgent | First contact; qualification routing; all inbound channels | GHL conversation API, lead scoring, pre-qual questionnaire, Telnyx AI | Distress; legal threat; human request |
| QualificationAgent | Credit pre-screening; income verification; lender soft-pull | Credit bureau API, income verification, lender pre-qual API | All disqualifications reviewed within 24h |
| IntakeAgent | Guides buyer through intake steps; saves progress | BuyerProfile API (r/w), intake UI state, Danny persona | Only on explicit human request |
| MatchingAgent | Runs BFV scoring; generates explainability; presents recommendations | Matching Engine API, Vehicle DB, MarketCheck API | Only on buyer escalation |
| FundingAgent | Lender routing, doc collection, approval tracking | Lender API, DocuSign API, FundingCase state manager | FUNDING_FAILED; manual review; >$75K |
| SourcingAgent | Vehicle acquisition via auction or dealer outreach | Computer-use agent, dealer templates, Quality Firewall, MarketCheck real-time | >$50K bids; QF failures; disputes |
| DMSAgent | All transaction documents; title case management | Document templates, DocuSign API, title check, VIN history | Title exceptions; wet signatures; OFAC |
| LogisticsAgent | Carrier quotes, transport booking, delivery monitoring | Central Dispatch API, carrier tracking, delivery checklist | Damage; no-show; delay >48h |
| CommunicationAgent | All scheduled/event-driven buyer comms; "Danny" persona | GHL email/SMS, social DM API, MarketCheck data | Legal threat; media mention; complaint |
| OrchestratorAgent | Task routing; agent health; stalled deal detection | All agent APIs, AuditEvent log, GHL webhooks | Stalled > SLA; repeated agent errors |
| **ReturnAgent (v2)** | **Manages 7-day return process; arranges return transport** | **Return case API, carrier booking, refund calculator** | **Any dispute; restocking fee waiver request** |

### 7.2 MCP Server Architecture

| MCP Server | Tools Exposed |
|------------|---------------|
| vch-crm-mcp | get_contact, update_contact, create_opportunity, update_opportunity_stage, add_note, send_sms, send_email, create_task, get_conversation_history |
| vch-inventory-mcp | search_vehicles, get_vehicle, run_quality_firewall, update_vehicle_availability, get_market_pricing |
| vch-matching-mcp | run_match, get_recommendations, get_match_explainability, save_favorite, reject_vehicle |
| vch-funding-mcp | get_funding_case, update_funding_state, submit_credit_app, get_lender_terms, confirm_funding |
| vch-sourcing-mcp | get_acquisition_order, submit_auction_bid, contact_dealer, confirm_acquisition, run_vin_history |
| vch-dms-mcp | generate_document, send_for_signature, get_document_status, check_title_status, create_title_case |
| vch-logistics-mcp | get_transport_quote, book_carrier, get_tracking_status, report_delivery |
| vch-audit-mcp | log_event, get_audit_trail, get_agent_activity_log |
| **vch-returns-mcp (v2)** | **initiate_return, get_return_case, calculate_refund, book_return_transport, confirm_vehicle_received** |
| marketcheck-mcp | search_inventory, get_listing, get_vin_history, get_market_stats, get_dealer_inventory |
| ghl-native-mcp | Standard GHL MCP tools for Danny persona actions |

---

## 8. HUMAN-IN-THE-LOOP (HITL) ARCHITECTURE

### 8.1 HITL Checkpoint Registry

| ID | Trigger | Human Role | SLA | Agent Behavior |
|----|---------|-----------|-----|---------------|
| HITL-01 | Gross margin below minimum | Deal Desk | 4 biz hours | Deal paused; Danny notifies buyer |
| HITL-02 | Vehicle price > $75K | Deal Desk | 4 biz hours | All activity paused |
| HITL-03 | Auction bid ceiling reached | Sourcing Supervisor | 2 biz hours | Bidding paused; buyer notified |
| HITL-04 | QF failure requiring waiver | Sourcing Supervisor | 4 biz hours | Next-best alternative presented |
| HITL-05 | Title exception | Title Clerk | 1 biz day | Delivery paused; buyer notified |
| HITL-06 | Out-of-state wet signature | Title Clerk | 2 biz days | Other docs proceed |
| HITL-07 | FUNDING_FAILED | Deal Desk | 4 biz hours | Secondary lender attempted |
| HITL-08 | OFAC hit | Operations Admin | 15 minutes | ALL activity suspended |
| HITL-09 | Delivery damage reported | Operations Admin | 1 biz hour | Photo docs collected; carrier dispute started |
| HITL-10 | Pre-disqualification review | Deal Desk | 24 biz hours | Notice held pending review |
| HITL-11 | Deal stalled > SLA | Operations Admin | Daily review | Flagged in morning queue |
| HITL-12 | Buyer escalation via Danny | Ops Admin / Deal Desk | 2 biz hours | Danny holds; callback scheduled |
| **HITL-13 (v2)** | **Return initiated; dispute over condition** | **Operations Admin** | **4 biz hours** | **ReturnAgent holds; documentation collected** |

---

## 9. MARKETCHECK INTEGRATION SPECIFICATION

### 9.1 Inventory API — Listing Search & Aggregation

| Endpoint | VCH Use Case | Frequency | Module |
|----------|-------------|-----------|--------|
| GET /v2/search/car/active | Bulk nightly ingestion | Nightly batch | Module 2 |
| GET /v2/listing/{id} | Real-time validation at ACQUISITION_PENDING | Per-deal | Module 6 |
| GET /v2/decode/car/{vin}/specs | VIN decode for normalization | Per new VIN | Module 2, 6 |
| GET /v2/history/car/{vin} | Vehicle history for Quality Firewall | Per acquisition | Module 6 |
| GET /v2/search/car/inactive | Delta sync — mark sold listings | Nightly | Module 2 |
| GET /v2/dealer/{dealer_id}/active | Dealer partner inventory | On-demand | Module 6 |
| GET /v2/stats/car | Market stats for Equity Alerts and content | Weekly + on-demand | Module 4, 10 |

### 9.2 MarketCheck Price™ — Retail Valuation Engine

**What it is:** A separate, dedicated valuation product. VCH's primary source for RETAIL vehicle valuations.

**Specifications:**
- 262M+ unique VINs, 540M retail listings
- Within 5% of actual transaction price (within 4% on 1-5 year vehicles)
- Daily data refresh
- NeoVIN integration for as-built equipment per VIN
- Tiers: Base (Price + MSRP) | Premium (+ comparable listings) | Premium Plus (+ full NeoVIN)

**When VCH calls MarketCheck Price™:**

| Trigger | Tier Needed | Data Used For | Module |
|---------|-------------|---------------|--------|
| Vehicle added to recommendations | Premium | Display retail value; calculate "Danny Savings" | Module 3 |
| Deal Desk pricing at VEHICLE_SELECTED | Premium Plus | Set buyer price; confirm feature accuracy | Module 4 |
| Acquisition validation at ACQUISITION_PENDING | Premium | Confirm acquisition < retail | Module 6 |
| Equity Alert (quarterly post-sale) | Base | Current retail value for equity calc | Module 10 |
| Market Report content (monthly) | Base (Stats) | Depreciation curves and regional pricing | Module 10 |
| Deal Pattern Learning Loop | Base | Retail value at close for margin analysis | Section 15 |

**Buyer-facing display (3 price points):**
1. "Average Retail Market Price" — from MarketCheck Price™
2. "VCH Target Acquisition Price" — Deal Desk estimate
3. "Your Estimated Out-the-Door" — VCH price including fee and transport

The gap between #1 and #3 is the **"Danny Savings"** figure. This must be grounded in real MarketCheck Price™ data, never estimated. Any inflation is a brand-killing risk.

**Caching:** MarketCheck Price™ responses cached per VIN for 24 hours. Cache invalidates on new bulk ingestion. Never cache longer than 24 hours.

---

## 10. MARKETING ENGINE INTEGRATION

### 10.1 "Danny the Deal Advisor" AI Persona

Danny appears across all buyer touchpoints. Persona rules:
- Tone: Direct, consumer-advocate, anti-dealer-jargon, credible
- Core message: transparency, wholesale access, flat-fee fairness
- Never disparage specific dealerships by name (legal risk)
- All responses pass compliance gate before sending

### 10.2 TikTok Automotive Inventory Ads — Catalog Feed

Nightly catalog feed from quality-firewall-passing vehicles. Each listing includes: photos, VCH price, MarketCheck retail price, percentage savings, deep link with UTM parameters.

### 10.3 SEO Content Automation

- MarketCheck Statistics API for dynamic pricing in Buyer's Guide pages
- Inventory count endpoint for programmatic SEO "See X available" widgets
- Dealer fee data by state/city for Local Fee Hunter pages

### 10.4 Danny Dollar Referral Program

GHL-implemented. On Closed Won → generate unique referral code → enrollment in referral sequence → attribution via UTM + code → payout trigger on referred Closed Won → auto-congratulations email.

### 10.5 Equity Alert Automation

Quarterly GHL workflow. CommunicationAgent calls MarketCheck Stats for buyer's vehicle. If value > 90% paid (equity) or < 80% paid (depreciation) → personalized email with CTA.

---

## 11. MVP SCOPE — FIRST 50 TRANSACTIONS

### 11.1 MVP In Scope

| Area | MVP Scope |
|------|-----------|
| **Buyer Intake** | Quick Match (5-step) + Full Profile available; web only; no mobile app |
| **Pre-Qualification** | Single lender soft-pull (FL-based credit union); manual review all disqualifications |
| **Matching** | Full BFV scoring against MarketCheck bulk feed; Quick Match simplified scoring; top 10 results in list UI |
| **Client Dashboard** | Read-only deal stage tracker + document status + Danny chat; no native tracking map |
| **Danny Chat** | Website and client dashboard; MCP tools for deal status and recommendations |
| **Deal Desk** | Engine logic implemented but human reviews every deal (learning phase) |
| **Funding** | Single lender; DocuSign doc collection; FundingAgent tracks status only |
| **Acquisition — Dealer** | Fully automated email-based outreach; 5 Dealer Partners onboarded |
| **Acquisition — Auction** | HUMAN-executed; SourcingAgent generates bid recommendation; human executes |
| **DMS** | DocuSign for all docs; Title Clerk handles all title cases manually; DMSAgent generates templates |
| **Logistics** | Central Dispatch manual posting; LogisticsAgent generates quote request; human posts |
| **7-Day Return** | Full return flow implemented with manual carrier booking for return transport |
| **GHL Integration** | Full pipeline sync; all 11 automation workflows; Contact and Opportunity sync |
| **MarketCheck** | Bulk nightly feed + real-time validation + MarketCheck Price™ on recommendations |
| **Reporting** | GHL native reporting; basic VCH admin dashboard with deal counts and exception queue |
| **Analytics** | GA4 on all pages; key conversion events tracked; basic Mixpanel funnel |

### 11.2 Explicitly NOT in MVP

- Full auction computer-use agent (automated bidding)
- Automated carrier booking via Central Dispatch API
- Multi-lender waterfall routing
- Vehicle comparison tool on recommendations
- Mobile app (iOS/Android)
- TikTok Inventory Ads catalog feed
- Equity Alert automation
- Scam Map crowdsourced feature
- Danny's Garage community integration
- Advanced Deal Desk automation (exception-only reviews)
- Social media Danny bot (Facebook/Instagram DMs)
- Trade-in valuation tool

### 11.3 Phase 2 Roadmap (Post-50 Deals)

| Priority | Feature | Trigger |
|----------|---------|---------|
| P1 | Multi-lender waterfall | First funding failure where secondary lender would have saved deal |
| P1 | Automated auction bidding | Human auction execution becomes bottleneck (>5 deals/week) |
| P2 | Automated carrier booking | Carrier booking becomes bottleneck |
| P2 | Vehicle comparison UI | >30% of buyers save 3+ favorites |
| P2 | TikTok Inventory Ads | Marketing budget available for paid inventory ads |
| P3 | Mobile app | >50% dashboard traffic from mobile |
| P3 | Equity Alert | 50+ Closed Won contacts accumulated |
| P3 | Scam Map | Community engagement metrics justify investment |

---

## 12. TECHNOLOGY STACK (LOCKED)

> **v2 Decision:** Python (FastAPI) selected over Node.js. Rationale: better ML/data library ecosystem for matching engine; simpler agent orchestration with async/await; team familiarity.

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| CRM / Automation | GoHighLevel (SaaS) | Contact management, pipelines, email/SMS/voice, calendaring, forms, billing |
| Backend API | **Python (FastAPI)** | REST + webhook handler; all VCH custom business logic; async native |
| Database (Primary) | PostgreSQL | Relational; ACID; handles 50K+ vehicles, deals, audit events |
| Database (Cache / Queue) | Redis | Job queue, BFV matching runs, API rate limiting, MarketCheck cache |
| Background Jobs | **Celery + Redis** | Nightly ingestion, matching re-runs, equity alerts, scheduled tasks |
| AI Agent Framework | Anthropic Claude API (Sonnet) + MCP servers | All agent tooling via standardized interfaces |
| Computer-Use Agent | Anthropic Claude Computer Use API | Authenticated auction portal navigation (Phase 2 for automation) |
| Document E-Sign | DocuSign API | Envelope generation, status webhooks, document storage |
| Telephony / Voice AI | Telnyx | Inbound/outbound voice with AI, SMS, call recording; GHL integration |
| Carrier / Logistics | Central Dispatch API | Transport quotes, carrier assignment, tracking |
| Vehicle Data | MarketCheck API | Bulk feed + real-time lookup + Price™ valuation |
| File Storage | AWS S3 | Documents, vehicle images cache, audio recordings |
| Auth | **Supabase Auth** | Buyer portal login (OAuth2/JWT); staff SSO; simpler than Auth0 for MVP |
| Infrastructure | AWS (ECS + RDS + ElastiCache) | Auto-scaling; 99.9% uptime target |
| Monitoring | **Datadog** | API latency, agent error rates, SLA breach alerts, API quota monitoring |
| Analytics | **GA4 + Mixpanel** | Page analytics (GA4); product analytics and funnel tracking (Mixpanel) |
| Frontend (Buyer Portal) | React + Next.js | SSR for SEO pages; SPA for dashboard and intake |
| Frontend (Admin Workspace) | React (internal tool) | Agent monitor, exception queue, deal board |
| CI/CD | GitHub Actions | Automated testing, staging deploy, production gates |
| ORM | **SQLAlchemy + Alembic** | Database models and migration management |
| API Documentation | **FastAPI auto-docs (Swagger/ReDoc)** | Auto-generated from Pydantic models |

---

## 13. ACCEPTANCE CRITERIA & QA TEST PLAN

### 13.1 Critical Path Test Scenarios

| Test ID | Scenario | Pass Criteria |
|---------|----------|---------------|
| TC-01 | Web form submit → InboundAgent → GHL Contact created | Contact within 60s; stage = Lead; welcome sequence enrolled |
| TC-02 | QualificationAgent soft pull → pre-approval → Qualified | FundingCase created; GHL updated; notification sent |
| TC-03 | Quick Match 5-step completed; simplified BFV; recommendations returned | Results within 15s; scores 0.0–1.0; budget-filtered correctly |
| TC-04 | Full intake completed; BFV generated; stage → Profiled | All 24 steps stored; BFV valid; GHL "Profile Complete" = True |
| TC-05 | MatchingAgent runs on full BFV; 10 recommendations with explainability | Results within 30s; explainability references actual features |
| TC-06 | Nightly MarketCheck bulk ingestion completes | < 2-hour runtime; inserts/updates/deletes applied correctly |
| TC-07 | Real-time MarketCheck API at ACQUISITION_PENDING | API logged; vehicle record updated; QF check within 60s |
| TC-08 | DocuSign service agreement sent → signed → ENGAGED | Envelope within 60s; webhook processed; stage updated |
| TC-09 | Deal Desk flag → GHL task → human resolves → deal resumes | Task assigned correctly; AuditEvents logged; resume within 60s of override |
| TC-10 | Title exception → EXCEPTION → Title Clerk notified | Exception logged; task created; SMS within 60s; visible in queue |
| TC-11 | Full deal cycle Lead → Closed Won | All 14+ transitions logged; all docs present; GHL reflects Closed Won |
| TC-12 | Danny chat: "What is my deal status?" | Correct state; no hallucination; response < 10s |
| TC-13 | OFAC hit simulation | Suspended within 60s; HIGH task; AuditEvent logged |
| TC-14 | **7-Day return initiated; return case created; refund calculated** | **Return case exists; refund amount correct; buyer notified; GHL updated** |
| TC-15 | **Quick Match → Full Profile upgrade → re-matching** | **Quick results cleared; full BFV generated; new results with higher precision** |

### 13.2 Non-Functional Requirements

- API response time: all agent tool calls < 2 seconds p95
- Client dashboard page load: < 3 seconds p95
- Quick Match results: < 15 seconds (simplified scoring)
- Full BFV matching: < 30 seconds for 50,000 vehicles
- MarketCheck bulk ingestion: < 2-hour nightly window
- System uptime: 99.9% (< 8.7 hours downtime per year)
- Data encryption: all PII encrypted at rest (AES-256) and in transit (TLS 1.3)
- Document retention: 7 years minimum with access logging
- HITL notification delivery: < 60 seconds of trigger
- Database backup: daily automated; 30-day retention; tested monthly restore

---

## 14. OPEN QUESTIONS & DECISIONS NEEDED

| # | Question | Impact | Owner | Status |
|---|----------|--------|-------|--------|
| OQ-01 | Which lender(s) for MVP? FL credit union name + API docs needed. | Blocks FundingAgent + RISC templates | Joe | OPEN |
| OQ-02 | Which auction portals active at MVP? ADESA? Manheim? OVE? | Determines computer-use agent scope | Joe | OPEN |
| OQ-03 | Which DocuSign plan/account? | Blocks document module | Joe | OPEN |
| OQ-04 | Florida dealer license status and number | Blocks compliance + title modules | Joe | OPEN |
| OQ-05 | Which 5 Dealer Partners at launch? Contact info + inventory format. | Required for dealer sourcing config | Joe | OPEN |
| OQ-06 | Flat fee amounts by tier (Standard / Premier / Concierge) | Blocks Deal Desk pricing logic | Joe | OPEN |
| OQ-07 | Minimum acceptable gross margin per deal ($ or %) | Blocks HITL threshold config | Joe | OPEN |
| OQ-08 | Geographic scope at MVP? FL only vs. nationwide. | 10x impact on title/registration module | Joe | OPEN |
| OQ-09 | MarketCheck account tier and API quota | Required for Module 2 architecture | Joe | OPEN |
| OQ-10 | Existing GHL account and sub-account structure | Determines GHL setup scope | Joe | OPEN |
| **OQ-11** | **Restocking fee on 7-day returns ($ or %)? Or fully free?** | **Impacts return policy economics + marketing claims** | **Joe** | **OPEN** |
| **OQ-12** | **AWS account and region preference** | **Infrastructure setup** | **Joe** | **OPEN** |
| **OQ-13** | **Danny voice persona — specific voice model ID from Telnyx?** | **InboundAgent voice configuration** | **Joe** | **OPEN** |

---

## 15. DEAL INTELLIGENCE & LEARNING LOOP

> **This section was referenced in v1 (Section 9.2 MarketCheck Price™ integration) but never written. v2 adds it.**

### 15.1 Purpose

The Deal Intelligence system captures outcome data from every closed deal and feeds it back into the platform to improve pricing accuracy, matching quality, and operational efficiency over time.

### 15.2 DealOutcome Record

On every CLOSED_WON and CLOSED_LOST, a DealOutcome record is created:

```python
class DealOutcome:
    deal_id: str
    contact_id: str
    outcome: str  # "won" | "lost" | "returned"
    # Timing
    lead_created_at: datetime
    closed_at: datetime
    cycle_time_days: int
    time_in_each_state: dict  # {state: hours}
    # Financial
    acquisition_cost: float
    auction_fees: float
    transport_cost: float
    recon_cost: float
    vch_fee: float
    sell_price: float
    gross_margin: float
    gross_margin_pct: float
    market_retail_at_close: float  # from MarketCheck Price™
    spread_vs_retail: float
    # Vehicle
    vin: str
    year: int
    make: str
    model: str
    body_type: str
    odometer: int
    condition_grade: str
    source_type: str  # auction | dealer_wholesale | dealer_partner
    # Matching
    match_score: float
    buyer_profile_tier: str  # "quick" | "full"
    # Channel
    lead_source: str
    utm_campaign: str
    utm_medium: str
    referral_code: str | None
    # If lost
    loss_reason: str | None
    loss_stage: str | None  # which state the deal was in when lost
    # If returned
    return_reason: str | None
```

### 15.3 Learning Loops

| Loop | Input | Output | Frequency |
|------|-------|--------|-----------|
| Margin Optimization | DealOutcome gross_margin by source_type, condition_grade, price_range | Adjusted markup tables per vehicle segment | Monthly review |
| Acquisition Cost Calibration | Actual acquisition cost vs. estimated wholesale price | Improved price_wholesale_est formula coefficients | Weekly recalculation |
| Match Quality Validation | match_score of selected vehicle vs. post-delivery NPS | Adjusted category_importance_weight defaults | After every 25 deals |
| Cycle Time Analysis | time_in_each_state across all deals | Identifies bottleneck states; informs HITL SLA adjustments | Monthly |
| Lead Source ROI | lead_source + utm_campaign vs. outcome + margin | Marketing spend reallocation; CAC optimization | Monthly |
| Loss Pattern Detection | loss_reason + loss_stage aggregated | Identifies systemic drop-off points; informs UX or process changes | After every 10 losses |
| Return Pattern Analysis | return_reason + vehicle characteristics | Quality Firewall rule adjustments | After every 5 returns |
| Quick Match → Full Profile Conversion | profile_tier at selection vs. match_score vs. NPS | Validates Quick Match defaults; adjusts neutral weight values | After 25 Quick Match deals |

### 15.4 Implementation

**MVP:** DealOutcome records generated automatically on deal close. Monthly manual review by Operations Admin using basic SQL queries and exported dashboards.

**Phase 2:** Automated learning loop agents that update configuration tables based on statistical significance thresholds. Anomaly detection alerts when a metric drifts beyond 2 standard deviations.

---

## 16. SECURITY ARCHITECTURE & AUTH FLOWS

### 16.1 Authentication

**Buyer Portal (Client Dashboard):**
- Supabase Auth with email + password; optional social login (Google)
- JWT tokens with 1-hour expiry; refresh tokens with 7-day expiry
- All API requests include `Authorization: Bearer <token>` header
- Buyer can only access their own deal data (row-level security via `contact_id`)

**Admin Workspace:**
- GHL native authentication for staff users
- VCH admin API uses GHL OAuth2 for SSO
- Role-based access: Admin, DealDesk, TitleClerk, Sourcer (mapped from GHL roles)

**Agent-to-Service Auth:**
- All MCP servers use service-to-service JWT tokens (non-user)
- Agent tokens are short-lived (5 minutes), auto-renewed by Orchestrator
- Each agent has a defined permission scope limiting which MCP tools it can call

### 16.2 Data Security

- PII encrypted at rest: AES-256 (PostgreSQL pgcrypto extension + S3 SSE-S3)
- PII encrypted in transit: TLS 1.3 enforced on all endpoints
- Credit application data: encrypted in dedicated column; access logged
- SSN (if collected): never stored in VCH DB; passed through to lender API only
- Document storage: S3 bucket with bucket policies; signed URLs with 15-minute expiry
- Database: no public access; VPC-internal only; connections via connection pooler (PgBouncer)

### 16.3 Secrets Management

- All API keys, database credentials, and tokens stored in AWS Secrets Manager
- Application reads secrets at startup; no secrets in environment variables in plaintext
- Secret rotation: quarterly for all API keys; automated for database passwords
- `.env` files used in local development only; never committed to git (in `.gitignore`)

### 16.4 OFAC & Compliance Screening

- OFAC screening on all buyers at QUALIFIED state
- Re-screening at FUNDING state (in case of name change or new information)
- Any hit → immediate HITL-08 (15-minute SLA; all activity suspended)
- Results cached per contact_id for 30 days; re-screened on any change

---

## 17. ERROR HANDLING, RETRY PATTERNS & CIRCUIT BREAKERS

### 17.1 API Call Retry Policy

| Service | Max Retries | Backoff | Timeout | Circuit Breaker |
|---------|-------------|---------|---------|-----------------|
| MarketCheck API | 3 | Exponential (1s, 2s, 4s) | 30s | Open after 5 consecutive failures; half-open after 5 min |
| GHL API | 3 | Exponential (1s, 2s, 4s) | 15s | Open after 10 consecutive failures; half-open after 2 min |
| DocuSign API | 3 | Exponential (2s, 4s, 8s) | 30s | Open after 5 failures; half-open after 5 min |
| Central Dispatch API | 2 | Exponential (2s, 4s) | 60s | Open after 3 failures; half-open after 10 min |
| Credit Bureau API | 2 | Linear (5s, 10s) | 45s | Open after 3 failures; HITL notification |
| Telnyx API | 3 | Exponential (1s, 2s, 4s) | 15s | Open after 5 failures; half-open after 2 min |

### 17.2 Agent Error Handling

```
If agent tool call fails:
  1. Retry per policy above
  2. If all retries fail:
     a. Log error to AuditEvent with full context
     b. If deal-blocking: transition deal to EXCEPTION state
     c. If non-blocking: log warning; continue with degraded functionality
     d. OrchestratorAgent notified; adds to exception queue
  3. If agent crashes (unhandled exception):
     a. Celery worker restarts task
     b. If task fails 3 times: EXCEPTION state + human notification
```

### 17.3 Bulk Ingestion Error Handling

- If MarketCheck bulk API returns error: retry entire batch after 30 minutes (max 3 attempts)
- If partial failure (some records fail normalization): continue processing valid records; log failures to ingestion_errors table; alert Operations Admin if failure rate > 5%
- If ingestion takes > 2 hours: alert Operations Admin; continue in background; matching engine uses stale data with timestamp warning

### 17.4 GHL Webhook Delivery Failures

- VCH webhook endpoint must respond 200 within 10 seconds
- GHL retries failed webhooks 3 times over 1 hour
- If VCH is down: GHL events are lost — on recovery, VCH runs a "sync reconciliation" job that pulls recent GHL changes via API and applies any missed state changes

---

## 18. VCH BACKEND REST API SPECIFICATION

> Full route map in Appendix B. Key endpoints listed here.

### 18.1 API Conventions

- Base URL: `https://api.virtualcarhub.com/v1`
- Auth: `Authorization: Bearer <jwt_token>` (buyer) or `X-Service-Token: <token>` (agent)
- Response format: JSON with envelope `{ "status": "ok|error", "data": {...}, "error": {...} }`
- Pagination: cursor-based `?cursor=<id>&limit=25`
- Rate limiting: 100 req/min per buyer; 1000 req/min per agent; enforced via Redis

### 18.2 Core Endpoints

**Buyer-Facing:**
```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh

GET    /me/profile
PUT    /me/profile
POST   /me/profile/quick-match
GET    /me/deal
GET    /me/recommendations
POST   /me/recommendations/{vin}/select
POST   /me/recommendations/{vin}/favorite
GET    /me/documents
GET    /me/delivery
POST   /me/return/initiate
GET    /me/notifications

POST   /chat/message          (Danny chat)
GET    /chat/history
```

**Agent/Internal:**
```
POST   /webhooks/ghl          (GHL event receiver)
POST   /webhooks/docusign     (DocuSign status)
POST   /webhooks/telnyx       (Voice/SMS events)

GET    /admin/deals
GET    /admin/deals/{id}
POST   /admin/deals/{id}/override-state
GET    /admin/exceptions
GET    /admin/audit-log
GET    /admin/agents/activity

POST   /agents/orchestrator/dispatch
GET    /agents/{agent_id}/health

POST   /inventory/ingest      (trigger manual ingestion)
GET    /inventory/stats
GET    /inventory/search

POST   /matching/run/{buyer_id}
GET    /matching/results/{buyer_id}

POST   /funding/{deal_id}/submit-app
POST   /funding/{deal_id}/confirm

POST   /sourcing/{deal_id}/bid
POST   /sourcing/{deal_id}/dealer-outreach
POST   /sourcing/{deal_id}/confirm-acquisition

POST   /logistics/{deal_id}/request-quotes
POST   /logistics/{deal_id}/book-carrier
GET    /logistics/{deal_id}/tracking

POST   /returns/{deal_id}/initiate
POST   /returns/{deal_id}/confirm-receipt
POST   /returns/{deal_id}/process-refund
```

---

## 19. MONITORING, ALERTING & ANALYTICS

### 19.1 Datadog Monitoring

**Infrastructure Metrics:**
- ECS task CPU/memory utilization
- RDS CPU, connections, disk I/O
- ElastiCache hit rate, memory usage
- S3 request latency

**Application Metrics:**
- API endpoint p50/p95/p99 response times
- Agent tool call success/failure rates
- MarketCheck API quota usage (% of daily limit)
- Background job (Celery) queue depth and execution time
- WebSocket connection count (Danny chat)

### 19.2 Alert Rules

| Alert | Condition | Severity | Notification |
|-------|-----------|----------|-------------|
| API latency spike | p95 > 5s for 5 minutes | Warning | Slack #ops |
| API error rate | >5% 5xx responses for 5 minutes | Critical | Slack #ops + SMS |
| MarketCheck quota | >80% daily quota consumed | Warning | Slack #ops |
| MarketCheck quota | >95% daily quota consumed | Critical | Slack #ops + SMS |
| Agent failure | Any agent returns error 3+ times in 10 min | Critical | Slack #ops + SMS |
| Deal stalled | Any deal in same state > SLA | Warning | GHL task + Slack |
| Database connections | >80% max connections | Warning | Slack #ops |
| Database connections | >95% max connections | Critical | Slack #ops + SMS |
| Celery queue depth | >100 pending jobs for 15 min | Warning | Slack #ops |
| OFAC hit | Any OFAC screening match | Critical | Immediate GHL task + SMS |
| Bulk ingestion | Not completed by 4 AM ET | Warning | Slack #ops |

### 19.3 Analytics (GA4 + Mixpanel)

**GA4 Events (page-level):**
- Page views on all marketing pages
- UTM attribution tracking
- "Talk to Danny" click
- VInventory page browse events
- Blog engagement

**Mixpanel Events (product-level):**

| Event | Properties | Funnel Stage |
|-------|-----------|--------------|
| `intake_started` | profile_tier, source | Top |
| `intake_step_completed` | step_number, step_name, time_spent | Mid |
| `intake_completed` | profile_tier, total_time | Mid |
| `matching_results_viewed` | result_count, top_match_score | Mid |
| `vehicle_favorited` | vin, match_score | Mid |
| `vehicle_selected` | vin, match_score, price | Mid |
| `funding_started` | funding_type (cash/finance) | Bottom |
| `funding_approved` | lender, apr, term | Bottom |
| `deal_closed_won` | gross_margin, cycle_days, source | Conversion |
| `deal_closed_lost` | loss_reason, loss_stage | Drop-off |
| `return_initiated` | return_reason, days_since_delivery | Post |
| `danny_chat_started` | page, context | Engagement |
| `danny_chat_escalated` | reason | Engagement |

---

## 20. 7-DAY RETURN POLICY IMPLEMENTATION

> The investor pitch and website both promise a 7-Day Return Policy. This section defines the mechanics.

### 20.1 Policy Rules

- Buyer may initiate a return within **7 calendar days** of delivery confirmation (DELIVERED state timestamp)
- Vehicle must be returned in **substantially similar condition** to delivery (normal driving wear accepted; damage or modifications void the return)
- Return transport is **buyer's responsibility** (VCH can arrange at buyer's cost) OR VCH absorbs transport for **Premier/Concierge tier** customers
- Restocking fee: **[OQ-11 — pending decision]** (recommended: $0 for first 50 deals as competitive advantage; $500 after MVP validation)
- Refund processed within **5 business days** of vehicle receipt and condition verification
- Refund amount = buyer's total payment minus restocking fee (if any) and any damage repair costs
- Financed deals: VCH coordinates with lender to unwind the contract; refund goes to lender + buyer equity

### 20.2 Return State Machine

```
DELIVERED → (buyer initiates within 7 days) →
  RETURN_PENDING → (return transport arranged) →
    RETURN_IN_TRANSIT → (vehicle received at inspection point) →
      RETURN_INSPECTING → (condition verified) →
        RETURN_APPROVED → (refund processed) → CLOSED_LOST
        RETURN_DISPUTED → (damage found; HITL-13 triggered) → human resolution
```

### 20.3 ReturnAgent Workflow

1. Buyer clicks "Initiate Return" on dashboard (visible only within 7-day window)
2. Danny asks reason for return (structured dropdown + free text)
3. ReturnAgent creates ReturnCase record with return_reason and initiated_at
4. ReturnAgent generates Return Authorization document → DocuSign to buyer
5. ReturnAgent arranges return transport (manual for MVP; automated Phase 2)
6. Vehicle received → condition inspection (photos required; compared to delivery checklist)
7. If condition matches → RETURN_APPROVED → refund calculated and processed
8. If damage → RETURN_DISPUTED → HITL-13 → Operations Admin reviews photos and determines damage deduction
9. Refund processed via original payment method; FundingAgent coordinates lender unwind if financed
10. Vehicle returned to inventory pool (available=true, condition updated)

### 20.4 Business Intelligence

Every return feeds into Section 15 Deal Intelligence with `outcome: "returned"` including return_reason. After 5 returns, automated alert to Operations Admin with pattern analysis.

---

## 21. BUYER CANCELLATION & REFUND FLOW

### 21.1 Cancellation Rules by Stage

| Stage | Cancellation Allowed? | Refund | Fees |
|-------|----------------------|--------|------|
| LEAD → PRE_QUALIFYING | Yes, auto | N/A — no payment collected | None |
| QUALIFIED | Yes, auto | Full deposit refund | None |
| ENGAGED → PROFILED → MATCHING | Yes, within 48h | Full deposit refund | After 48h: forfeiture of engagement deposit (amount TBD) |
| VEHICLE_SELECTED → FUNDING | Yes, with review | Deposit refund minus any third-party costs incurred | Lender app fees (if any) |
| ACQUISITION_PENDING | Requires human approval | Case-by-case; if auction bid placed and won, buyer may be liable | HITL review required |
| ACQUIRED → IN_TRANSIT | Requires human approval | Treated as return; 7-day policy applies from delivery | Restocking + transport |
| DELIVERED | 7-Day Return Policy (Section 20) | Per return policy | Per return policy |

### 21.2 Cancellation Workflow

1. Buyer requests cancellation via Danny chat or dashboard
2. CancellationAgent (function of OrchestratorAgent for MVP) determines current stage
3. If auto-cancellable: process immediately; transition to CLOSED_LOST; trigger refund
4. If requires review: HITL checkpoint; Deal Desk reviews within 4 business hours
5. Refund processed via original payment method
6. GHL workflow: "Sorry to see you go" email with Danny re-engagement CTA at 6 months
7. AuditEvent logged with cancellation_reason and refund_amount

---

## 22. ENVIRONMENT, CONFIG & FEATURE FLAGS

### 22.1 Environments

| Environment | Purpose | Data | URL |
|-------------|---------|------|-----|
| local | Developer workstation | Seeded test data | localhost:8000 |
| staging | Pre-production testing | Anonymized copy of production | staging-api.virtualcarhub.com |
| production | Live system | Real data | api.virtualcarhub.com |

### 22.2 Configuration Hierarchy

```
1. AWS Secrets Manager (secrets: API keys, DB passwords)
2. Environment variables (infra config: DB host, Redis host, environment name)
3. Database config table (business rules: margin thresholds, fee amounts, SLA timers)
4. Feature flags (Unleash or simple DB table for MVP)
```

Business rules (margin thresholds, fee tiers, SLA timers, geographic scope) are stored in a `config` database table, not hardcoded. Changes to business rules do not require code deployment.

### 22.3 Feature Flags

| Flag | Default (MVP) | Controls |
|------|--------------|----------|
| `QUICK_MATCH_ENABLED` | true | Show Quick Match intake path |
| `FULL_PROFILE_ENABLED` | true | Show Full Profile intake path |
| `AUCTION_AUTO_BID` | false | Phase 2: automated auction bidding |
| `AUTO_CARRIER_BOOKING` | false | Phase 2: automated Central Dispatch |
| `MULTI_LENDER_WATERFALL` | false | Phase 2: multiple lender routing |
| `EQUITY_ALERTS` | false | Phase 2: quarterly equity notifications |
| `TIKTOK_CATALOG_FEED` | false | Phase 2: TikTok inventory ads |
| `RETURN_POLICY_ENABLED` | true | 7-day return policy active |
| `DEAL_DESK_AUTO_APPROVE` | false | Phase 2: auto-approve deals above margin threshold |

---

## 23. DATABASE MIGRATION & BACKUP STRATEGY

### 23.1 Schema Management

- **ORM:** SQLAlchemy with Alembic for migrations
- **Convention:** Every schema change is an Alembic migration file with upgrade + downgrade functions
- **Process:** Developer creates migration → tests locally → PR review → staging deployment → production deployment
- **Naming:** `YYYYMMDD_HHMM_description.py` (e.g., `20260301_1430_add_return_case_table.py`)

### 23.2 Backup Strategy

| Component | Method | Frequency | Retention | Tested |
|-----------|--------|-----------|-----------|--------|
| PostgreSQL | AWS RDS automated snapshots | Daily | 30 days | Monthly restore test |
| PostgreSQL | Point-in-time recovery (PITR) | Continuous (5-minute RPO) | 7 days | Quarterly test |
| S3 (documents) | Cross-region replication | Continuous | Indefinite (7-year compliance) | Annual audit |
| Redis | RDB snapshots | Every 6 hours | 3 days | On infrastructure change |

### 23.3 Disaster Recovery

- **RTO (Recovery Time Objective):** 4 hours
- **RPO (Recovery Point Objective):** 5 minutes (PITR)
- **Procedure:** Documented runbook in GitHub wiki; tested quarterly
- **Failover:** RDS Multi-AZ automatic failover; ECS rebalances across availability zones

---

## 24. SPRINT EXECUTION PLAN

> **12 weeks / 6 sprints / 2-week sprints**
> Each sprint has defined deliverables, dependencies, and acceptance criteria.
> Sprints assume 1-2 full-stack developers + 1 part-time AI/agent specialist.

### Sprint 0: Foundation (Weeks 1-2)

**Goal:** Infrastructure, database, auth, and CI/CD pipeline operational.

| Deliverable | Details |
|-------------|---------|
| AWS infrastructure | ECS cluster, RDS PostgreSQL, ElastiCache Redis, S3 bucket, Secrets Manager |
| FastAPI project scaffold | Project structure, settings module, health check endpoint |
| Database schema v1 | All data model tables from Section 5 created via Alembic migrations |
| Supabase Auth integration | Buyer registration, login, JWT validation middleware |
| GHL webhook receiver | Endpoint receives GHL events; logs to console; no processing yet |
| CI/CD pipeline | GitHub Actions: lint → test → build → deploy to staging |
| Datadog agent | Basic infrastructure monitoring connected |
| Development environment | Docker Compose for local dev (PostgreSQL, Redis, FastAPI) |

**Acceptance:** Health check returns 200; database migrations apply cleanly; buyer can register and receive JWT; CI/CD deploys to staging on merge to `main`.

**Dependencies:** OQ-12 (AWS account) must be resolved.

---

### Sprint 1: Inventory & Matching Core (Weeks 3-4)

**Goal:** MarketCheck bulk ingestion running; matching engine returns results for Quick Match profiles.

| Deliverable | Details |
|-------------|---------|
| MarketCheck bulk ingestion | Celery task: nightly download → normalize → upsert to Vehicle table |
| Feature normalization engine | Lookup table + AI fallback for unmapped features |
| Canonical vehicle schema | Full Vehicle model with all fields from Section 4.2.2 |
| Quick Match API | `POST /me/profile/quick-match` → simplified BFV → matching results |
| Quick Match scoring engine | 4-category simplified scoring algorithm |
| Full BFV matching engine | Phase 1 (hard constraints) + Phase 2 (weighted scoring) |
| Recommendation results API | `GET /me/recommendations` with match_score, explainability, 3 price points |
| MarketCheck Price™ integration | API calls on recommendation generation; 24h cache |

**Acceptance:** Bulk ingestion completes with test data; Quick Match returns 10 results within 15 seconds; full match returns 10 results within 30 seconds; MarketCheck Price™ prices displayed.

**Dependencies:** OQ-09 (MarketCheck account) must be resolved.

---

### Sprint 2: Buyer Portal & Danny Chat (Weeks 5-6)

**Goal:** Buyer-facing web application live with intake, recommendations, and Danny chat.

| Deliverable | Details |
|-------------|---------|
| Next.js project scaffold | Project structure, Tailwind CSS, component library |
| Landing page | Marketing homepage matching virtualcarhub.com design |
| Quick Match UI | 5-step intake form with instant results |
| Full Profile intake UI | All 24 steps with save/resume |
| Recommendation results page | Vehicle cards with photos, 3 price points, match scores, Danny Savings |
| Client dashboard (v1) | Deal stage tracker, document status, notification inbox |
| Danny chat widget | Website + dashboard; Claude API with MCP tools for profile and recommendations |
| GA4 + Mixpanel integration | Page analytics + product funnel events |
| Mobile responsiveness | All pages responsive; dashboard functional on mobile |

**Acceptance:** Buyer can register, complete Quick Match, view recommendations, chat with Danny, and see accurate deal status on dashboard.

**Dependencies:** Sprint 0 + Sprint 1 complete.

---

### Sprint 3: Deal Lifecycle — Funding & Documents (Weeks 7-8)

**Goal:** Full deal lifecycle from qualification through funding; document generation and e-signing.

| Deliverable | Details |
|-------------|---------|
| GHL pipeline sync | Bi-directional: VCH state changes → GHL stages; GHL events → VCH processing |
| GHL automation workflows | All 11 workflows from Section 6.5 configured and tested |
| QualificationAgent | Soft-pull integration with lender; pre-approval flow |
| FundingAgent | Credit app routing; terms presentation; doc collection tracking |
| DocuSign integration | Envelope generation from templates; webhook processing; signed doc storage |
| Document templates | Service Agreement, Buyer Order, Credit App link, Odometer Disclosure |
| Deal state machine enforcement | All state transitions validated; AuditEvent logging on every transition |
| HITL notification system | GHL task creation + SMS on all HITL triggers |

**Acceptance:** Full deal can progress from LEAD through FUNDING with all documents signed, all GHL stages synced, and HITL checkpoints firing correctly.

**Dependencies:** OQ-01 (lender), OQ-03 (DocuSign), OQ-10 (GHL account) must be resolved.

---

### Sprint 4: Acquisition, Logistics & DMS (Weeks 9-10)

**Goal:** Deal lifecycle complete through delivery; admin workspace operational.

| Deliverable | Details |
|-------------|---------|
| SourcingAgent — Dealer Path | Automated email/SMS outreach to dealer partners; response parsing; PO generation |
| SourcingAgent — Auction Path (manual) | Bid recommendation engine; human-readable auction instructions; confirmation flow |
| Quality Firewall | All 8 checks automated; HITL triggers on failures |
| Real-time MarketCheck validation | API call at ACQUISITION_PENDING; listing confirmation |
| LogisticsAgent (manual MVP) | Quote request generation; human posts to Central Dispatch; tracking status entry |
| DMSAgent | Bill of Sale generation; title case creation; compliance doc generation |
| Admin Workspace (v1) | Deal board, exception queue, agent activity log, audit trail viewer |
| Delivery checklist | Digital form sent to buyer; submission triggers DELIVERED state |

**Acceptance:** Full deal can progress from ACQUISITION_PENDING through DELIVERED with all sourcing, transport, and delivery documentation complete.

**Dependencies:** OQ-02 (auction portals), OQ-04 (dealer license), OQ-05 (dealer partners) must be resolved.

---

### Sprint 5: Returns, Polish & Launch Prep (Weeks 11-12)

**Goal:** 7-day return policy live; all edge cases handled; production hardening; launch readiness.

| Deliverable | Details |
|-------------|---------|
| ReturnAgent | Full return flow: initiation → transport → inspection → refund |
| Return Authorization document | DocuSign template + automated generation |
| Cancellation flow | Stage-appropriate cancellation with correct refund logic |
| DealOutcome record generation | Auto-created on every CLOSED_WON, CLOSED_LOST, and return |
| OFAC screening | Integration with screening service; HITL-08 on any hit |
| Error handling hardening | All retry policies, circuit breakers, and fallback behaviors implemented |
| Security audit | Auth flow review; PII encryption verification; penetration test (basic) |
| Performance testing | Load test matching engine with 50K vehicles; API latency validation |
| Production deployment | Production infrastructure provisioned; DNS configured; SSL certificates |
| Staging end-to-end test | TC-10 (full deal cycle) and TC-14 (return) pass on staging |
| Operations runbook | Documented procedures for common exceptions, deployment, and rollback |

**Acceptance:** All 15 test scenarios pass on staging; production environment accessible; first real lead can enter the system.

**Dependencies:** OQ-06 (fee tiers), OQ-07 (margin threshold), OQ-08 (geographic scope), OQ-11 (restocking fee) must be resolved.

---

## 25. BUDGET ESTIMATES BY SPRINT

> **Estimates assume:** 2 developers at ~$75/hour (contract) and 1 AI specialist at ~$100/hour (part-time). Infrastructure costs are separate.

| Sprint | Duration | Dev Hours (est.) | AI Specialist Hours | Infrastructure/SaaS | Est. Total |
|--------|----------|-----------------|--------------------|--------------------|------------|
| Sprint 0: Foundation | 2 weeks | 120 hrs | 8 hrs | $500 (AWS setup + first month) | $9,800 |
| Sprint 1: Inventory & Matching | 2 weeks | 140 hrs | 24 hrs | $200 (MarketCheck API + AWS) | $12,900 |
| Sprint 2: Buyer Portal & Danny | 2 weeks | 160 hrs | 32 hrs | $300 (Claude API + Mixpanel) | $15,400 |
| Sprint 3: Deal Lifecycle | 2 weeks | 160 hrs | 16 hrs | $200 (DocuSign + GHL) | $13,800 |
| Sprint 4: Acquisition & Logistics | 2 weeks | 140 hrs | 24 hrs | $200 (API costs) | $12,900 |
| Sprint 5: Returns & Launch | 2 weeks | 120 hrs | 16 hrs | $500 (prod infra + security) | $10,600 |
| **TOTAL** | **12 weeks** | **840 hrs** | **120 hrs** | **$1,900** | **$75,400** |

**Monthly Recurring Costs (Post-Launch):**

| Service | Est. Monthly Cost |
|---------|------------------|
| AWS (ECS + RDS + ElastiCache + S3) | $400–800 |
| MarketCheck API | $200–500 (depends on tier/quota) |
| GoHighLevel | $97–297 (depends on plan) |
| DocuSign | $25–50 |
| Anthropic Claude API | $100–300 (scales with deal volume) |
| Telnyx | $50–100 |
| Datadog | $0–50 (free tier for MVP scale) |
| Mixpanel | $0 (free tier for MVP) |
| Supabase Auth | $0–25 (free tier for MVP) |
| Domain + SSL | $20 |
| **Total Monthly** | **$900–2,150** |

---

## APPENDIX A: GLOSSARY

| Term | Definition |
|------|-----------|
| BFV (Buyer Fit Vector) | Structured JSON representing buyer's complete weighted vehicle preferences. Input to Matching Engine. |
| Quality Firewall | Automated pre-purchase vehicle screening checklist. Hard failures are auto-rejected. |
| Just-In-Time Acquisition | VCH model of purchasing only after buyer is committed AND funded. Zero floor plan risk. |
| Hard Constraint | Absolute exclude preference. Vehicles violating it receive match score of 0. |
| HITL | Human-In-The-Loop. Defined checkpoints where AI pauses and human decides. |
| MCP | Model Context Protocol. Standardized protocol for AI agents to call external tools. |
| Deal Desk | Role + engine logic for calculating deal economics and reviewing flagged deals. |
| AuditEvent | Immutable log record. Every state transition and agent action. Compliance trail. |
| GHL | GoHighLevel — CRM, automation, and communication platform. VCH's operational shell. |
| RISC | Retail Installment Sales Contract — primary lender financing document. |
| VSC | Vehicle Service Contract — extended warranty product. |
| Central Dispatch | Industry-standard vehicle transport marketplace. |
| Danny the Deal Advisor | VCH's AI persona. Consumer-facing name for all buyer interactions. |
| Computer-Use Agent | AI agent navigating web interfaces (Anthropic Computer Use API). Used for auction portals. |
| Equity Alert | Post-purchase quarterly notification showing vehicle's current market value. |
| Quick Match | 5-step fast intake producing "good enough" matches; buyer can upgrade to Full Profile. |
| Danny Savings | The gap between MarketCheck retail price and VCH out-the-door price. Primary conversion metric. |
| DealOutcome | Analytics record created on every deal close. Feeds the Learning Loop (Section 15). |
| ReturnCase | Record tracking a 7-day return from initiation through refund processing. |

---

## APPENDIX B: VCH BACKEND API ROUTE MAP

```
/v1
├── /auth
│   ├── POST   /register
│   ├── POST   /login
│   └── POST   /refresh
├── /me
│   ├── GET    /profile
│   ├── PUT    /profile
│   ├── POST   /profile/quick-match
│   ├── GET    /deal
│   ├── GET    /recommendations
│   ├── POST   /recommendations/{vin}/select
│   ├── POST   /recommendations/{vin}/favorite
│   ├── GET    /documents
│   ├── GET    /delivery
│   ├── POST   /return/initiate
│   └── GET    /notifications
├── /chat
│   ├── POST   /message
│   └── GET    /history
├── /webhooks
│   ├── POST   /ghl
│   ├── POST   /docusign
│   └── POST   /telnyx
├── /admin
│   ├── GET    /deals
│   ├── GET    /deals/{id}
│   ├── POST   /deals/{id}/override-state
│   ├── GET    /exceptions
│   ├── GET    /audit-log
│   ├── GET    /agents/activity
│   └── GET    /returns
├── /inventory
│   ├── POST   /ingest
│   ├── GET    /stats
│   └── GET    /search
├── /matching
│   ├── POST   /run/{buyer_id}
│   └── GET    /results/{buyer_id}
├── /funding
│   ├── POST   /{deal_id}/submit-app
│   └── POST   /{deal_id}/confirm
├── /sourcing
│   ├── POST   /{deal_id}/bid
│   ├── POST   /{deal_id}/dealer-outreach
│   └── POST   /{deal_id}/confirm-acquisition
├── /logistics
│   ├── POST   /{deal_id}/request-quotes
│   ├── POST   /{deal_id}/book-carrier
│   └── GET    /{deal_id}/tracking
└── /returns
    ├── POST   /{deal_id}/initiate
    ├── POST   /{deal_id}/confirm-receipt
    └── POST   /{deal_id}/process-refund
```

---

## APPENDIX C: ENVIRONMENT VARIABLE REGISTRY

| Variable | Description | Example |
|----------|-------------|---------|
| `VCH_ENV` | Environment name | `production` / `staging` / `local` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/vch` |
| `REDIS_URL` | Redis connection string | `redis://host:6379/0` |
| `AWS_REGION` | AWS region | `us-east-1` |
| `AWS_S3_BUCKET` | Document storage bucket | `vch-documents-prod` |
| `AWS_SECRETS_PREFIX` | Secrets Manager prefix | `vch/production/` |
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | (from Supabase dashboard) |
| `GHL_API_KEY` | GoHighLevel API key | (from Secrets Manager) |
| `GHL_LOCATION_ID` | GHL sub-account ID | (from GHL dashboard) |
| `GHL_WEBHOOK_SECRET` | GHL webhook verification secret | (from Secrets Manager) |
| `MARKETCHECK_API_KEY` | MarketCheck API key | (from Secrets Manager) |
| `MARKETCHECK_PRICE_API_KEY` | MarketCheck Price™ API key | (from Secrets Manager) |
| `DOCUSIGN_INTEGRATION_KEY` | DocuSign integration key | (from Secrets Manager) |
| `DOCUSIGN_SECRET_KEY` | DocuSign secret key | (from Secrets Manager) |
| `DOCUSIGN_ACCOUNT_ID` | DocuSign account ID | (from DocuSign admin) |
| `ANTHROPIC_API_KEY` | Claude API key | (from Secrets Manager) |
| `TELNYX_API_KEY` | Telnyx API key | (from Secrets Manager) |
| `TELNYX_PHONE_NUMBER` | Telnyx phone number for VCH | `+18333928867` |
| `DATADOG_API_KEY` | Datadog API key | (from Secrets Manager) |
| `MIXPANEL_TOKEN` | Mixpanel project token | (from Mixpanel dashboard) |
| `SENTRY_DSN` | Error tracking (optional) | (from Sentry dashboard) |
| `CORS_ORIGINS` | Allowed CORS origins | `https://virtualcarhub.com,https://staging.virtualcarhub.com` |
| `LOG_LEVEL` | Application log level | `INFO` / `DEBUG` |

---

**— END OF DOCUMENT —**

*VirtualCarHub PRD v2.0 | EZWAi | February 2026*
