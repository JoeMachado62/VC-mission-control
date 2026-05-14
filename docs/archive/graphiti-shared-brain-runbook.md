# Graphiti Shared Brain Runbook

Mission Control reads Graphiti through localhost by default:

```bash
GRAPHITI_API_URL=http://127.0.0.1:8001
GRAPHITI_MCP_URL=http://127.0.0.1:8002
GRAPHITI_GROUP_ID=neo4j
GRAPHITI_READ_ONLY=true
```

This deployment uses Neo4j Community, so the physical Graphiti group ID must match the single writable database, `neo4j`. Treat VirtualCarHub as the logical namespace in fact content and metadata. If this is moved to a Graphiti backend that supports separate writable databases per group, the logical group can be changed to `vch`.

Graphiti and Neo4j must stay private. For remote agent VPSes, put the agent hosts and the Mission Control/Graphiti host on a private network such as Tailscale, WireGuard, or a cloud private network, then bind only the MCP endpoint to that private interface. Do not expose Neo4j or Graphiti MCP directly to the public internet.

Local verification:

```bash
curl -fsS http://127.0.0.1:8001/healthcheck
curl -fsS http://127.0.0.1:8002/health
openclaw mcp list
pnpm smoke:graphiti
```

Agent policy:

- Search local OpenClaw memory, then Graphiti, before acting on clients, vehicles, deals, deliveries, dealers, or handoffs.
- Write a concise factual episode to the configured Graphiti group after acting.
- Include agent identity, task ID, trace ID, entity type, entity ID, valid time, and confidence when available.
- Keep Langfuse traces separate; trace IDs can appear as Graphiti metadata, but observability remains owned by Langfuse.
