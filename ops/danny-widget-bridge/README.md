# Danny Widget Bridge

Additive HTTP transport that lets the buyer chat widget (hosted on the backend VPS)
exchange messages with the `danny` agent on Danny VPS through the OpenClaw fleet.

OpenClaw 2026.4.x has no native browser-widget channel adapter (its `web`
namespace is WhatsApp Web). The bridge is a small Python stdlib service that
runs on Mission Control (`10.50.0.1`) and mediates the four-leg pipeline:

```
backend (10.50.0.4)                             danny (10.50.0.2)
      |                                                ^
      | POST /inbound/danny-widget                     | POST /web/inbound (push)
      |    Bearer <BRIDGE_AUTH_TOKEN>                  |    Bearer <BRIDGE_PUSH_TOKEN>
      v                                                |
+---------------------------- mc-vps (10.50.0.1:8089) ----------------------------+
|  ThreadingHTTPServer + SQLite WAL queue + forwarder + pusher + lease worker    |
+---------------------------------------------------------------------------------+
      ^                                                |
      | POST /v1/webhooks/danny-reply (forward)        | POST /reply/<message_id>
      |    Bearer <BRIDGE_BACKEND_REPLY_TOKEN>         |    Bearer <BRIDGE_POLL_TOKEN>
```

- **Listener**: `10.50.0.1:8089` (WG-only; not exposed on loopback or public).
- **Storage**: `/var/lib/danny-widget-bridge/queue.db` (SQLite WAL) +
  `/var/log/danny-widget-bridge/inbound.jsonl` (rotating audit).
- **Idempotency**: stable `message_id` per inbound; backend dedupes on
  `(conversation_id, message_id)`.
- **Synthetic loopback**: `conversation_id` prefixed `synthetic-` flows normally;
  backend auto-acks without storing.
- **Dormant degradations**: an empty `BRIDGE_PUSH_TOKEN` makes the pusher no-op
  (queue stays durable); an empty `BRIDGE_BACKEND_REPLY_TOKEN` makes the reply
  forwarder no-op. Both signal via `/healthz`.

## Endpoints

| Method | Path                       | Auth token                     | Purpose                                    |
|--------|----------------------------|--------------------------------|--------------------------------------------|
| POST   | `/inbound/danny-widget`    | `BRIDGE_AUTH_TOKEN`            | Backend posts a buyer turn → `202`         |
| POST   | `/reply/<message_id>`      | `BRIDGE_POLL_TOKEN`            | Danny posts a reply → forwarder enqueue    |
| POST   | `/ack/<message_id>`        | `BRIDGE_POLL_TOKEN`            | Danny: no reply, done                      |
| POST   | `/release/<message_id>`    | `BRIDGE_POLL_TOKEN`            | Danny: release lease early                 |
| GET    | `/pending`                 | `BRIDGE_POLL_TOKEN`            | Legacy pull surface (Phase-1 fallback)     |
| GET    | `/healthz`                 | none                           | Queue stats + presence flags               |

## Tokens (three-token matrix)

| Token                        | Direction              | Lives on                              |
|------------------------------|------------------------|---------------------------------------|
| `BRIDGE_AUTH_TOKEN`          | backend → MC inbound   | MC `/etc/danny-widget-bridge.env`     |
| `BRIDGE_POLL_TOKEN`          | Danny → MC reply       | MC `/etc/danny-widget-bridge.env`     |
| `BRIDGE_BACKEND_REPLY_TOKEN` | MC → backend forward   | MC `/etc/danny-widget-bridge.env`     |
| `BRIDGE_PUSH_TOKEN`          | MC → Danny push        | MC `/etc/danny-widget-bridge.env`     |

Danny's peer token pair (`DANNY_GATEWAY_TOKEN`, generated push token) lives on
Danny VPS in `/etc/danny.env`; backend's peer token pair (`DANNY_GATEWAY_TOKEN`,
`DANNY_REPLY_TOKEN`) lives on backend VPS in `backend/.env`.

## Install

