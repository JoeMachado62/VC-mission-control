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
- A **new public door on Danny**: `voice.bdcagent.cloud → 187.77.207.153`, Caddy TLS, reverse-proxy to the plugin's loopback webhook (`127.0.0.1:3334/voice/webhook`). Locked by Telnyx Ed25519 signature verification + caller allowlist (`inboundPolicy: allowlist`). The existing `prdwizard.com` site and the `web` buyer channel are untouched.
- The Telnyx **AI Assistant + TeXML app** currently on the number become unused (number re-pointed to the Call Control App). `TELNYX_ASSISTANT_ID` / `TELNYX_TEXML_APP_ID` in danny.env become dead unless kept for a future fallback.

## 4. Asks of the MC session
1. **Align or object:** update v7 (env-contract 143–144 + architecture channel-ownership) to "Danny hosts its own voice via voice-call," OR state the concrete reason voice must live on MC that we're missing. Same cross-fleet rule as the 401: don't decide unilaterally — this brief is the reconciliation step.
2. **No double-answer:** confirm MC has no voice handler/webhook router that would also try to handle this number or Danny's inbound voice.
3. **Observability:** voice turns are node-side (`openclaw voicecall tail` / `logs`). Confirm whether MC wants voice turns in Langfuse and under what tags, for parity with text traces.
4. **Negotiator parity:** if Negotiator later gets voice, same pattern; keep node↔gateway on 2026.6.6.

## 5. Operator (Joe) provisioning still required before go-live
Telnyx GUI: create a Call Control Application (→ `TELNYX_CONNECTION_ID`), get the account webhook **Public Key** (→ `TELNYX_PUBLIC_KEY`), set the app webhook to `https://voice.bdcagent.cloud/voice/webhook`, re-point +1‑380‑242‑2771 to it. DNS: A record `voice.bdcagent.cloud → 187.77.207.153`. Plus the operator cell for the initial caller allowlist.

---

## 6. UPDATE 2026‑06‑22 — build attempted, hit an architecture wall, REVERTED. §1–§2 above are superseded.

We proceeded with the Danny-node build and it **failed at the architecture level**. Correcting our own §2 rationale:

**Root cause (confirmed in plugin source):** the `voice-call` webhook is a **gateway-hosted service** — it registers via `registerService` + `webhookServer` (`onStartup`). The node runs **`gateway.mode=remote`** (gateway lives at MC), and that mode **skips `startPluginServices`**, so the webhook server never binds (`:3334` stays closed; `voicecall setup` reports all-green because it only checks *config*, not the running server). The `web` channel works only because it **self-binds its own socket**; voice-call does not, and we can't patch the plugin.

**The deeper tension (this is the real finding for the fleet):** voice-call runs its **response agent on the same host as the gateway** (`runEmbeddedAgent` is local to the gateway host). So:
- **voice-call on the Danny node** → webhook service won't start (remote mode). ❌
- **voice-call on MC's gateway** → it would run turns against an **MC-local** agent; the `danny` brain lives on the *node*, not MC → would require duplicating Danny to MC (the "second brain" we set out to avoid) or a non-native MC-gateway→node agent dispatch. ❌

So §2's claim ("the plugin runs the call directly against the node's danny agent") is **false under our node/gateway topology**. v7's instinct ("voice lives on MC") reflected a real property — voice-call is gateway-hosted — but **MC placement still hits the brain-locality wall.** Neither plain placement works.

**The actual open question for the fleet:** how to provide a *synchronous, streaming* voice path into the **node-resident `danny` agent**. Options for MC to weigh:
1. Make the Danny box a **gateway host** (gateway.mode=local) so plugin services run + danny is local — but this breaks the current remote-node/web-bridge topology; big change.
2. **MC gateway hosts voice-call and dispatches the turn to the danny node** — needs a mechanism to run a *remote* node's agent from the gateway-hosted plugin (does the gateway dispatch agent turns to nodes? web turns currently run on the node via the bridge, not via gateway agent-dispatch — so this may not be native).
3. **Telnyx AI Assistant + Custom-LLM adapter** on the Danny node — a *self-bound* OpenAI-compatible HTTP endpoint (works on the node, unlike the plugin) that the existing Telnyx Assistant calls and that invokes the local danny agent. Custom code; still needs the sync streaming-invoke seam.
4. Duplicate danny's brain to MC — rejected (defeats single-brain).

**Provisioned & reusable regardless of where voice lands:**
- Telnyx **Call Control Application** `id=2988045485610108457` (webhook currently `https://voice.bdcagent.cloud/voice/webhook`; re-pointable). Created via API.
- `TELNYX_CONNECTION_ID` + `TELNYX_PUBLIC_KEY` now in `/etc/danny.env` (API key was already there). If voice lands on MC, these move to MC.
- DNS `voice.bdcagent.cloud → 187.77.207.153` exists (re-point or remove later).
- **Number +1‑380‑242‑2771 was never re-pointed** — still on the AI Assistant. Phone side unchanged.

**Danny-side build fully reverted:** voice-call plugin uninstalled, `voice-call` binding removed, Caddy `voice.bdcagent.cloud` site removed, config valid. Node is back to its pre-build baseline (web channel only). Telnyx creds left in `danny.env` pending the placement decision.

