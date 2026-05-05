# Mission Control Standalone Refactor

This migration moves Mission Control from the current all-in-Docker stack to the deployment shape that fits the upstream docs best:

- Mission Control runs directly on the VPS with the Next standalone server
- OpenClaw gateway runs as its own systemd service
- Caddy runs on the host and terminates TLS for `virtualcarhub.cloud`
- Mission Control data and OpenClaw state live on stable host paths

## Target Filesystem Paths

- Repo root: `/root/openclaw-mission-control`
- Mission Control env: `/etc/mission-control/mission-control.env`
- Mission Control data: `/var/lib/mission-control`
- Mission Control logs: `journalctl -u mission-control`
- OpenClaw state: `/root/.openclaw`
- Caddy config: `/etc/caddy/Caddyfile`
- Backups during cutover: `/root/migration-backups/<timestamp>/`

## Proposed Mission Control Env

Install to `/etc/mission-control/mission-control.env`:

```env
PORT=3005
MISSION_CONTROL_DATA_DIR=/var/lib/mission-control
MC_ALLOWED_HOSTS=localhost,127.0.0.1,::1,virtualcarhub.cloud
MC_COOKIE_SECURE=true
MC_COOKIE_SAMESITE=strict

OPENCLAW_STATE_DIR=/root/.openclaw
OPENCLAW_GATEWAY_HOST=127.0.0.1
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_GATEWAY_TOKEN=__KEEP_CURRENT_TOKEN__
OPENCLAW_TOOLS_PROFILE=coding
NODE_COMPILE_CACHE=/var/tmp/openclaw-compile-cache
OPENCLAW_NO_RESPAWN=1

NEXT_PUBLIC_GATEWAY_URL=wss://virtualcarhub.cloud/gw
NEXT_PUBLIC_GATEWAY_CLIENT_ID=openclaw-control-ui

MC_DEFAULT_GATEWAY_NAME=primary
MC_COORDINATOR_AGENT=coordinator
NEXT_PUBLIC_COORDINATOR_AGENT=coordinator

AUTH_SECRET=__KEEP_CURRENT_AUTH_SECRET__
API_KEY=__KEEP_CURRENT_API_KEY__
```

Use the current generated `AUTH_SECRET`, `API_KEY`, and gateway token so the dashboard identity remains stable through cutover.

## Systemd Units

Install:

- `/etc/systemd/system/mission-control.service`
- `/etc/systemd/system/openclaw-gateway.service`

These templates are included in this directory.

## Caddy Config

Install `/etc/caddy/Caddyfile` from the template in this directory.

That config:

- serves `virtualcarhub.cloud`
- proxies the Mission Control app to `127.0.0.1:3005`
- proxies the OpenClaw gateway websocket and HTTP traffic on `/gw*` to `127.0.0.1:18789`

## Cutover Order

1. Install host prerequisites:
   - Node.js 22
   - pnpm via Corepack
   - build tools for `better-sqlite3`
   - Caddy
2. Back up the current Docker deployment state.
3. Copy Mission Control data from the Docker volume to `/var/lib/mission-control`.
4. Copy OpenClaw state from the Docker volume to `/root/.openclaw`.
5. Build Mission Control on the host with `pnpm install --frozen-lockfile` and `pnpm build`.
6. Install the env file, systemd units, and Caddy config.
7. Start `openclaw-gateway.service` on localhost only and validate `/healthz`.
8. Start `mission-control.service` and validate `http://127.0.0.1:3005/login`.
9. Stop the Docker Caddy container to free ports `80/443`.
10. Start host Caddy and validate `https://virtualcarhub.cloud/login`.
11. Stop Docker `mission-control` and `openclaw-gateway` only after the host services are healthy.
12. Keep the old Docker volumes and compose file untouched until post-cutover verification is complete.

## Rollback

If any validation fails after host cutover:

1. Stop host `caddy`, `mission-control`, and `openclaw-gateway`.
2. Restart Docker `mission-control`, `openclaw-gateway`, and `mission-control-caddy`.
3. Restore the prior `Caddyfile` container config if needed.
4. Point users back to the Docker-served dashboard.
5. Leave host data copies in place for later retry; do not overwrite Docker volumes during rollback.

## Validation Checklist

- `systemctl status mission-control`
- `systemctl status openclaw-gateway`
- `systemctl status caddy`
- `curl -I http://127.0.0.1:3005/login`
- `curl -s http://127.0.0.1:18789/healthz`
- `curl -I https://virtualcarhub.cloud/login`
- Dashboard login succeeds
- Gateway shows connected
- Browser websocket succeeds through `wss://virtualcarhub.cloud/gw`
- OpenClaw doctor no longer fails with Docker-volume `EPERM` chmod errors