```bash
# 1. Code
install -d /opt/danny-widget-bridge /var/log/danny-widget-bridge /var/lib/danny-widget-bridge
install -m 0755 bridge.py                     /opt/danny-widget-bridge/bridge.py
install -m 0755 install-reply-token.sh        /opt/danny-widget-bridge/install-reply-token.sh
install -m 0755 install-push-token.sh         /opt/danny-widget-bridge/install-push-token.sh

# 2. Systemd unit
install -m 0644 danny-widget-bridge.service   /etc/systemd/system/danny-widget-bridge.service

# 3. Environment file (mode 0600, DO NOT commit)
#    Generate BRIDGE_AUTH_TOKEN + BRIDGE_POLL_TOKEN locally with `openssl rand -hex 32`.
#    BRIDGE_BACKEND_REPLY_TOKEN + BRIDGE_PUSH_TOKEN arrive by secure scp from peers
#    (see install-reply-token.sh / install-push-token.sh).
umask 077
cat > /etc/danny-widget-bridge.env <<'EOF'
BRIDGE_BIND_HOST=10.50.0.1
BRIDGE_BIND_PORT=8089
BRIDGE_AUDIT_PATH=/var/log/danny-widget-bridge/inbound.jsonl
BRIDGE_QUEUE_DB=/var/lib/danny-widget-bridge/queue.db

BRIDGE_AUTH_TOKEN=          # generate: openssl rand -hex 32
BRIDGE_POLL_TOKEN=          # generate: openssl rand -hex 32

BRIDGE_BACKEND_REPLY_URL=http://10.50.0.4:8000/v1/webhooks/danny-reply
BRIDGE_BACKEND_REPLY_TOKEN= # paste via install-reply-token.sh once operator scps the file

BRIDGE_PUSH_URL=http://10.50.0.2:18790/web/inbound
BRIDGE_PUSH_TOKEN=          # paste via install-push-token.sh once Danny generates + operator scps

BRIDGE_LEASE_SECS_DEFAULT=60
BRIDGE_LEASE_MAX_ATTEMPTS=5
BRIDGE_REPLY_RETRY_MAX_ATTEMPTS=5
BRIDGE_REPLY_TIMEOUT_SECS=10
BRIDGE_PUSH_RETRY_MAX_ATTEMPTS=5
BRIDGE_PUSH_TIMEOUT_SECS=10
BRIDGE_LEASE_EXPIRER_INTERVAL=10
BRIDGE_FORWARDER_INTERVAL=5
BRIDGE_PUSHER_INTERVAL=2
EOF

# 4. Start
systemctl daemon-reload
systemctl enable --now danny-widget-bridge.service

# 5. Verify
curl -s http://10.50.0.1:8089/healthz | python3 -m json.tool
```

## Peer-side prerequisites

- **Backend VPS**: install `DANNY_GATEWAY_TOKEN` (= MC's `BRIDGE_AUTH_TOKEN`),
  flip `DANNY_BRIDGE_ENABLED=true`, expose `/v1/webhooks/danny-reply` on
  `10.50.0.4:8000` (WG only).
- **Danny VPS**: install `BRIDGE_POLL_TOKEN` in `/etc/danny.env`, install and
  register the `web` channel plugin (`openclaw plugins install file:/opt/vch-openclaw-web`),
  add the routing binding `openclaw agents bind --agent danny --bind web:danny-widget`
  (env-source required to work around the `${VAR}` CLI parse bug on the daemon),
  and open UFW for `18790/tcp` from `10.50.0.1` only.

## Retry semantics

Every leg uses exponential backoff `(1, 5, 15, 60, 300)s`, max 5 attempts.
- `2xx` → done.
- `401` → log an alarm, do NOT retry (token issue).
- Other `4xx` → log, do NOT retry (contract mismatch).
- `5xx` / timeout / network → retry per backoff.

Rows whose `delivery_attempts` cap out sit at `delivery_status='retryable'` with
`delivery_next_attempt_at IS NULL`. Manual reset via SQL when the root cause is
fixed — see `ops/` playbook (or clear the `delivery_*` columns to zero).

## Health signal

`GET /healthz` returns:

```json
{
  "status": "ok",
  "service": "danny-widget-bridge",
  "queue": {
    "by_status": { "pending": 0, "done": 0 },
    "forward_pending": 0,
    "forward_auth_errors": 0,
    "push_pending": 0,
    "push_auth_errors": 0,
    "backend_token_present": true,
    "push_token_present": true,
    "push_url": "http://10.50.0.2:18790/web/inbound"
  }
}
```

## End-to-end smoke

Use a `synthetic-` prefixed `conversation_id` so backend auto-acks:

```bash
AUTH=$(cat /root/bridge_auth_token.secret)
curl -sS -X POST http://10.50.0.1:8089/inbound/danny-widget \
  -H "Authorization: Bearer $AUTH" \
  -H "Content-Type: application/json" \
  -d '{
        "binding": "web:danny-widget",
        "mode": "buyer",
        "conversation_id": "synthetic-smoke-1",
        "contact_id": "test-contact",
        "authenticated": false,
        "trace_id": "trace-smoke",
        "message": "hello"
      }'
```

Watch `journalctl -u danny-widget-bridge -f` for `pushed inbound ... status=202`
followed by `forwarded reply ... status=200`. If either leg 401s, run the
corresponding install script to refresh the token.
