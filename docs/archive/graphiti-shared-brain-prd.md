# Graphiti Shared Brain PRD

## Purpose

Graphiti is the intended shared brain for the VirtualCarHub OpenClaw agent fleet. It should store cross-agent temporal knowledge: facts about vehicles, clients, deals, deliveries, conflicts, and recent actions that one agent learns and another agent needs before acting.

This document replaces the older OpenBrain PRD. Do not build a second memory system. The work is to finish wiring the existing Graphiti deployment into OpenClaw agents and Mission Control.

## Current State

As of the last VPS inspection:

- Graphiti is cloned at `/root/graphiti`.
- Graphiti services are running from `/root/graphiti/docker-compose.validation.yml`.
- `graphiti-rest` listens on `127.0.0.1:8001`.
- `graphiti-mcp` listens on `127.0.0.1:8002`.
- `graphiti-neo4j` listens on `127.0.0.1:7474` and `127.0.0.1:7687`.
- `graphiti-mcp` health responds with `{"status":"healthy","service":"graphiti-mcp"}`.
- The REST API exposes `/messages`, `/search`, `/episodes/{group_id}`, `/get-memory`, `/entity-node`, `/entity-edge/{uuid}`, `/group/{group_id}`, and `/clear`.
- `GET /episodes/main?last_n=10` returned `[]`, which means no agent writes were observed in the default `main` group.
- `openclaw mcp list` returned no configured MCP servers in `/root/.openclaw/openclaw.json`.
- Mission Control has local memory views and per-agent working memory, but no Graphiti routes or Shared Brain panel yet.
- Langfuse observability is separate and does not conflict with Graphiti. Langfuse owns observability traces; Graphiti owns durable shared knowledge.

## Product Goal

Agents must use Graphiti as a common temporal knowledge graph:

1. Before taking an action, an agent checks Graphiti for relevant facts and possible conflicts.
2. After taking an action, the agent writes a concise fact or episode to Graphiti.
3. Other agents can immediately search and retrieve that fact.
4. Mission Control displays Graphiti data read-only so an operator can see recent facts, important entities, conflicts, and agent write activity.

## Non-Goals

- Do not replace OpenClaw local memory. Local memory remains the agent's private working context.
- Do not store canonical operational state in Graphiti. Deal state, pipeline stages, inventory status, funding state, and transport status remain in the VCH backend.
- Do not make Mission Control write to Graphiti in the normal UI. Agents write; Mission Control reads.
- Do not build a custom graph database or custom MCP server. Use Graphiti's existing REST and MCP services.
- Do not merge Langfuse data into Graphiti for this phase. Trace links can be included as metadata later, but observability and shared memory are separate surfaces.

## Data Contract

Use `group_id: "neo4j"` for this local Neo4j Community deployment because the current Graphiti core writes to a Neo4j database matching `group_id`, and this VPS has a single writable database named `neo4j`. Treat VirtualCarHub as the logical namespace in metadata and fact text. If the deployment moves to a Graphiti backend that supports distinct writable databases/groups, the logical production group may be changed to `vch`.

Every agent write should include these fields as structured metadata when the Graphiti endpoint or MCP tool supports metadata:

```json
{
  "agent_id": "sourcing-agent",
  "agent_name": "SourcingAgent",
  "source": "openclaw",
  "task_id": "mission-control-task-id-if-known",
  "trace_id": "langfuse-trace-id-if-known",
  "entity_type": "vehicle|client|deal|delivery|dealer|agent|other",
  "entity_id": "vin-or-contact-or-deal-id",
  "valid_at": "ISO-8601 timestamp",
  "confidence": 0.0
}
```

The text written to Graphiti should be concise and factual:

```text
SourcingAgent found that vehicle VIN 1ABC... has a pending dealer counteroffer of 28750 USD valid until 2026-05-07T18:00:00Z.
```

Do not write:

- Raw prompt transcripts.
- Long chain-of-thought.
- Secrets, credentials, tokens, or private customer payment data.
- Unverified guesses without marking them as low confidence.

## Entity Model

Start with these entity types:

