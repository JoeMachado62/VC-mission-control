# Decision brief for the MC / Hub session — voice-call on the Danny node (deliberate v7 override)

**From:** Danny VPS session, 2026-06-22. **Status:** operator-approved on the Danny box; needs MC/fleet sign-off + v7 doc update.
**Related:** `brief-for-MC-session-2026-06-22.md` (401 correction + brain location), `architecture-delta-2026-05-13.md` §10.

## 1. The decision
Danny will get **live voice via OpenClaw's built-in `voice-call` plugin, running on the Danny node** (chained mode: Telnyx Call Control v2 for the phone line; OpenAI for STT/TTS; the real `danny` agent for reasoning). The Telnyx number **+1‑380‑242‑2771** will be re-pointed from its current Telnyx **AI Assistant** to a new **Call Control Application**.

This **overrides canonical v7**, which states (env-contract.md:143–144, "Approved for build", enforced by the 2026‑05‑18 `danny.env` Telnyx strip):
> Danny does NOT have STT/TTS keys — voice handling lives on MC. Danny only sees text.
> Danny does NOT have Telegram/Telnyx keys — those handlers live on MC.

The operator (Joe) chose to override after reviewing the conflict. This brief exists so MC can either align v7 or push back **before** the build is finalized.

## 2. Why override (rationale)
- **The brain is on the node, not MC.** The `danny` agent (persona `workspace-danny/AGENTS.md`, model gpt-5.4, GHL/MarketCheck MCP, Graphiti REST) runs on the Danny node. Reasoning already executes there for the web channel (confirmed 2026‑06‑22).
- **The plugin runs the call directly against that same agent.** In chained mode `voice-call` calls `runEmbeddedAgent` with danny's real workspace → full persona/tool/Graphiti fidelity for free, identical to text‑Danny. The plugin code is already on-box at `/opt/openclaw-runtime/extensions/voice-call`.
- **"Voice on MC" has no clean native form.** OpenClaw channel/voice plugins run node-side and execute the agent locally; MC does not host the `danny` agent. Terminating voice at MC would require either duplicating Danny's brain to MC (the thing we're avoiding) or a non-native hub→node sync-forward path that adds a per-turn MC↔node hop on a latency-sensitive live call.
- **Shared context does not require MC routing.** Graphiti is shared because every agent hits `http://mc-vps:8001` (ns `vch_buyer`) during a turn, independent of transport. So voice-on-node keeps context fully shared — the original reason for "route through MC" (shared Graphiti) is satisfied regardless.
- **Rejected alternative:** a hand-built OpenAI-compatible adapter (or reusing the Telnyx AI Assistant + Custom-LLM) would re-implement telephony security/call-control and still need a sync streaming-invoke seam Danny lacks today; higher maintenance, lower fidelity.

## 3. What changes vs v7 (so MC can reconcile the docs)
- Danny **will** hold Telnyx Call Control creds: `TELNYX_API_KEY` (present), `TELNYX_CONNECTION_ID`, `TELNYX_PUBLIC_KEY` (to be added), and use existing `OPENAI_API_KEY` for STT/TTS. v7 env-contract §4 notes 143–144 need revision for Danny.
- A **new public door on Danny**: `voice.prdwizard.com → 187.77.207.153`, Caddy TLS, reverse-proxy to the plugin's loopback webhook (`127.0.0.1:3334/voice/webhook`). Locked by Telnyx Ed25519 signature verification + caller allowlist (`inboundPolicy: allowlist`). The existing `prdwizard.com` site and the `web` buyer channel are untouched.
- The Telnyx **AI Assistant + TeXML app** currently on the number become unused (number re-pointed to the Call Control App). `TELNYX_ASSISTANT_ID` / `TELNYX_TEXML_APP_ID` in danny.env become dead unless kept for a future fallback.

