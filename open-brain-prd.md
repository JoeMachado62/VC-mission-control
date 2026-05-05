# VCH Shared Brain Integration — Agent-Executable Specification
## Mission Control (builderz-labs) + Graphiti Temporal Knowledge Graph
### Four-Stage Workflow PRD

---

# STAGE 1: PROMPT CRAFT — "Clear Instructions"

## Objective

Deploy and configure two open-source systems — builderz-labs/mission-control and Zep's Graphiti — on Hetzner Cloud VPS infrastructure to serve as the orchestration layer and shared memory brain for VirtualCarHub's 6-agent OpenClaw fleet. Then enhance Mission Control's UI to surface Graphiti data in a new "Shared Brain" dashboard panel, giving operators real-time visibility into the cross-agent knowledge graph.

## What You Are Building

1. **Mission Control deployment** — Install builderz-labs/mission-control (https://github.com/builderz-labs/mission-control) on a dedicated Hetzner VPS. Configure it to connect to 6 remote OpenClaw Gateway instances (one per agent VPS). This is the central operations dashboard.

2. **Graphiti deployment** — Install Graphiti (https://github.com/getzep/graphiti) with a graph database backend (FalkorDB preferred for lightweight Hetzner deployment, Neo4j acceptable) on its own VPS or colocated with Mission Control. Expose it as an MCP server so all 6 OpenClaw agent instances can connect to it as a tool.

3. **Mission Control UI enhancement** — Build a new "Shared Brain" panel inside Mission Control's existing 32-panel SPA architecture that reads from the Graphiti API and displays:
   - Live entity graph visualization (vehicles, clients, deals, deliveries, agents)
   - Temporal fact timeline (what changed, when, which agent wrote it)
   - Active alerts / cross-agent conflicts (e.g., two agents acting on the same vehicle)
   - Recent memory writes by agent (who added what to the shared brain)

4. **MCP server configuration** — Each of the 6 OpenClaw VPS instances needs the Graphiti MCP server added to its tool configuration so agents can read/write the shared brain before executing actions.

## What You Are NOT Building

- You are NOT building the 6 OpenClaw agents themselves (those have separate PRDs)
- You are NOT building the VCH FastAPI backend (already exists)
- You are NOT modifying OpenClaw core — you are configuring it
- You are NOT building a custom memory system — you are deploying Graphiti as-is and building a UI layer on top

---

# STAGE 2: CONTEXT ENGINEERING — "What the AI Needs to Know"

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│           MISSION CONTROL (builderz-labs)            │
│  Hetzner VPS — Next.js 16 / SQLite / TypeScript     │
│  Connects to 6 OpenClaw Gateways via multi-gateway   │
│  New "Shared Brain" panel reads Graphiti REST API    │
└──────────┬──────────────────────────────┬────────────┘
           │ WebSocket to each Gateway    │ REST/GraphQL
           ▼                              ▼
┌──────────────────┐           ┌─────────────────────┐
│ VPS 1: Orchestr. │           │  GRAPHITI VPS        │
│ OpenClaw Gateway │──MCP──────│  graphiti-core       │
│ + local memory   │           │  FalkorDB / Neo4j    │
├──────────────────┤           │  MCP server exposed  │
│ VPS 2: Danny     │──MCP──────│  on internal network │
│ OpenClaw Gateway │           └─────────┬────────────┘
│ + local memory   │                     │
├──────────────────┤                     │
│ VPS 3: Matching  │──MCP────────────────┤
│ OpenClaw Gateway │                     │
│ + local memory   │                     │
├──────────────────┤                     │
│ VPS 4: DealOps   │──MCP────────────────┤
│ OpenClaw Gateway │                     │
│ + local memory   │                     │
├──────────────────┤                     │
│ VPS 5: Sourcing  │──MCP────────────────┤
│ OpenClaw Gateway │                     │
│ + local memory   │                     │
├──────────────────┤                     │
│ VPS 6: Logistics │──MCP────────────────┘
│ OpenClaw Gateway │
│ + local memory   │
└──────────────────┘
```

## Two-Tier Memory Model

Each agent operates with two memory layers:

**Tier 1 — Local Brain (OpenClaw built-in per VPS)**
- Domain-specific expertise and conversation history
- Persisted in ~/.openclaw/ on each VPS
- Sourcing knows auction patterns, Danny knows client rapport, Logistics knows carrier reliability, etc.
- Fast, local, no network dependency

**Tier 2 — Shared Brain (Graphiti central VPS)**
- Company-wide temporal knowledge graph
- Before any action, the agent checks in: "Is there anything I should know about this vehicle / client / delivery window / deal?"
- After any action, the agent writes back: "Here is what I just did and learned"
- Turns 6 independent agents into a coordinated team

## Technology Stack (Locked)

| Component | Technology | Notes |
|-----------|-----------|-------|
| Mission Control | builderz-labs/mission-control v2.0.1 | Next.js 16, TypeScript, SQLite, Zustand |
| Graphiti | graphiti-core (PyPI) | Apache 2.0, Python |
| Graph DB | FalkorDB (preferred) or Neo4j 5.26 | FalkorDB runs on Redis protocol, lighter than Neo4j |
| LLM for Graphiti | OpenAI GPT (via existing API keys) | Graphiti uses LLM for entity extraction + embedding |
| Agent framework | OpenClaw (each VPS) | Node.js, Gateway + Pi agent runtime |
| Agent local memory | OpenClaw built-in | Per-instance, persisted in ~/.openclaw/ |
| Shared memory access | Graphiti MCP server | Each OpenClaw instance adds as MCP tool |
| Infrastructure | Hetzner Cloud | All VPS instances |
| VCH Backend | FastAPI + PostgreSQL + Redis | Already deployed, agents call via REST |

## Key Repositories

- Mission Control: https://github.com/builderz-labs/mission-control
- Graphiti: https://github.com/getzep/graphiti
- OpenClaw: https://github.com/openclaw/openclaw

## Graphiti Data Model for VCH

Graphiti stores entities, relationships, and temporal facts. For VCH, the core entity types are:

### Entities
- **Vehicle** — VIN, year/make/model, status (available/offered/acquired/in-transit/delivered)
- **Client** — contact_id (from GHL), name, preferences, qualification status
- **Deal** — deal_id, current state (from state machine), assigned agents
- **Delivery** — delivery_id, origin, destination, carrier, scheduled date, status
- **Dealer** — dealer partners, wholesale contacts
- **Agent** — which VCH agent wrote the fact (for provenance tracking)

### Relationship Types
- Client → INTERESTED_IN → Vehicle
- Client → HAS_DEAL → Deal
- Deal → TARGETS → Vehicle
- Deal → IN_STATE → DealState
- Delivery → TRANSPORTS → Vehicle
- Delivery → SCHEDULED_FOR → Date/Location
- Agent → WROTE_FACT → any entity

### Temporal Facts (examples of what agents write)
- "Client John requested delivery delay due to hailstorm in Tampa (valid: 2026-04-11)"
- "Vehicle VIN:1234 has active offer from Client Alice (valid: 2026-04-10 to pending)"
- "3 deliveries scheduled to Tampa on 2026-04-12 (valid: 2026-04-11)"
- "Dealer XYZ has aged inventory matching Client Bob's BFV (valid: 2026-04-11)"

## Agent Check-Before-Act Pattern

Every agent follows this workflow before executing any action:

```
1. Agent receives task (from Orchestrator or Mission Control)
2. Agent queries its LOCAL OpenClaw memory for domain context
3. Agent queries GRAPHITI shared brain via MCP tool:
   - "Any active facts about [this vehicle / client / delivery / location]?"
   - "Any conflicts or pending actions by other agents on this entity?"
   - "Any recent alerts relevant to this action?"
4. Agent evaluates combined context
5. Agent executes action (or flags conflict for human review)
6. Agent WRITES result back to Graphiti shared brain
7. Agent updates local memory with action outcome
```

## Mission Control Panel Requirements

The new "Shared Brain" panel should follow builderz-labs/mission-control's existing panel architecture:

- Located in `src/components/panels/` as a new panel component
- Registered in the SPA shell's panel routing (src/app/page.tsx)
- Added to NavRail navigation
- Uses existing design system (Tailwind CSS 3.4, Recharts for charts)
- Reads data via new API routes in `src/app/api/`

### Panel Sections

**Section 1: Entity Graph Viewer**
- Interactive force-directed graph showing Graphiti entities and relationships
- Color-coded by entity type (vehicles=teal, clients=coral, deals=purple, deliveries=amber)
- Click any node to see its temporal fact history
- Filter by entity type, date range, or writing agent
- Use D3.js or a lightweight graph viz library compatible with Next.js

**Section 2: Temporal Fact Feed**
- Real-time scrolling feed of recent facts written to Graphiti
- Each entry shows: timestamp, writing agent, entity affected, fact text, validity window
- Filter by agent or entity type
- Highlight conflicts (two facts about the same entity within 1 hour)

**Section 3: Cross-Agent Conflict Alerts**
- Automated detection: when two agents reference the same vehicle/client/deal in a short window
- Shows: the conflicting facts, which agents are involved, recommended resolution
- Actionable: operator can flag for review, dismiss, or send to specific agent

**Section 4: Agent Memory Stats**
- Per-agent write counts (last 24h / 7d / 30d)
- Most-referenced entities
- Memory growth trend chart (Recharts)

## API Routes to Add

Add these to `src/app/api/` in Mission Control:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/graphiti/entities` | GET | List entities with optional type/date filters |
| `/api/graphiti/entity/[id]` | GET | Get entity detail + temporal fact history |
| `/api/graphiti/facts` | GET | Recent facts feed (paginated, filterable) |
| `/api/graphiti/conflicts` | GET | Detected cross-agent conflicts |
| `/api/graphiti/stats` | GET | Per-agent write counts and memory metrics |
| `/api/graphiti/search` | POST | Semantic search across the knowledge graph |
| `/api/graphiti/graph` | GET | Subgraph for visualization (nodes + edges) |

These routes proxy to the Graphiti API running on the Graphiti VPS. Mission Control should NOT have write access — it is read-only. Only agents write to Graphiti.

## Environment Variables to Add

Add to Mission Control's `.env`:

```
# Graphiti shared brain connection
GRAPHITI_API_URL=http://<graphiti-vps-ip>:8000
GRAPHITI_API_KEY=<secure-key>
GRAPHITI_READ_ONLY=true

# Refresh intervals
GRAPHITI_POLL_INTERVAL_MS=5000
GRAPHITI_CONFLICT_WINDOW_MINUTES=60
```

---

# STAGE 3: INTENT ENGINEERING — "What the AI Should Care About"

## Priority Stack (in order)

1. **Graphiti must be rock-solid first.** If agents can't read/write the shared brain reliably, nothing else matters. Deploy Graphiti, verify MCP connectivity from a test OpenClaw instance, confirm entity extraction works with VCH-domain data. Do this before touching Mission Control.

2. **Mission Control deployment second.** Get the vanilla builderz-labs/mission-control running and connecting to at least one OpenClaw Gateway. Verify multi-gateway configuration works. Do this before building the custom panel.

3. **Custom panel third.** Only after both systems are independently verified, build the Shared Brain panel. Start with the Temporal Fact Feed (simplest, highest immediate value), then Entity Graph, then Conflict Alerts, then Stats.

4. **MCP configuration last.** Once Graphiti and MC are proven, configure each OpenClaw VPS to connect via MCP.

## Trade-off Decisions (Pre-Made)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Graph DB | FalkorDB over Neo4j | Lighter footprint for Hetzner, runs on Redis protocol, Graphiti supports it natively |
| MC ↔ Graphiti | REST proxy (not direct DB) | Mission Control is read-only; proxying through Graphiti's API respects access control |
| Graph viz library | D3 force-directed | Already available in MC's ecosystem, no new dependency |
| Conflict detection | Server-side polling | SSE/WebSocket would be better long-term but polling is simpler for v1 |
| Entity schema | Start minimal, extend later | Begin with Vehicle, Client, Deal, Delivery. Add more entity types as agents mature |

## What "Done" Looks Like

- [ ] Graphiti VPS is running with FalkorDB, accessible on internal network
- [ ] At least 1 OpenClaw VPS can write a fact to Graphiti via MCP and read it back
- [ ] Mission Control is running and connected to at least 1 Gateway
- [ ] The "Shared Brain" panel displays Graphiti data in all 4 sections
- [ ] An operator can see in real-time when an agent writes a new fact
- [ ] Conflict detection flags when two agents touch the same entity

## What to Avoid

- Do NOT modify OpenClaw source code — configuration only
- Do NOT give Mission Control write access to Graphiti — read-only
- Do NOT build a custom MCP server — Graphiti ships one
- Do NOT over-engineer the entity schema — start with 4 entity types
- Do NOT use Graphiti for operational data (deal states, pipeline stages) — that stays in PostgreSQL via the VCH backend. Graphiti is for cross-agent context and institutional knowledge only

---

# STAGE 4: SPEC ENGINEERING — "The Master Plan"

## Deployment Sequence

### Phase 1: Graphiti VPS (Day 1-2)

```
Step 1.1: Provision Hetzner VPS (CX32 or higher — 4 vCPU, 8GB RAM)
Step 1.2: Install Python 3.11+, pip, Docker (for FalkorDB)
Step 1.3: Deploy FalkorDB via Docker:
          docker run -d --name falkordb -p 6379:6379 falkordb/falkordb:latest
Step 1.4: Install Graphiti:
          pip install graphiti-core[falkordb]
Step 1.5: Configure Graphiti with FalkorDB driver:
          - Set OPENAI_API_KEY for entity extraction
          - Set SEMAPHORE_LIMIT=10 (or higher if rate limits allow)
Step 1.6: Initialize the graph schema:
          python -c "
          from graphiti_core import Graphiti
          from graphiti_core.driver.falkordb_driver import FalkorDriver
          driver = FalkorDriver(host='localhost', port=6379)
          g = Graphiti(graph_driver=driver)
          import asyncio
          asyncio.run(g.build_indices_and_constraints())
          "
Step 1.7: Test by adding a sample episode and retrieving it
Step 1.8: Deploy Graphiti MCP server (see graphiti repo /mcp directory)
          - Bind to 0.0.0.0 on a port accessible to agent VPS instances
          - Secure with API key or Tailscale/WireGuard internal network
Step 1.9: Verify MCP connectivity from a remote machine
```

### Phase 2: Mission Control VPS (Day 2-3)

```
Step 2.1: Provision Hetzner VPS (CX22 — 2 vCPU, 4GB RAM sufficient)
Step 2.2: Install Node.js 22+, pnpm
Step 2.3: Clone and install:
          git clone https://github.com/builderz-labs/mission-control.git
          cd mission-control
          bash install.sh --local
Step 2.4: Configure .env:
          - Set AUTH_USER, AUTH_PASS, API_KEY
          - Set NEXT_PUBLIC_GATEWAY_OPTIONAL=true (initially, before gateways are ready)
          - Add Graphiti env vars (see Environment Variables section above)
Step 2.5: Start Mission Control:
          pnpm build && pnpm start
Step 2.6: Access http://<mc-vps-ip>:3000/setup — create admin account
Step 2.7: Verify basic dashboard loads (tasks, agents panels)
```

### Phase 3: Gateway Connections (Day 3-4)

```
Step 3.1: On ONE existing OpenClaw agent VPS, verify Gateway is running
Step 3.2: In Mission Control, add this Gateway as a connection
          (Settings → Gateways → Add)
Step 3.3: Verify agent status appears in MC's Agents panel
Step 3.4: Repeat for remaining agent VPS instances
Step 3.5: Set NEXT_PUBLIC_GATEWAY_OPTIONAL=false now that gateways are connected
```

### Phase 4: MCP Configuration on Agent VPS Instances (Day 4-5)

```
Step 4.1: On each OpenClaw agent VPS, add Graphiti MCP server to config.
          Edit ~/.openclaw/openclaw.json and add to the agent's tool configuration:
          {
            "mcpServers": {
              "graphiti": {
                "url": "http://<graphiti-vps-ip>:<mcp-port>/sse",
                "name": "graphiti-memory"
              }
            }
          }
          (Exact config format depends on OpenClaw's MCP server configuration —
           refer to https://docs.openclaw.ai/tools for current syntax)
Step 4.2: Restart the agent's Gateway
Step 4.3: Test: send the agent a message that triggers a Graphiti write
          Example: "Note that client TEST123 prefers blue vehicles"
Step 4.4: Verify the fact appears in Graphiti by querying directly
Step 4.5: From a DIFFERENT agent VPS, query Graphiti for that fact
Step 4.6: Repeat Steps 4.1-4.5 for all 6 agent VPS instances
```

### Phase 5: Shared Brain Panel Development (Day 5-10)

```
Step 5.1: Create API proxy routes in Mission Control
          - Add files to src/app/api/graphiti/
          - Each route fetches from GRAPHITI_API_URL and returns JSON
          - Add auth middleware (same as existing MC routes)
          - Test each route independently with curl

Step 5.2: Build the Shared Brain panel component
          - Create src/components/panels/SharedBrainPanel.tsx
          - Register in SPA shell routing
          - Add to NavRail with brain/network icon
          - Start with Temporal Fact Feed (Section 2) — simplest, highest value:
            * Polling endpoint every GRAPHITI_POLL_INTERVAL_MS
            * Render as scrollable card list
            * Each card: timestamp, agent badge, entity name, fact text
            * Filter controls: agent dropdown, entity type dropdown, date range

Step 5.3: Add Entity Graph Viewer (Section 1)
          - Fetch subgraph from /api/graphiti/graph
          - Render with D3 force-directed layout
          - Color nodes by entity type
          - Click node → slide-out with temporal fact history
          - Zoom/pan controls

Step 5.4: Add Cross-Agent Conflict Alerts (Section 3)
          - Server-side: scan recent facts for same-entity/short-window overlaps
          - Display as alert cards with severity indicator
          - Include: conflicting facts side-by-side, agent names, entity link
          - Action buttons: Dismiss, Flag for Review

Step 5.5: Add Agent Memory Stats (Section 4)
          - Aggregate write counts per agent from Graphiti
          - Render with Recharts (bar chart by agent, line chart over time)
          - Show top-referenced entities table

Step 5.6: Integration testing
          - Write a fact from Agent A, verify it appears in MC panel within poll interval
          - Create a conflict scenario, verify alert fires
          - Test with all 6 gateways connected simultaneously
```

## File Structure for New Code

```
src/app/api/graphiti/
├── entities/route.ts          # GET — list entities
├── entity/[id]/route.ts       # GET — entity detail + facts
├── facts/route.ts             # GET — recent facts feed
├── conflicts/route.ts         # GET — conflict detection
├── stats/route.ts             # GET — per-agent metrics
├── search/route.ts            # POST — semantic search
└── graph/route.ts             # GET — subgraph for viz

src/components/panels/
└── SharedBrainPanel.tsx        # Main panel component

src/components/shared-brain/
├── FactFeed.tsx               # Temporal fact feed
├── EntityGraph.tsx            # D3 force-directed graph
├── ConflictAlerts.tsx         # Cross-agent conflict cards
├── AgentMemoryStats.tsx       # Recharts stats dashboard
├── EntityDetail.tsx           # Slide-out for entity facts
└── types.ts                   # TypeScript interfaces

src/lib/
└── graphiti-client.ts         # Graphiti API client wrapper
```

## Security Boundaries

- Mission Control → Graphiti: **read-only** (API key scoped to read)
- Agent VPS → Graphiti: **read-write** (via MCP, each agent has its own API key)
- Mission Control → Agent Gateways: **WebSocket** (existing MC multi-gateway auth)
- All inter-VPS traffic: **Hetzner private network** or WireGuard/Tailscale
- Graphiti VPS: **NOT exposed to public internet** — internal network only
- Mission Control: exposed via reverse proxy with TLS for operator access

## Validation Checklist

After each phase, verify before moving to the next:

**Phase 1 (Graphiti):**
- [ ] FalkorDB container running and healthy
- [ ] graphiti-core can connect and build indices
- [ ] Can add an episode and retrieve entities/facts
- [ ] MCP server responds to tool discovery from remote machine

**Phase 2 (Mission Control):**
- [ ] MC UI loads at /setup
- [ ] Admin account created
- [ ] All default panels render without errors

**Phase 3 (Gateway Connections):**
- [ ] At least 1 Gateway shows "connected" in MC
- [ ] Agent heartbeat visible in MC Agents panel

**Phase 4 (MCP on Agents):**
- [ ] Agent can call Graphiti MCP tool
- [ ] Fact written by Agent A is readable by Agent B
- [ ] Agent's local memory is NOT affected by Graphiti operations

**Phase 5 (Shared Brain Panel):**
- [ ] Fact Feed shows live data from Graphiti
- [ ] Entity Graph renders with correct node colors
- [ ] Conflict alert fires within 60 seconds of conflicting writes
- [ ] Stats show accurate per-agent counts

---

## Notes for the Implementing Agent

- When writing code, provide **exact complete files** — no abbreviated sections, no "// ... rest of code". Joe expects full replacements.
- Break each phase into reviewable steps. Do NOT proceed to the next step until Joe confirms the current one works.
- If a Graphiti API endpoint doesn't exist in the format described here, check the current Graphiti docs first and adapt — the API surface may have changed.
- The builderz-labs/mission-control codebase uses Zustand for state management — follow existing patterns when adding the Shared Brain panel's state.
- Use existing MC components (cards, badges, filters) wherever possible — don't build custom UI primitives.
- FalkorDB is preferred over Neo4j because it's lighter for Hetzner. If Joe decides on Neo4j instead, the only change is the driver import and connection string — Graphiti abstracts the rest.

---

*Document version: 1.0 — April 11, 2026*
*Architecture: 6 independent OpenClaw VPS (each with own Gateway + local memory) → Graphiti shared brain (central VPS) → Mission Control (orchestration dashboard)*
