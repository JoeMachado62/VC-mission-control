# VirtualCarHub — Fleet Architecture Documentation

VirtualCarHub (VCH) is an AI-powered virtual automotive brokerage. Consumers access wholesale vehicle inventory directly — no physical lot, no commissioned salespeople, no retail markup. VCH charges a flat service fee and operates entirely online with vehicle delivery.

This folder holds the canonical architecture documentation for VCH's AI agent fleet — the production agents (Danny, Negotiator), the supporting infrastructure (Mission Control, backend, observability stack), and the operational tooling (admin agents, Lobster workflows, OpenClaw configuration).

---

## v7 Is Canonical

**Anything in this folder that is not in the four v7 documents below is not current.** v4, v5, and v6 documents are archived for historical reference only. Do not work from archived versions. If something in v7 looks wrong or contradicts current behavior on a VPS, surface the discrepancy to the operator and update v7 — do not fall back to an older document.

---

## Documents

Read in this order:

| # | Document | Audience | What's in it |
|---|---|---|---|
| 1 | `01_VCH_Fleet_Architecture_v7.md` | Everyone | Foundational. System topology, OpenClaw mental model, skill format conventions (SKILL.md), MCP integration patterns, observability, security, secret hygiene, six-phase build plan, open questions. Every VPS session reads this first. |
| 2 | `02_VCH_Backend_MC_Implementation_v7.md` | Backend VPS + Mission Control VPS sessions | Two-part document. Part 1 (Backend, §1–8): FastAPI services, Postgres schema, `agent_actions_service` policy boundary, audit logging, matching engine integration, deal state machine, per-agent service token provisioning. Part 2 (MC, §9–20): OpenClaw gateway hosting (loopback + socat relay), Caddy TLS, Langfuse, Graphiti + Neo4j, fleet console UI, `admin-mc-hub` agent including backend admin operations, Lobster workflows on MC, master pairing token management. |
| 3 | `03_VCH_Danny_Agent_Implementation_v7.md` | Danny VPS session | Complete spec for the `danny` agent — dual-mode (buyer + admin), 12 buyer-mode skills and 6 admin-mode skills (each with full SKILL.md content or structured frontmatter), persona files (AGENTS.md / SOUL.md / USER.md / IDENTITY.md), mode determination via channel routing, behavioral framework (untrusted content wrapping, confidence-based extraction, HITL escalation taxonomy, rate limits), eval suite. Plus the `admin-danny` administrator agent. |
| 4 | `04_VCH_Negotiator_Agent_Implementation_v7.md` | Negotiator VPS session | Complete spec for the `negotiator` agent — wholesale-only single mode, 12 production skills, both GHL MCP and MarketCheck MCP integration, Browser Use for dealer chat widget operation via sub-agent spawning, strategy report framework with pricing envelope, bounds-aware negotiation principles, HITL escalation taxonomy, eval suite. Plus the `admin-negotiator` administrator agent. |

Each doc is **self-contained** — it does not require reading v4, v5, or v6 documents. All behavioral content from prior versions that remains valid has been folded in.

---

## Architecture at a Glance

**Four VPSs at launch** (with headroom for six future specialist agents):

- **Mission Control** (`10.50.0.1`) — fleet control plane. Hosts OpenClaw gateway (the hub all spokes pair to), Langfuse (observability), Graphiti + Neo4j (shared knowledge graph), Caddy (TLS termination), Next.js fleet console UI, and the `admin-mc-hub` agent.
- **Backend** (`10.50.0.4`) — FastAPI + Postgres. Runs `agent_actions_service` (the policy enforcement boundary for all agent state changes), orchestrator (stall detection, scheduled jobs, webhooks), matching engine, deal state machine, audit service. **No OpenClaw on this VPS** — admin operations come from `admin-mc-hub` via HTTP.
- **Danny** (`10.50.0.2`) — OpenClaw 2026.4.14 + `danny` production agent (dual-mode buyer + admin) + `admin-danny` VPS administrator. GHL MCP only (no MarketCheck — that's Negotiator's domain).
- **Negotiator** (`10.50.0.3`) — OpenClaw 2026.4.14 + `negotiator` production agent (wholesale-only) + `admin-negotiator` VPS administrator + Browser Use Python library (for dealer chat widget operation). Both GHL MCP and MarketCheck MCP.

Future specialist VPSs (`logistics`, `f-and-i`, `title-clerk`, `compliance`, `customer-success`, `marketing`) join the WireGuard mesh at `10.50.0.5+` following the same pattern.

**OpenClaw 2026.4.14** is the agent platform on agent VPSs. VCH builds custom skills (`SKILL.md` files) as the primary deliverable. **Lobster** workflows handle HITL pipelines where determinism and audit matter (strategy report approval, out-of-bounds counter-offer decisions, secret rotation). **MCPorter** integrates GHL MCP and MarketCheck MCP at the daemon level — Python skill scripts never see provider tokens.