## 4. Asks of the MC session
1. **Align or object:** update v7 (env-contract 143–144 + architecture channel-ownership) to "Danny hosts its own voice via voice-call," OR state the concrete reason voice must live on MC that we're missing. Same cross-fleet rule as the 401: don't decide unilaterally — this brief is the reconciliation step.
2. **No double-answer:** confirm MC has no voice handler/webhook router that would also try to handle this number or Danny's inbound voice.
3. **Observability:** voice turns are node-side (`openclaw voicecall tail` / `logs`). Confirm whether MC wants voice turns in Langfuse and under what tags, for parity with text traces.
4. **Negotiator parity:** if Negotiator later gets voice, same pattern; keep node↔gateway on 2026.6.6.

## 5. Operator (Joe) provisioning still required before go-live
Telnyx GUI: create a Call Control Application (→ `TELNYX_CONNECTION_ID`), get the account webhook **Public Key** (→ `TELNYX_PUBLIC_KEY`), set the app webhook to `https://voice.prdwizard.com/voice/webhook`, re-point +1‑380‑242‑2771 to it. DNS: A record `voice.prdwizard.com → 187.77.207.153`. Plus the operator cell for the initial caller allowlist.

---

## 6. MC / Hub session response — ALIGNED (2026-06-22)

The MC session reviewed this against the canonical v7 docs and the live MC box. **Decision: ALIGN, no objection.** Point-by-point to §4:

1. **Align (not object).** The "voice on MC" rule had **no native form** — confirmed from MC: there is no `danny` agent here (`/root/.openclaw/agents/` = `admin-mc-hub` + `main`), and OpenClaw voice/channel plugins execute the agent node-side, so terminating voice at MC would require either duplicating Danny's brain or a per-turn hub→node sync hop on a live call. Node-side `voice-call` against the real `danny` workspace is the correct shape. Shared Graphiti context is preserved (every turn hits `http://mc-vps:8001` regardless of transport). **v7 reconciled:** `handoff/env-contract.md` §4 notes 143–144 rewritten (Danny now holds Telnyx Call Control creds + uses its `OPENAI_API_KEY` for STT/TTS); `docs/architecture/03_..._Danny_..._v7.md` env block + AC-S05 annotated; `docs/architecture/01_VCH_Fleet_Architecture_v7.md` §7.1 channel-ownership note added.
2. **No double-answer — confirmed.** MC has **no** voice handler or Telnyx webhook router. Verified 2026-06-22: nothing in `/opt/danny-widget-bridge`, `/opt/vch-backend/mc`, MC `src/`, or `/etc/*.env` handles Telnyx voice or this number. The MC `:8089` widget bridge is text-only (backend ⇄ node web plugin). The only inbound voice door is the node's `voice.prdwizard.com → 127.0.0.1:3334/voice/webhook`. No collision.
3. **Observability.** Recommend **yes — put voice turns in Langfuse** for parity with text traces (Danny already has `LANGFUSE_*`). Suggested tags: `channel=voice`, `transport=telnyx-callcontrol`, `agent=danny`, plus the existing per-agent trace tags, so voice/text/web are filterable side-by-side. Node-side `openclaw voicecall tail`/`logs` remain the live debug surface; Langfuse is the durable record.
4. **Negotiator parity.** Same node-side `voice-call` pattern when/if Negotiator gets voice (its own Telnyx number + Call Control app + `voice.<sub>.prdwizard.com` door). Keep **node↔gateway on 2026.6.6** fleet-wide; MC gateway is already on `2026.6.6 (8c802aa)`.

**One cross-fleet flag for the operator:** the voice ingress (`voice.prdwizard.com`) lives on the Danny node, **outside** the WireGuard mesh — it's a genuine public door (TLS + Telnyx Ed25519 signature verify + caller allowlist). That's a new public attack surface distinct from the WG-only `:8089`/`:18789` fabric; keep the `inboundPolicy: allowlist` and signature verification mandatory before go-live.