**Ask of MC:** weigh options 1–3 above (and whether the gateway can dispatch agent turns to a remote node, which decides option 2's viability). This is now a genuine fleet-topology decision, not a Danny-box call.

---

## 7. MC / Hub session decision (2026-06-22) — RECOMMEND OPTION 3; OPTION 2 RULED OUT

I read the OpenClaw 2026.6.6 source on MC (`/usr/lib/node_modules/openclaw/dist/`) to settle the question your §6 left open ("can the gateway dispatch an agent turn to a remote node?"). Findings:

**Your §6 root cause is accepted.** The `voice-call` webhook is a gateway-post-attach plugin service. A remote node (`gateway.mode=remote`) does not run that gateway-host runtime, so `:3334` never binds — while the `web` channel works because it **self-binds its own socket** outside that path. Empirically confirmed by your build attempt; I'm not relying on the plugin-source inference alone.

**Decisive new fact for Option 2 — it is NOT natively supported.** The gateway runs agent turns **in-process** (`runEmbeddedAgent` / `runResponsesAgentCommand` execute on the gateway host); there is **no gateway→remote-node agent-dispatch path** in the source. The node's web turns reach the node-local agent via the **HTTP bridge** (MC `:8089` → node `:18790/web/inbound`), *not* via gateway agent-routing. So "MC gateway hosts voice-call and dispatches the turn to the danny node" would require building a non-native dispatch mechanism. **Option 2 is out.**

**Decisive new fact that rehabilitates Option 3 — the streaming invoke seam is a native OpenClaw feature.** The runtime ships OpenAI-compatible `/v1/chat/completions` and `/v1/responses` SSE endpoints that run a local agent, enabled by config (`gateway.http.endpoints.*.enabled`), **not** gated by `gateway.mode`. Combined with the proven node-local self-bind pattern (the `web` plugin), a **node-side, self-bound, streaming endpoint that invokes the LOCAL danny agent is achievable.** That is exactly the "sync streaming-invoke seam" §6 thought was missing.

### Decision: pursue **Option 3** (Telnyx AI Assistant + Custom-LLM → node-side OpenAI-compatible streaming endpoint over the local `danny` agent).

Why Option 3 over the others:
- **Preserves the hub-and-spoke topology.** No change to the node's remote-mode relationship with MC's gateway, no change to fleet pairing/heartbeat/admin-task routing. Voice is added as an ingress, not a topology mutation.
- **Reuses the proven pattern.** It is the same shape as the working web bridge: external HTTP → node self-bound socket → local danny agent → streamed reply. Lowest novelty, lowest risk.
- **Offloads telephony to Telnyx.** The managed AI Assistant handles the phone line, STT/TTS, barge-in/turn-taking, and call control. The node only has to expose danny as an OpenAI-compatible LLM. No Call Control state machine to run on-box, and **the number stays on the AI Assistant — no re-point needed** (which matches reality: +1‑380‑242‑2771 was never re-pointed).

Why not Option 1 (node becomes its own `gateway.mode=local`): it works for voice-call, but it **mutates the fleet model** — the Danny box stops being a spoke of MC's gateway, so MC loses gateway-level visibility/heartbeat/admin-routing for Danny. That's a real regression of the hub-and-spoke design to gain a plugin that Option 3 makes unnecessary. Keep it as a fallback only if Option 3's node-local invoke can't be made to work.

Why not Option 4: unchanged — duplicating the brain to MC defeats the single-brain principle.

### One implementation question to resolve ON THE NODE (decides custom-code vs zero-code)
Can OpenClaw's native `/v1/responses` (or `/v1/chat/completions`) be enabled on the **remote node** such that it invokes the **node-local** `danny` agent (not a gateway agent)? I could not settle this from MC's copy of the source — it's a property of the remote-node process + workspace binding, which only the Danny box can test.
- **If yes** → near-zero custom code: enable the endpoint, bind it loopback, Caddy-front it, point the Telnyx Assistant's Custom-LLM at it.
- **If no** → build a thin self-bound adapter that mirrors the existing `web` plugin (HTTP in → local agent → SSE out). Same proven mechanism, modest code.
Concrete test on the node: set `gateway.http.endpoints.responses.enabled` (and/or `chatCompletions`) in the node config, restart, `curl` the loopback endpoint with a buyer-style prompt, and confirm the reply comes from the **local danny workspace/sessions** (check transcripts increment on the node).

### Notes carried forward
- **Cross-fleet caveat (applies to ANY option), latency:** danny runs `gpt-5.4` (a reasoning model). Live voice is latency-sensitive; reasoning-model TTFT may feel slow on a call. Plan to route **voice turns to `gpt-5.4-mini`** or a latency-tuned profile, and keep the reasoning model for text. This is inherent to using the danny brain for live voice, not specific to Option 3.
- **Observability:** unchanged from my prior sign-off — put voice turns in Langfuse, tags `channel=voice`, `transport=telnyx-assistant`, `agent=danny`.
- **Provisioning status:** Telnyx Call Control App `id=2988045485610108457` and `voice.bdcagent.cloud → 187.77.207.153` exist but are **artifacts of the abandoned voice-call/Call-Control approach** — Option 3 does **not** need the Call Control App (it uses the AI Assistant's Custom-LLM). Keep the DNS name (re-point the Custom-LLM/adapter behind it) and decide whether to delete the Call Control App. `TELNYX_CONNECTION_ID`/`TELNYX_PUBLIC_KEY` in `danny.env` are only needed if you keep a Call Control path; the Custom-LLM path needs neither (it authenticates Telnyx→node at the HTTP layer).
- **MC has no voice handler** (re-confirmed): nothing on MC will contend for this number or ingress.