All agent state changes route through backend's `/v1/agent-actions/*` endpoints, which enforce policy (rate limits, content rules, scope checks) before allowing the underlying operation (Telnyx send, GHL update, etc.). Audit log captures every action with `trace_id` for correlation with Langfuse traces.

---

## Reading Notes for Future Sessions

Every v7 document opens with a **§0.5 "Verifying Against Current Reality"** section. **Read it before proceeding to the substance.** It contains:

- **The three rules:** current reality wins, verify before assuming, run the command to confirm
- **Canonical URLs** for every tool in the stack (OpenClaw, MCP, GHL, MarketCheck, Telnyx, Langfuse, Graphiti, Neo4j, FalkorDB, Browser Use, Caddy, WireGuard)
- **Anti-patterns from this project's history** that have caused real architectural errors — e.g., treating OpenClaw as a thin Node CLI rather than the substantial agent platform it is; assuming `pip install openclaw` rather than `npm install -g openclaw@<version>`; inventing GHL tool names like `ghl_get_contact` rather than using the real `contacts_get-contact` names; assuming Twilio for voice/SMS rather than Telnyx

If you find yourself relying on what you "remember" about OpenClaw, MCP, Browser Use, or any other named tool — stop, consult the canonical URL, verify the actual current behavior.

---

## Archive Policy

`archive/` contains v4, v5, and v6 documents preserved for historical reference. They reflect:

- Earlier architectural framings that were superseded (e.g., v5's "Python custom runtime replaces OpenClaw" was wrong; v6's "Layer 1 / Layer 2 / Layer 3" framing was overcomplicated)
- Factual errors that v7 corrects (incorrect OpenClaw install pattern, invented GHL tool names, wrong observability URLs, Twilio references)
- Intermediate iterations from before the OpenClaw ecosystem was fully understood (5,400+ skills in ClawHub, sub-agent spawning, Lobster workflow engine, MCPorter)

**Do not reference archive/ content from v7 work.** If v7 needs to be updated for accuracy or new requirements, edit v7 directly — do not fall back to an archived version.

---

## How to Update These Documents

The v7 documents are the authoritative architecture record. When something needs to change:

1. Determine which v7 doc is affected (use the audience table above to identify scope).
2. Propose the change with operator approval and rationale.
3. Update the affected v7 doc(s).
4. If the change affects how a VPS session should operate, also update the corresponding kickoff prompt in `KICKOFF_PROMPTS_v7.md`.
5. Update Claude.ai project knowledge — delete the old version of the affected file and re-upload the updated version.
6. Commit + push to backend repo on a working branch; merge on operator approval.

When something is materially new (e.g., adding a future specialist agent), follow the existing pattern: copy `03_VCH_Danny_Agent_Implementation_v7.md` or `04_VCH_Negotiator_Agent_Implementation_v7.md` as the template, fold in the new agent's specifics (skill catalog, persona, scope, MCPs needed, HITL taxonomy), add as `05_VCH_<Name>_Agent_Implementation_v7.md`. Update this README and Doc 1's §4.3 future-specialist table to reference the new doc.

---

## Related Resources

- Backend repo: `/opt/vch-backend/` (this folder lives at `/opt/vch-backend/docs/architecture/`)
- Mission Control upstream: https://github.com/builderz-labs/mission-control (VCH internal fork URL from operator)
- OpenClaw upstream: https://github.com/openclaw/openclaw
- OpenClaw docs: https://docs.openclaw.ai
- ClawHub skills marketplace: https://www.clawhub.com
- VCH operational Telegram chats: `ops-chat` (Danny admin mode), `ops-chat-admin` (admin agents), `ops-chat-wholesale` (Negotiator oversight) — chat IDs per operator allowlist (OQ-V7-C)
- VPS field reports (operational artifacts, not in this folder): live on each agent VPS at `/opt/<agent>-agent/handoff/` from the original v4 → v6 install work

---

## Quick Reference: Who Reads What

| If you're starting a session on... | Read these |
|---|---|
| Backend VPS | README.md (this file) → Doc 1 → Doc 2 Part 1 (§1–8) |
| Mission Control VPS | README.md → Doc 1 → Doc 2 Part 2 (§9–20) |
| Danny VPS | README.md → Doc 1 → Doc 3 (whole doc) |
| Negotiator VPS | README.md → Doc 1 → Doc 4 (whole doc) |
| Any future specialist VPS | README.md → Doc 1 → that specialist's implementation doc |

Each VPS session has a corresponding kickoff prompt in `KICKOFF_PROMPTS_v7.md` that the operator pastes into a fresh Claude Code session to start work.