| Entity | Primary ID | Examples |
| --- | --- | --- |
| Vehicle | VIN | status, price, location, condition, pending buyer interest |
| Client | CRM contact ID | preferences, constraints, timing, qualification notes |
| Deal | deal ID | active vehicle target, blockers, handoffs |
| Delivery | delivery ID | route, carrier, pickup/dropoff windows |
| Dealer | dealer ID or name | relationship notes, inventory patterns |
| Agent | stable agent slug | provenance and writer identity |

Relationship examples:

- Client `INTERESTED_IN` Vehicle
- Client `HAS_DEAL` Deal
- Deal `TARGETS` Vehicle
- Delivery `TRANSPORTS` Vehicle
- Agent `WROTE_FACT` Vehicle, Client, Deal, Delivery, or Dealer

## Required Implementation

### 1. Secure Graphiti Access

Current containers bind only to localhost. That is safe, but remote agent VPSes cannot reach Graphiti yet.

Implement one of these access patterns:

Preferred:

- Put all agent VPSes and the Mission Control VPS on a private Tailscale, WireGuard, or Hetzner private network.
- Bind Graphiti MCP only on the private interface.
- Keep Neo4j private and never publicly routable.

Acceptable for local single-VPS testing:

- Keep Graphiti MCP on `127.0.0.1:8002`.
- Configure only the local OpenClaw gateway to use it.

Do not expose Graphiti MCP or Neo4j directly to the public internet without authentication and network allowlisting.

### 2. Register Graphiti MCP With OpenClaw

Add Graphiti as an MCP server in the OpenClaw config used by each agent runtime.

Target for this VPS:

- Config file: `/root/.openclaw/openclaw.json`
- Verify with: `openclaw mcp list`
- Restart service after config change: `systemctl restart openclaw-gateway.service`

Use the exact syntax supported by the installed OpenClaw CLI. Discover it with:

```bash
openclaw mcp --help
openclaw mcp set --help
openclaw mcp show
```

The intended logical registration is:

```json
{
  "mcpServers": {
    "graphiti": {
      "url": "http://127.0.0.1:8002/mcp",
      "name": "graphiti-memory"
    }
  }
}
```

If the installed Graphiti MCP server exposes a different path, discover the correct endpoint from the container logs, image docs, or a protocol probe before saving config.

Acceptance:

- `openclaw mcp list` shows a `graphiti` server.
- The gateway starts cleanly after restart.
- An agent/tool discovery call can see Graphiti tools.

### 3. Verify Agent Write And Read

Create a smoke test that proves the full shared-brain loop:

1. Write a test episode/fact to the configured Graphiti group.
2. Search for the same fact through Graphiti REST.
3. Search for the same fact through Graphiti MCP if OpenClaw exposes the tool.
4. Confirm the fact appears in `/episodes/{GRAPHITI_GROUP_ID}?last_n=10`.
5. Delete or clearly mark the smoke-test fact so it does not pollute production memory.

Acceptance:

- A fact written by one tool path is readable by another.
- The result includes enough metadata to identify the writer agent and related task.
- Failures are logged with actionable error messages.

### 4. Add Mission Control Graphiti Configuration

Add these variables to `.env.example`, `/root/openclaw-mission-control/.env`, and `/etc/mission-control/mission-control.env` as appropriate:

```bash
GRAPHITI_ENABLED=true
GRAPHITI_API_URL=http://127.0.0.1:8001
GRAPHITI_MCP_URL=http://127.0.0.1:8002
GRAPHITI_GROUP_ID=neo4j
GRAPHITI_READ_ONLY=true
GRAPHITI_TIMEOUT_MS=8000
GRAPHITI_POLL_INTERVAL_MS=5000
GRAPHITI_CONFLICT_WINDOW_MINUTES=60
```

If a network API key or auth proxy is added later, add:

```bash
GRAPHITI_API_KEY=
```

Do not print secret values in logs, tests, or terminal summaries.

### 5. Add Mission Control Read-Only API Routes

Create a small Graphiti client at:

- `src/lib/graphiti/config.ts`
- `src/lib/graphiti/client.ts`
- `src/lib/graphiti/types.ts`

Add read-only routes:

- `GET /api/graphiti/health`
- `GET /api/graphiti/facts`
- `GET /api/graphiti/search?q=...`
- `GET /api/graphiti/graph`
- `GET /api/graphiti/stats`
- `GET /api/graphiti/conflicts`

Route behavior:

- Require the same Mission Control auth style as existing API routes.
- Never expose Graphiti credentials to the browser.
- Default to `GRAPHITI_GROUP_ID`.
- Use timeouts and clear JSON error responses.
- If Graphiti is disabled, return a stable disabled response instead of throwing.

Minimum mapping:

- `/api/graphiti/health` calls Graphiti REST `/healthcheck`.
- `/api/graphiti/facts` calls `/episodes/{group_id}?last_n=N` and normalizes the response.
- `/api/graphiti/search` calls REST `/search`.
- `/api/graphiti/stats` derives counts from recent episodes and facts.
- `/api/graphiti/conflicts` detects same entity references by different agents inside `GRAPHITI_CONFLICT_WINDOW_MINUTES`.
- `/api/graphiti/graph` returns nodes and edges suitable for the UI. If Graphiti REST cannot provide a full graph directly, build a lightweight graph from recent facts/search results for v1.

### 6. Add Mission Control Shared Brain UI

Add a read-only panel using existing Mission Control design patterns:

- `src/components/panels/shared-brain-panel.tsx`
- Register it in the panel router/navigation.
- Use existing card, badge, button, and panel patterns.
- Do not add a marketing hero page.

The first version must include:

- Health/status strip: enabled, API reachable, group ID, last refresh.
- Recent fact feed: latest Graphiti episodes/facts with agent, entity, timestamp, and source task if available.
- Search: query Graphiti and show ranked facts/entities.
- Conflict alerts: same entity touched by multiple agents inside the configured window.
- Agent write stats: counts by agent for recent facts.

The graph visualization can be simple for v1. Prefer useful facts and conflicts over decorative visualization.

### 7. Add Agent Operating Instructions

Update the relevant agent runtime docs or prompts so each VCH agent follows this policy:

Before acting:

1. Query local OpenClaw memory.
2. Query Graphiti for the target client, vehicle, deal, dealer, or delivery.
3. If Graphiti returns a recent conflict or blocker, pause or escalate instead of acting blindly.

After acting:

1. Write a concise fact to Graphiti.
2. Include agent identity, entity ID, task ID, and trace ID when available.
3. Update local memory only with private working context or agent-specific notes.

Acceptance:

- The instructions are stored where OpenClaw agents actually load runtime guidance.
- A future agent can read the file and understand exactly when to query/write Graphiti.

### 8. Tests And Verification

Run:

```bash
pnpm exec tsc --noEmit
pnpm api:parity
pnpm lint
pnpm build
```

Also run service checks:

```bash
docker compose -f /root/graphiti/docker-compose.validation.yml ps
curl -fsS http://127.0.0.1:8001/healthcheck
curl -fsS http://127.0.0.1:8002/health
openclaw mcp list
systemctl status openclaw-gateway.service --no-pager
systemctl status mission-control.service --no-pager
```

Acceptance:

- Mission Control still builds and starts.
- Existing Langfuse task observability still works.
- Graphiti health is visible in Mission Control.
- At least one smoke-test fact can be written and searched.
- No secrets are committed.

## Implementation Order

1. Confirm the live Graphiti REST and MCP endpoints.
2. Add Graphiti env vars and config helpers.
3. Add read-only Mission Control API routes.
4. Add the Shared Brain panel and navigation entry.
5. Configure local OpenClaw MCP registration.
6. Run the Graphiti write/search smoke test.
7. Build and restart Mission Control.
8. Document remote-agent rollout steps for the remaining VCH agent VPSes.

## Done Criteria

Graphiti is considered sufficient for the original OpenBrain goal when:

- Graphiti is reachable through a secure private path.
- OpenClaw has Graphiti registered as an MCP tool.
- An agent can write a fact to the configured Graphiti group.
- A different agent or tool can read that fact back.
- Mission Control displays recent Graphiti facts and health read-only.
- Operators can see conflicts or recent multi-agent touches on the same entity.
- Langfuse remains independent and still traces agent/task execution.

Until all criteria pass, Graphiti is installed but not fully serving as the central brain.
